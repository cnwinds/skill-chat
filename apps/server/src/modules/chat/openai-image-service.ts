import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileRecord } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { FileService } from '../files/file-service.js';
import type { ResponsesInputImagePart } from './openai-harness-context.js';

type ImageOperation = 'generate' | 'edit';
type ImageSource = 'responses_tool' | 'images_generate_api' | 'images_edit_api';

type ImageInputFile = {
  fileId: string;
  displayName: string;
  mimeType: string;
  absolutePath: string;
};

type SavedImageResult = {
  file: FileRecord;
  prompt: string;
  revisedPrompt?: string;
  operation: ImageOperation;
  source: ImageSource;
  model: string;
  inputFileIds?: string[];
};

type GenerateImageArgs = {
  userId: string;
  sessionId: string;
  prompt: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
};

type EditImageArgs = GenerateImageArgs & {
  inputFileIds: string[];
  maskFileId?: string;
};

const DEFAULT_IMAGE_MODEL = 'gpt-image-2';
const DEFAULT_IMAGE_FORMAT = 'png';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const pickFirstBase64Image = (payload: unknown) => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error('OpenAI 图片接口未返回 data 数组');
  }

  for (const item of payload.data) {
    if (isRecord(item) && typeof item.b64_json === 'string' && item.b64_json.trim()) {
      return {
        base64: item.b64_json.trim(),
        revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined,
      };
    }
  }

  throw new Error('OpenAI 图片接口未返回 b64_json');
};

const ensureImageMimeType = (file: FileRecord) => {
  const mimeType = file.mimeType ?? '';
  if (!mimeType.startsWith('image/')) {
    throw new Error(`文件 ${file.displayName} 不是图片，无法用于改图`);
  }
  return mimeType;
};

const toDataUrl = async (absolutePath: string, mimeType: string) => {
  const buffer = await fs.readFile(absolutePath);
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
};

export class OpenAIImageService {
  constructor(
    private readonly config: AppConfig,
    private readonly fileService: FileService,
  ) {}

  get imageModel() {
    return DEFAULT_IMAGE_MODEL;
  }

  async resolveImageInputs(userId: string, fileIds: string[]): Promise<ImageInputFile[]> {
    const uniqueIds = [...new Set(fileIds)];
    return await Promise.all(uniqueIds.map(async (fileId) => {
      const { file, absolutePath } = await this.fileService.resolveDownloadPath(userId, fileId);
      return {
        fileId: file.id,
        displayName: file.displayName,
        mimeType: ensureImageMimeType(file),
        absolutePath,
      };
    }));
  }

  async buildResponsesInputImages(userId: string, fileIds: string[]): Promise<ResponsesInputImagePart[]> {
    const inputs = await this.resolveImageInputs(userId, fileIds);
    return await Promise.all(inputs.map(async (input) => ({
      type: 'input_image',
      image_url: await toDataUrl(input.absolutePath, input.mimeType),
    })));
  }

  async saveResponsesImageToolResult(args: {
    userId: string;
    sessionId: string;
    prompt: string;
    base64Image: string;
    revisedPrompt?: string;
    inputFileIds?: string[];
    outputFormat?: 'png' | 'jpeg' | 'webp';
  }): Promise<SavedImageResult> {
    return await this.persistBase64Image({
      userId: args.userId,
      sessionId: args.sessionId,
      prompt: args.prompt,
      base64Image: args.base64Image,
      revisedPrompt: args.revisedPrompt,
      inputFileIds: args.inputFileIds,
      outputFormat: args.outputFormat,
      source: 'responses_tool',
      operation: args.inputFileIds && args.inputFileIds.length > 0 ? 'edit' : 'generate',
      model: this.imageModel,
    });
  }

  async generateViaImagesApi(args: GenerateImageArgs): Promise<SavedImageResult> {
    const response = await fetch(`${this.config.OPENAI_BASE_URL.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: this.imageModel,
        prompt: args.prompt,
        quality: args.quality,
        size: args.size,
        output_format: args.outputFormat ?? DEFAULT_IMAGE_FORMAT,
      }),
    });

    const payload = await this.readJsonResponse(response, '图片生成');
    const generated = pickFirstBase64Image(payload);
    return await this.persistBase64Image({
      userId: args.userId,
      sessionId: args.sessionId,
      prompt: args.prompt,
      base64Image: generated.base64,
      revisedPrompt: generated.revisedPrompt,
      inputFileIds: undefined,
      outputFormat: args.outputFormat,
      source: 'images_generate_api',
      operation: 'generate',
      model: this.imageModel,
    });
  }

  async editViaImagesApi(args: EditImageArgs): Promise<SavedImageResult> {
    const inputFiles = await this.resolveImageInputs(args.userId, args.inputFileIds);
    if (inputFiles.length === 0) {
      throw new Error('改图至少需要一张输入图片');
    }

    const form = new FormData();
    form.append('model', this.imageModel);
    form.append('prompt', args.prompt);
    if (args.quality) {
      form.append('quality', args.quality);
    }
    if (args.size) {
      form.append('size', args.size);
    }
    form.append('output_format', args.outputFormat ?? DEFAULT_IMAGE_FORMAT);

    for (const file of inputFiles) {
      const buffer = await fs.readFile(file.absolutePath);
      form.append('image[]', new Blob([buffer], { type: file.mimeType }), path.basename(file.displayName));
    }

    if (args.maskFileId) {
      const { file, absolutePath } = await this.fileService.resolveDownloadPath(args.userId, args.maskFileId);
      const mimeType = ensureImageMimeType(file);
      const buffer = await fs.readFile(absolutePath);
      form.append('mask', new Blob([buffer], { type: mimeType }), path.basename(file.displayName));
    }

    const response = await fetch(`${this.config.OPENAI_BASE_URL.replace(/\/+$/, '')}/images/edits`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.OPENAI_API_KEY}`,
      },
      body: form,
    });

    const payload = await this.readJsonResponse(response, '图片编辑');
    const generated = pickFirstBase64Image(payload);
    return await this.persistBase64Image({
      userId: args.userId,
      sessionId: args.sessionId,
      prompt: args.prompt,
      base64Image: generated.base64,
      revisedPrompt: generated.revisedPrompt,
      inputFileIds: inputFiles.map((file) => file.fileId),
      outputFormat: args.outputFormat,
      source: 'images_edit_api',
      operation: 'edit',
      model: this.imageModel,
    });
  }

  private async persistBase64Image(args: {
    userId: string;
    sessionId: string;
    prompt: string;
    base64Image: string;
    revisedPrompt?: string;
    inputFileIds?: string[];
    outputFormat?: 'png' | 'jpeg' | 'webp';
    source: ImageSource;
    operation: ImageOperation;
    model: string;
  }): Promise<SavedImageResult> {
    const format = args.outputFormat ?? DEFAULT_IMAGE_FORMAT;
    const mimeType = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    const file = await this.fileService.saveGeneratedBinary({
      userId: args.userId,
      sessionId: args.sessionId,
      displayName: `generated-image.${format}`,
      mimeType,
      content: Buffer.from(args.base64Image, 'base64'),
    });

    return {
      file,
      prompt: args.prompt,
      revisedPrompt: args.revisedPrompt,
      operation: args.operation,
      source: args.source,
      model: args.model,
      inputFileIds: args.inputFileIds,
    };
  }

  private async readJsonResponse(response: Response, label: string) {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label}失败：HTTP ${response.status} ${text}`.trim());
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${label}失败：响应不是合法 JSON`);
    }
  }
}
