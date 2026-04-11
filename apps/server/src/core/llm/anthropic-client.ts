import type { PlannerResult, RouterDecision } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import type {
  ChatModelClient,
  ClassifyInput,
  PlanInput,
  ReplyInput,
  SkillReplyInput,
  ToolPlanningInput,
  ToolPlanningResult,
} from './model-client.js';
import { RuleBasedModelClient } from './rule-based-client.js';

type AnthropicContentBlock = {
  type: string;
  text?: string;
};

type AnthropicResponse = {
  content?: AnthropicContentBlock[];
};

const REPLY_REQUEST_TIMEOUT_MS = 120_000;
const API_RETRY_LIMIT = 5;
const API_RETRY_DELAY_MS = 1_000;

const extractText = (response: AnthropicResponse) =>
  response.content
    ?.filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text ?? '')
    .join('\n')
    .trim() ?? '';

const toDisplayErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AnthropicModelClient implements ChatModelClient {
  private readonly fallback = new RuleBasedModelClient();

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    return this.config.ANTHROPIC_BASE_URL.replace(/\/+$/, '');
  }

  private get authToken() {
    return this.config.ANTHROPIC_AUTH_TOKEN || this.config.ANTHROPIC_API_KEY;
  }

  private async request(model: string, prompt: string, system: string, timeoutMs = this.config.LLM_REQUEST_TIMEOUT_MS): Promise<string> {
    if (!this.authToken) {
      throw new Error('Anthropic auth token is not configured');
    }

    for (let attempt = 0; attempt < API_RETRY_LIMIT; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl}/v1/messages`, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${this.authToken}`,
            'x-api-key': this.authToken,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: this.config.LLM_MAX_OUTPUT_TOKENS,
            system,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Anthropic request failed: ${response.status} ${body}`);
        }

        const payload = (await response.json()) as AnthropicResponse;
        return extractText(payload);
      } catch (error) {
        const shouldRetry = attempt < API_RETRY_LIMIT - 1;
        if (!shouldRetry) {
          throw error;
        }
        const retryDelayMs = this.config.NODE_ENV === 'test' ? 0 : API_RETRY_DELAY_MS * (attempt + 1);
        await wait(retryDelayMs);
      }
    }

    throw new Error('Anthropic request failed after retries');
  }

  private tryParseJson<T>(raw: string): T | null {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async classify(input: ClassifyInput): Promise<RouterDecision> {
    return this.fallback.classify(input);
  }

  async plan(input: PlanInput): Promise<PlannerResult> {
    try {
      const prompt = JSON.stringify({
        message: input.message,
        skill: {
          name: input.skill.name,
          description: input.skill.description,
          markdown: input.skill.markdown,
          references: input.skill.referencesContent,
        },
        files: input.files,
      });
      const text = await this.request(
        this.config.ANTHROPIC_MODEL_PLANNER,
        prompt,
        '你是一个 Skill 规划器。只返回 JSON：{"assistantMessage":string,"toolCalls":[{"skill":string,"action":"run","arguments":object}]}',
      );
      if (!text) {
        throw new Error('Anthropic planner returned empty text');
      }
      return this.tryParseJson<PlannerResult>(text) ?? this.fallback.plan(input);
    } catch {
      return this.fallback.plan(input);
    }
  }

  async planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult> {
    return this.fallback.planToolUse(input);
  }

  async *replyStream(input: ReplyInput): AsyncIterable<string> {
    try {
      const prompt = JSON.stringify({
        message: input.message,
        history: input.history.slice(-12),
        context: input.context,
      });
      const text = await this.request(
        this.config.ANTHROPIC_MODEL_REPLY,
        prompt,
        [
          '你是 SkillChat 的中文助手。直接回复用户，不要输出 JSON。',
          '工具结果和上下文只用于内部分析，不要输出“引用资料”“工具结果”“上下文”等标签。',
          '不要逐段粘贴网页正文、文件原文、工具参数或原始抓取内容；请直接整理成结论、建议和必要说明。',
        ].join('\n'),
        Math.max(this.config.LLM_REQUEST_TIMEOUT_MS, REPLY_REQUEST_TIMEOUT_MS),
      );
      if (!text) {
        throw new Error('Anthropic reply returned empty text');
      }

      const chunks = text.match(/.{1,24}/g) ?? [text];
      for (const chunk of chunks) {
        yield chunk;
      }
      return;
    } catch (error) {
      throw new Error(`Anthropic 回复失败：${toDisplayErrorMessage(error, '未知错误')}`);
    }
  }

  async *skillReplyStream(input: SkillReplyInput): AsyncIterable<string> {
    try {
      const prompt = JSON.stringify({
        message: input.message,
        history: input.history.slice(-12),
        skill: {
          name: input.skill.name,
          description: input.skill.description,
          markdown: input.skill.markdown,
          references: input.skill.referencesContent.slice(0, 4),
        },
        files: input.files,
        context: input.context,
      });

      const text = await this.request(
        this.config.ANTHROPIC_MODEL_REPLY,
        prompt,
        [
          '你是一个技能化对话助手。当前指定人格/视角 Skill 已激活。',
          '严格遵循 skill markdown 与 references，用中文直接回复用户，不要输出 JSON，不要跳出角色。',
          '工具结果和上下文只用于内部分析，不要输出“引用资料”“工具结果”“上下文”等标签。',
          '不要逐段粘贴网页正文、文件原文、工具参数或原始抓取内容；请直接整理成结论、建议和必要说明。',
        ].join('\n'),
        Math.max(this.config.LLM_REQUEST_TIMEOUT_MS, REPLY_REQUEST_TIMEOUT_MS),
      );
      if (!text) {
        throw new Error('Anthropic skill reply returned empty text');
      }

      const chunks = text.match(/.{1,24}/g) ?? [text];
      for (const chunk of chunks) {
        yield chunk;
      }
      return;
    } catch (error) {
      throw new Error(`Anthropic Skill 回复失败：${toDisplayErrorMessage(error, '未知错误')}`);
    }
  }
}
