import type { PlannerResult, RouterDecision, StoredEvent } from '@skillchat/shared';
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
import { runWithInactivityTimeout } from './inactivity-timeout.js';
import { streamOpenAIResponsesText, type OpenAIResponsesInputMessage } from './openai-responses.js';
import { RuleBasedModelClient } from './rule-based-client.js';

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OpenAIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    finish_reason?: string | null;
  }>;
};

const TOOL_PLANNING_HISTORY_LIMIT = 8;
const TOOL_PLANNING_MESSAGE_CHARS = 500;
const TOOL_PLANNING_SKILL_CHARS = 6_000;
const TOOL_PLANNING_REFERENCE_CHARS = 1_500;
const REPLY_REQUEST_TIMEOUT_MS = 120_000;
const API_RETRY_LIMIT = 5;
const API_RETRY_DELAY_MS = 1_000;

const extractText = (content: string | Array<{ type?: string; text?: string }> | undefined) => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text ?? '')
      .join('');
  }

  return '';
};

const truncateText = (content: string, maxChars: number) => (
  content.length > maxChars ? `${content.slice(0, maxChars)}...` : content
);

const toHistoryMessages = (history: StoredEvent[], currentMessage: string) => {
  const messages = history.flatMap<OpenAIChatMessage>((event) => {
    if (event.kind !== 'message' || event.type !== 'text') {
      return [];
    }

    if (event.role !== 'user' && event.role !== 'assistant' && event.role !== 'system') {
      return [];
    }

    return [{
      role: event.role,
      content: event.content,
    }];
  });

  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || last.content !== currentMessage) {
    messages.push({
      role: 'user',
      content: currentMessage,
    });
  }

  return messages.slice(-12);
};

const toPlanningHistory = (history: StoredEvent[]) => history
  .flatMap((event) => {
    if (event.kind !== 'message' || event.type !== 'text') {
      return [];
    }

    if (event.role !== 'user' && event.role !== 'assistant' && event.role !== 'system') {
      return [];
    }

    return [{
      role: event.role,
      content: truncateText(event.content, TOOL_PLANNING_MESSAGE_CHARS),
    }];
  })
  .slice(-TOOL_PLANNING_HISTORY_LIMIT);

const toHistoricSystemMessages = (history: StoredEvent[]) => history
  .flatMap((event) => {
    if (event.kind !== 'message' || event.type !== 'text' || event.role !== 'system') {
      return [];
    }

    return [event.content];
  })
  .slice(-4);

const toResponsesConversationInput = (history: StoredEvent[], currentMessage: string) => toHistoryMessages(history, currentMessage)
  .flatMap<OpenAIResponsesInputMessage>((message) => {
    if (message.role === 'system') {
      return [];
    }

    return [{
      role: message.role,
      content: message.content,
    }];
  });

const extractSkillPlanningProtocol = (markdown: string) => {
  const start = markdown.search(/^##\s+回答工作流/m);
  const candidate = start >= 0 ? markdown.slice(start) : markdown;
  return truncateText(candidate, TOOL_PLANNING_SKILL_CHARS);
};

const extractJsonCandidate = (raw: string) => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }

  return raw.trim();
};

const toDisplayErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAIModelClient implements ChatModelClient {
  private readonly fallback = new RuleBasedModelClient();

  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    return this.config.OPENAI_BASE_URL.replace(/\/+$/, '');
  }

  private get apiKey() {
    return this.config.OPENAI_API_KEY;
  }

  private buildReplyReasoning(model: string) {
    if (!/^gpt-5|^o\d/i.test(model)) {
      return undefined;
    }

    return {
      effort: this.config.OPENAI_REASONING_EFFORT_REPLY,
    };
  }

  private parseEventPayloads(rawEvent: string) {
    const payloads: string[] = [];

    for (const line of rawEvent.split(/\r?\n/)) {
      if (!line.startsWith('data:')) {
        continue;
      }

      payloads.push(line.slice(5).trimStart());
    }

    return payloads;
  }

  private extractChunkText(chunk: OpenAIStreamChunk) {
    return chunk.choices?.map((choice) => extractText(choice.delta?.content)).join('') ?? '';
  }

  private async *streamText(model: string, messages: OpenAIChatMessage[], temperature = 0.4): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    for (let attempt = 0; attempt < API_RETRY_LIMIT; attempt += 1) {
      let hasContent = false;

      try {
        const controller = new AbortController();
        const response = await runWithInactivityTimeout({
          timeoutMs: this.config.LLM_REQUEST_TIMEOUT_MS,
          controller,
          task: () => fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
              'content-type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages,
              temperature,
              max_tokens: this.config.LLM_MAX_OUTPUT_TOKENS,
              stream: true,
            }),
          }),
        });

        if (!response.ok) {
          const body = await response.text();
          throw new Error(`OpenAI request failed: ${response.status} ${body}`);
        }

        if (!response.body) {
          throw new Error('OpenAI response body is empty');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const consumeEvent = async function* (
          eventBlock: string,
          parseEventPayloads: (rawEvent: string) => string[],
          extractChunkText: (chunk: OpenAIStreamChunk) => string,
        ) {
          for (const payload of parseEventPayloads(eventBlock)) {
            if (!payload || payload === '[DONE]') {
              continue;
            }

            const chunk = JSON.parse(payload) as OpenAIStreamChunk;
            const text = extractChunkText(chunk);
            if (text) {
              yield text;
            }
          }
        };

        while (true) {
          const { value, done } = await runWithInactivityTimeout({
            timeoutMs: this.config.LLM_REQUEST_TIMEOUT_MS,
            controller,
            task: () => reader.read(),
          });
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf('\n\n');
          while (separatorIndex >= 0) {
            const eventBlock = buffer.slice(0, separatorIndex).trim();
            buffer = buffer.slice(separatorIndex + 2);

            if (eventBlock) {
              for await (const text of consumeEvent(eventBlock, this.parseEventPayloads.bind(this), this.extractChunkText.bind(this))) {
                hasContent = true;
                yield text;
              }
            }

            separatorIndex = buffer.indexOf('\n\n');
          }
        }

        const tail = buffer.trim();
        if (tail) {
          for await (const text of consumeEvent(tail, this.parseEventPayloads.bind(this), this.extractChunkText.bind(this))) {
            hasContent = true;
            yield text;
          }
        }

        if (!hasContent) {
          throw new Error('OpenAI stream returned empty text');
        }

        return;
      } catch (error) {
        const shouldRetry = !hasContent && attempt < API_RETRY_LIMIT - 1;
        if (!shouldRetry) {
          throw error;
        }
        const retryDelayMs = this.config.NODE_ENV === 'test' ? 0 : API_RETRY_DELAY_MS * (attempt + 1);
        await wait(retryDelayMs);
      }
    }
  }

  private async requestText(model: string, messages: OpenAIChatMessage[], temperature = 0.4) {
    let finalText = '';
    for await (const chunk of this.streamText(model, messages, temperature)) {
      finalText += chunk;
    }
    return finalText.trim();
  }

  private tryParseJson<T>(raw: string): T | null {
    try {
      return JSON.parse(extractJsonCandidate(raw)) as T;
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

      const text = await this.requestText(
        this.config.OPENAI_MODEL_PLANNER,
        [
          {
            role: 'system',
            content: '你是一个 Skill 规划器。只返回 JSON：{"assistantMessage":string,"toolCalls":[{"skill":string,"action":"run","arguments":object}]}',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        0.2,
      );

      return this.tryParseJson<PlannerResult>(text) ?? this.fallback.plan(input);
    } catch {
      return this.fallback.plan(input);
    }
  }

  async planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult> {
    const heuristic = await this.fallback.planToolUse(input);
    const availableTools = input.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n');
    const today = new Date().toISOString().slice(0, 10);
    const currentYear = new Date().getFullYear();
    const toolContext = {
      today,
      currentYear,
      message: input.message,
      history: toPlanningHistory(input.history),
      files: input.files,
      tools: input.tools,
      skill: input.skill
        ? {
            name: input.skill.name,
            description: input.skill.description,
            protocol: extractSkillPlanningProtocol(input.skill.markdown),
            references: input.skill.referencesContent
              .slice(0, 3)
              .map((reference) => ({
                name: reference.name,
                excerpt: truncateText(reference.content, TOOL_PLANNING_REFERENCE_CHARS),
              })),
          }
        : undefined,
    };

    try {
      const text = await this.requestText(
        this.config.OPENAI_MODEL_ROUTER,
        [
          {
            role: 'system',
            content: [
              '你是一个工具调用规划器。你只能决定是否调用工具，不直接回答用户。',
              '只返回 JSON：{"toolCalls":[{"tool":string,"arguments":object}]}',
              '优先使用内部工具，不要为了普通寒暄或常识对话调用工具。',
              `当前日期是 ${today}，当前年份是 ${currentYear}。`,
              '除非用户明确指定历史年份，否则不要擅自把查询词写成 2024、2025 这类旧年份。',
              '如果当前 skill 的 protocol 明确要求“先研究/先搜再答”，你必须先规划对应工具，而不是直接返回空 toolCalls。',
              '规则：',
              '1. 需要最新网页信息、新闻、政策、排名、分数线、就业或薪资数据时调用 web_search。',
              '2. 用户给出明确 URL，或你需要访问某个确定网页时调用 web_fetch。',
              '3. 提到上传文件、附件、文档内容时，优先 list_files / read_file。',
              '4. 需要查看工作区、模板、脚本、配置、日志、本地资料时，优先 list_workspace_paths / read_workspace_path_slice。',
              '5. 需要查看 Skill 规则和参考资料时，优先 list_skill_resources / read_skill_resource_slice。',
              '6. 只有在确实要生成可下载文本产物时，才调用 write_artifact_file。',
              '7. 能并行的网页搜索和网页抓取可以一起返回；本地文件读取和写入默认谨慎、尽量少量、顺序执行。',
              '8. 不要为了像代理而代理；如果已有足够上下文，就直接不调用工具。',
              '9. 对教育/专业/院校/就业/薪资/分数线/政策这类强依赖时效和事实的问题，默认先检索再回答。',
              '最多返回 3 个工具调用。',
              `本轮可用工具：\n${availableTools}`,
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify(toolContext),
          },
        ],
        0.1,
      );

      return this.tryParseJson<ToolPlanningResult>(text) ?? heuristic;
    } catch {
      return heuristic;
    }
  }

  private async *streamResponsesReply(model: string, instructions: string, input: OpenAIResponsesInputMessage[]) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    for (let attempt = 0; attempt < API_RETRY_LIMIT; attempt += 1) {
      let hasContent = false;

      try {
        for await (const chunk of streamOpenAIResponsesText({
          apiKey: this.apiKey,
          baseUrl: this.baseUrl,
          timeoutMs: Math.max(this.config.LLM_REQUEST_TIMEOUT_MS, REPLY_REQUEST_TIMEOUT_MS),
          body: {
            model,
            instructions,
            input,
            max_output_tokens: this.config.LLM_MAX_OUTPUT_TOKENS,
            text: {
              format: {
                type: 'text',
              },
              verbosity: 'medium',
            },
            reasoning: this.buildReplyReasoning(model),
          },
        })) {
          hasContent = true;
          yield chunk;
        }

        return;
      } catch (error) {
        const shouldRetry = !hasContent && attempt < API_RETRY_LIMIT - 1;
        if (!shouldRetry) {
          throw error;
        }
        const retryDelayMs = this.config.NODE_ENV === 'test' ? 0 : API_RETRY_DELAY_MS * (attempt + 1);
        await wait(retryDelayMs);
      }
    }
  }

  async *replyStream(input: ReplyInput): AsyncIterable<string> {
    try {
      const instructions = [
        ...toHistoricSystemMessages(input.history),
        '你是 SkillChat 的中文助手。直接回复用户，不要输出 JSON。',
        '工具结果和上下文只用于内部分析，不要输出“引用资料”“工具结果”“上下文”等标签。',
        '不要逐段粘贴网页正文、文件原文、工具参数或原始抓取内容；请直接整理成结论、建议和必要说明。',
        input.context ? `可用工具结果与上下文：\n${input.context}` : '',
      ].filter(Boolean).join('\n\n');

      yield* this.streamResponsesReply(
        this.config.OPENAI_MODEL_REPLY,
        instructions,
        toResponsesConversationInput(input.history, input.message),
      );
      return;
    } catch (error) {
      throw new Error(`OpenAI 回复失败：${toDisplayErrorMessage(error, '未知错误')}`);
    }
  }

  async *skillReplyStream(input: SkillReplyInput): AsyncIterable<string> {
    try {
      const skillContext = JSON.stringify({
        skill: {
          name: input.skill.name,
          description: input.skill.description,
          markdown: input.skill.markdown,
          references: input.skill.referencesContent.slice(0, 4),
        },
        files: input.files,
      });

      const instructions = [
        ...toHistoricSystemMessages(input.history),
        '你是一个技能化对话助手。当前指定人格/视角 Skill 已激活。',
        '严格遵循 skill markdown 与 references，用中文直接回复用户，不要输出 JSON，不要跳出角色。',
        '工具结果和上下文只用于内部分析，不要输出“引用资料”“工具结果”“上下文”等标签。',
        '不要逐段粘贴网页正文、文件原文、工具参数或原始抓取内容；请直接整理成结论、建议和必要说明。',
        skillContext,
        input.context ? `可用工具结果与上下文：\n${input.context}` : '',
      ].join('\n\n');

      yield* this.streamResponsesReply(
        this.config.OPENAI_MODEL_REPLY,
        instructions,
        toResponsesConversationInput(input.history, input.message),
      );
      return;
    } catch (error) {
      throw new Error(`OpenAI Skill 回复失败：${toDisplayErrorMessage(error, '未知错误')}`);
    }
  }
}
