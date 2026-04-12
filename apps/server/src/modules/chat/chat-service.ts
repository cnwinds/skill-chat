import { nanoid } from 'nanoid';
import type {
  FileRecord,
  MessageRole,
  SSEvent,
  StoredEvent,
  TextMessageEvent,
  ToolCallEvent,
  ToolProgressEvent,
} from '@skillchat/shared';
import type { StreamHub } from '../../core/stream/stream-hub.js';
import { MessageStore } from '../../core/storage/message-store.js';
import type { ChatModelClient, PlannedAssistantToolCall } from '../../core/llm/model-client.js';
import type { SkillRegistry } from '../skills/skill-registry.js';
import { FileService } from '../files/file-service.js';
import { RunnerManager } from '../../core/runner/runner-manager.js';
import { SessionService } from '../sessions/session-service.js';
import { AssistantToolService, type ExecutedAssistantToolResult } from '../tools/assistant-tool-service.js';
import type { OpenAIHarness } from './openai-harness.js';
import type { AppConfig } from '../../config/env.js';

type UserContext = {
  id: string;
  username: string;
  role: 'admin' | 'member';
};

const createEventId = () => `evt_${nanoid()}`;
const createToolCallId = () => `tool_${nanoid()}`;
const MODEL_TOOL_CONTEXT_CHARS = 3_500;
const explicitUrlPattern = /https?:\/\/[^\s)]+/i;
const zhangXuefengResearchPattern = /(最新|最近|当前|今年|明年|数据|排名|分数线|录取|保研|政策|就业|薪资|工资|薪酬|中位数|行业|岗位|招聘|专业|学校|院校|大学|高考|志愿|选科|考研|报考|升学)/;

const now = () => new Date().toISOString();
const clearQueueIfCurrent = (
  queues: Map<string, Promise<unknown>>,
  queueKey: string,
  task: Promise<unknown>,
) => {
  if (queues.get(queueKey) === task) {
    queues.delete(queueKey);
  }
};

export class ChatService {
  private readonly sessionQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly messageStore: MessageStore,
    private readonly streamHub: StreamHub,
    private readonly modelClient: ChatModelClient,
    private readonly skillRegistry: SkillRegistry,
    private readonly fileService: FileService,
    private readonly runnerManager: RunnerManager,
    private readonly sessionService: SessionService,
    private readonly assistantToolService: AssistantToolService,
    private readonly config: AppConfig,
    private readonly openAIHarness?: OpenAIHarness,
  ) {}

  async processMessage(user: UserContext, sessionId: string, content: string) {
    const queueKey = `${user.id}:${sessionId}`;
    const previous = this.sessionQueues.get(queueKey) ?? Promise.resolve();

    const task = previous
      .catch(() => undefined)
      .then(async () => {
        const session = this.sessionService.requireOwned(user.id, sessionId);
        await this.sessionService.renameFromMessage(user.id, sessionId, session.title, content);
        await this.sessionService.touch(user.id, sessionId);

        const userMessage: TextMessageEvent = {
          id: createEventId(),
          sessionId,
          kind: 'message',
          role: 'user',
          type: 'text',
          content,
          createdAt: now(),
        };
        await this.messageStore.appendEvent(user.id, sessionId, userMessage);

        this.publishThinking(sessionId, '正在分析需求');

        const history = await this.messageStore.readEvents(user.id, sessionId, { limit: 50 });
        const files = this.fileService.getFileContext(user.id, sessionId);
        const skills = this.skillRegistry.list();

        if (this.openAIHarness) {
          let finalText = '';
          const activatedSkills = session.activeSkills
            .map((skillName) => {
              try {
                return this.skillRegistry.get(skillName);
              } catch {
                return null;
              }
            })
            .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
          await this.openAIHarness.run({
            userId: user.id,
            sessionId,
            message: content,
            history,
            files,
            activatedSkills,
            callbacks: {
              onToolCall: async ({ callId, tool, arguments: toolArguments, hidden, meta }) => {
                const toolCallEvent: ToolCallEvent = {
                  id: createEventId(),
                  sessionId,
                  kind: 'tool_call',
                  callId,
                  skill: tool,
                  arguments: toolArguments,
                  hidden,
                  meta,
                  createdAt: now(),
                };
                await this.emitStored(user.id, sessionId, toolCallEvent);
              },
              onToolProgress: async ({ callId, tool, message, percent, status, hidden, meta }) => {
                await this.emitToolProgress(user.id, sessionId, callId, tool, message, percent, status, hidden, meta);
              },
              onToolResult: async ({ callId, tool, summary, content: resultContent, hidden, meta }) => {
                await this.emitStored(user.id, sessionId, {
                  id: createEventId(),
                  sessionId,
                  kind: 'tool_result',
                  callId,
                  skill: tool,
                  message: summary,
                  content: resultContent,
                  hidden,
                  meta,
                  createdAt: now(),
                });
              },
              onArtifact: async (file) => {
                await this.emitStored(user.id, sessionId, {
                  id: createEventId(),
                  sessionId,
                  kind: 'file',
                  file,
                  createdAt: now(),
                });
                this.publish(sessionId, {
                  id: createEventId(),
                  event: 'file_ready',
                  data: {
                    file: {
                      id: file.id,
                      name: file.displayName,
                      size: file.size,
                      url: file.downloadUrl,
                    },
                  },
                });
              },
              onTextDelta: async (delta) => {
                finalText += delta;
                this.publish(sessionId, {
                  id: createEventId(),
                  event: 'text_delta',
                  data: {
                    content: delta,
                  },
                });
              },
            },
          });

          if (finalText.trim()) {
            await this.persistTextMessage(user.id, sessionId, finalText, 'assistant');
          }
          this.publish(sessionId, {
            id: createEventId(),
            event: 'done',
            data: {},
          });
          return;
        }

        const decision = await this.modelClient.classify({
          message: content,
          history,
          files,
          skills,
        });

        if (decision.mode === 'chat' || decision.selectedSkills.length === 0) {
          await this.replyWithAssistantTools(user.id, sessionId, content, history, files);
          this.publish(sessionId, {
            id: createEventId(),
            event: 'done',
            data: {},
          });
          return;
        }

        const skill = this.skillRegistry.get(decision.selectedSkills[0]);
        if (skill.runtime === 'chat') {
          this.publishThinking(sessionId, `正在切换到 ${skill.name} 视角`);
          await this.replyWithAssistantTools(user.id, sessionId, content, history, files, skill);
          this.publish(sessionId, {
            id: createEventId(),
            event: 'done',
            data: {},
          });
          return;
        }

        const plan = await this.modelClient.plan({
          message: content,
          files,
          skill,
        });

        for (const toolCall of plan.toolCalls) {
          const callId = createToolCallId();
          const toolCallEvent: ToolCallEvent = {
            id: createEventId(),
            sessionId,
            kind: 'tool_call',
            callId,
            skill: toolCall.skill,
            arguments: toolCall.arguments,
            createdAt: now(),
          };
          await this.emitStored(user.id, sessionId, toolCallEvent);
          this.publish(sessionId, {
            id: toolCallEvent.id,
            event: 'tool_start',
            data: {
              callId,
              skill: {
                name: toolCall.skill,
                status: 'running',
              },
              arguments: toolCall.arguments,
            },
          });

          await this.runnerManager.execute({
            userId: user.id,
            sessionId,
            skill,
            prompt: content,
            toolArguments: toolCall.arguments,
            files,
            onQueued: async () => {
              await this.emitToolProgress(user.id, sessionId, callId, skill.name, '任务已排队', undefined, 'queued');
            },
            onProgress: async (message, percent, status) => {
              await this.emitToolProgress(user.id, sessionId, callId, skill.name, message, percent, status);
            },
            onArtifact: async (file) => {
              await this.emitStored(user.id, sessionId, {
                id: createEventId(),
                sessionId,
                kind: 'file',
                file,
                createdAt: now(),
              });
              this.publish(sessionId, {
                id: createEventId(),
                event: 'file_ready',
                data: {
                  file: {
                    id: file.id,
                    name: file.displayName,
                    size: file.size,
                    url: file.downloadUrl,
                  },
                },
              });
            },
          });

          await this.emitStored(user.id, sessionId, {
            id: createEventId(),
            sessionId,
            kind: 'tool_result',
            callId,
            skill: skill.name,
            message: `${skill.name} 执行完成`,
            createdAt: now(),
          });
        }

        const latestFiles = this.fileService.list(user.id, { sessionId }).slice(0, 5);
        const summary = this.buildSkillSummary(plan.assistantMessage, latestFiles);
        await this.streamAssistantMessage(user.id, sessionId, summary, 'assistant');
        this.publish(sessionId, {
          id: createEventId(),
          event: 'done',
          data: {},
        });
      });

    this.sessionQueues.set(queueKey, task);
    void task.then(
      () => clearQueueIfCurrent(this.sessionQueues, queueKey, task),
      () => clearQueueIfCurrent(this.sessionQueues, queueKey, task),
    );

    return task;
  }

  private async replyWithAssistantTools(
    userId: string,
    sessionId: string,
    content: string,
    history: StoredEvent[],
    files: ReturnType<FileService['getFileContext']>,
    skill?: ReturnType<SkillRegistry['get']>,
  ) {
    const toolResults = await this.runAssistantTools(userId, sessionId, content, history, files, skill);
    const context = this.buildToolContext(toolResults);

    if (skill) {
      await this.replyWithChatSkill(userId, sessionId, content, history, files, skill, context);
      return;
    }

    await this.replyInText(userId, sessionId, content, history, context);
  }

  private async runAssistantTools(
    userId: string,
    sessionId: string,
    content: string,
    history: StoredEvent[],
    files: ReturnType<FileService['getFileContext']>,
    skill?: ReturnType<SkillRegistry['get']>,
  ) {
    if (!this.config.ENABLE_ASSISTANT_TOOLS) {
      return [] as ExecutedAssistantToolResult[];
    }

    if (!this.assistantToolService.shouldConsiderTools(content, files, skill?.name)) {
      return [] as ExecutedAssistantToolResult[];
    }

    const plan = await this.modelClient.planToolUse({
      message: content,
      history,
      files,
      tools: this.assistantToolService.list(skill),
      skill,
    });

    const plannedCalls = this.enforceAssistantToolRequirements(content, plan.toolCalls, skill).slice(0, 3);
    const indexedResults = new Map<number, ExecutedAssistantToolResult>();

    for (let index = 0; index < plannedCalls.length;) {
      const currentCall = plannedCalls[index]!;
      if (!this.isParallelAssistantTool(currentCall)) {
        const result = await this.executeAssistantToolCall(userId, sessionId, currentCall, skill);
        if (result) {
          indexedResults.set(index, result);
        }
        index += 1;
        continue;
      }

      let batchEnd = index;
      while (batchEnd < plannedCalls.length && this.isParallelAssistantTool(plannedCalls[batchEnd]!)) {
        batchEnd += 1;
      }

      const batch = plannedCalls.slice(index, batchEnd);
      const preparedBatch: Array<{ toolCall: PlannedAssistantToolCall; callId: string }> = [];
      for (const toolCall of batch) {
        preparedBatch.push({
          toolCall,
          callId: await this.prepareAssistantToolCall(userId, sessionId, toolCall),
        });
      }
      const batchResults = await Promise.all(
        preparedBatch.map(async ({ toolCall, callId }) => this.finishAssistantToolCall(userId, sessionId, toolCall, callId, skill)),
      );

      batchResults.forEach((result, offset) => {
        if (result) {
          indexedResults.set(index + offset, result);
        }
      });
      index = batchEnd;
    }

    return plannedCalls
      .map((_call, index) => indexedResults.get(index))
      .filter((result): result is ExecutedAssistantToolResult => Boolean(result));
  }

  private enforceAssistantToolRequirements(
    content: string,
    plannedCalls: PlannedAssistantToolCall[],
    skill?: ReturnType<SkillRegistry['get']>,
  ) {
    if (!this.shouldForceWebSearch(content, skill)) {
      return plannedCalls;
    }

    if (plannedCalls.some((toolCall) => toolCall.tool === 'web_search')) {
      return plannedCalls;
    }

    return [
      {
        tool: 'web_search',
        arguments: {
          query: content,
          maxResults: 5,
        },
      },
      ...plannedCalls,
    ];
  }

  private shouldForceWebSearch(content: string, skill?: ReturnType<SkillRegistry['get']>) {
    if (skill?.name !== 'zhangxuefeng-perspective') {
      return false;
    }

    if (explicitUrlPattern.test(content)) {
      return false;
    }

    return zhangXuefengResearchPattern.test(content);
  }

  private isParallelAssistantTool(toolCall: PlannedAssistantToolCall) {
    return toolCall.tool === 'web_search' || toolCall.tool === 'web_fetch';
  }

  private async executeAssistantToolCall(
    userId: string,
    sessionId: string,
    toolCall: PlannedAssistantToolCall,
    skill?: ReturnType<SkillRegistry['get']>,
  ) {
    const callId = await this.prepareAssistantToolCall(userId, sessionId, toolCall);
    return this.finishAssistantToolCall(userId, sessionId, toolCall, callId, skill);
  }

  private async prepareAssistantToolCall(
    userId: string,
    sessionId: string,
    toolCall: PlannedAssistantToolCall,
  ) {
    const callId = createToolCallId();
    const toolCallEvent: ToolCallEvent = {
      id: createEventId(),
      sessionId,
      kind: 'tool_call',
      callId,
      skill: toolCall.tool,
      arguments: toolCall.arguments,
      createdAt: now(),
    };
    await this.emitStored(userId, sessionId, toolCallEvent);
    this.publish(sessionId, {
      id: toolCallEvent.id,
      event: 'tool_start',
      data: {
        callId,
        skill: {
          name: toolCall.tool,
          status: 'running',
        },
        arguments: toolCall.arguments,
      },
    });
    await this.emitToolProgress(userId, sessionId, callId, toolCall.tool, '开始调用工具', undefined, 'running');
    return callId;
  }

  private async finishAssistantToolCall(
    userId: string,
    sessionId: string,
    toolCall: PlannedAssistantToolCall,
    callId: string,
    skill?: ReturnType<SkillRegistry['get']>,
  ) {
    try {
      const result = await this.assistantToolService.execute({
        userId,
        sessionId,
        call: toolCall,
        skill,
      });
      await this.emitStored(userId, sessionId, {
        id: createEventId(),
        sessionId,
        kind: 'tool_result',
        callId,
        skill: result.tool,
        message: result.summary,
        content: result.content,
        createdAt: now(),
      });

      if (result.artifacts?.length) {
        for (const file of result.artifacts) {
          await this.emitStored(userId, sessionId, {
            id: createEventId(),
            sessionId,
            kind: 'file',
            file,
            createdAt: now(),
          });
          this.publish(sessionId, {
            id: createEventId(),
            event: 'file_ready',
            data: {
              file: {
                id: file.id,
                name: file.displayName,
                size: file.size,
                url: file.downloadUrl,
              },
            },
          });
        }
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具调用失败';
      await this.emitToolProgress(userId, sessionId, callId, toolCall.tool, message, undefined, 'failed');
      return null;
    }
  }

  private buildToolContext(toolResults: ExecutedAssistantToolResult[]) {
    if (toolResults.length === 0) {
      return undefined;
    }

    return [
      '以下内容仅供内部参考，用于形成结论。不要向用户原样复述原始资料，不要输出“引用资料”“工具结果”“上下文”等标签。',
      ...toolResults.map((result, index) => [
        `工具 ${index + 1}: ${result.tool}`,
        `参数: ${JSON.stringify(result.arguments, null, 2)}`,
        (result.context ?? result.content).slice(0, MODEL_TOOL_CONTEXT_CHARS),
      ].join('\n')),
    ].join('\n\n');
  }

  private async replyInText(
    userId: string,
    sessionId: string,
    content: string,
    history: StoredEvent[],
    context?: string,
  ) {
    let finalText = '';
    for await (const chunk of this.modelClient.replyStream({ message: content, history, context })) {
      finalText += chunk;
      this.publish(sessionId, {
        id: createEventId(),
        event: 'text_delta',
        data: {
          content: chunk,
        },
      });
    }

    await this.persistTextMessage(userId, sessionId, finalText, 'assistant');
  }

  private async replyWithChatSkill(
    userId: string,
    sessionId: string,
    content: string,
    history: StoredEvent[],
    files: ReturnType<FileService['getFileContext']>,
    skill: ReturnType<SkillRegistry['get']>,
    context?: string,
  ) {
    let finalText = '';
    for await (const chunk of this.modelClient.skillReplyStream({
      message: content,
      history,
      files,
      skill,
      context,
    })) {
      finalText += chunk;
      this.publish(sessionId, {
        id: createEventId(),
        event: 'text_delta',
        data: {
          content: chunk,
        },
      });
    }

    await this.persistTextMessage(userId, sessionId, finalText, 'assistant');
  }

  private async streamAssistantMessage(userId: string, sessionId: string, content: string, role: MessageRole) {
    for (const chunk of content.match(/.{1,24}/g) ?? [content]) {
      this.publish(sessionId, {
        id: createEventId(),
        event: 'text_delta',
        data: {
          content: chunk,
        },
      });
    }

    await this.persistTextMessage(userId, sessionId, content, role);
  }

  private async persistTextMessage(userId: string, sessionId: string, content: string, role: MessageRole) {
    const event: TextMessageEvent = {
      id: createEventId(),
      sessionId,
      kind: 'message',
      role,
      type: 'text',
      content,
      createdAt: now(),
    };
    await this.messageStore.appendEvent(userId, sessionId, event);
    await this.sessionService.touch(userId, sessionId);
  }

  private async emitToolProgress(
    userId: string,
    sessionId: string,
    callId: string,
    skill: string,
    message: string,
    percent?: number,
    status?: string,
    hidden?: boolean,
    meta?: Record<string, unknown>,
  ) {
    const event: ToolProgressEvent = {
      id: createEventId(),
      sessionId,
      kind: 'tool_progress',
      callId,
      skill,
      message,
      percent,
      status,
      hidden,
      meta,
      createdAt: now(),
    };
    await this.emitStored(userId, sessionId, event);
  }

  private async emitStored(userId: string, sessionId: string, event: StoredEvent) {
    await this.messageStore.appendEvent(userId, sessionId, event);

    if (
      (event.kind === 'tool_call' || event.kind === 'tool_progress' || event.kind === 'tool_result') &&
      event.hidden
    ) {
      return;
    }

    if (event.kind === 'tool_call') {
      this.publish(sessionId, {
        id: event.id,
        event: 'tool_start',
        data: {
          callId: event.callId,
          skill: {
            name: event.skill,
            status: 'running',
          },
          arguments: event.arguments,
          meta: event.meta,
        },
      });
    }

    if (event.kind === 'tool_progress') {
      this.publish(sessionId, {
        id: event.id,
        event: 'tool_progress',
        data: {
          callId: event.callId,
          skill: {
            name: event.skill,
            status: event.status ?? 'running',
          },
          message: event.message,
          percent: event.percent,
          meta: event.meta,
        },
      });
    }

    if (event.kind === 'thinking') {
      this.publish(sessionId, {
        id: event.id,
        event: 'thinking',
        data: {
          message: event.content,
        },
      });
    }

    if (event.kind === 'error') {
      this.publish(sessionId, {
        id: event.id,
        event: 'error',
        data: {
          message: event.message,
        },
      });
    }

    if (event.kind === 'tool_result') {
      this.publish(sessionId, {
        id: event.id,
        event: 'tool_result',
        data: {
          callId: event.callId,
          skill: {
            name: event.skill,
            status: 'success',
          },
          message: event.message,
          content: event.content,
          meta: event.meta,
        },
      });
    }
  }

  private publishThinking(sessionId: string, content: string) {
    this.publish(sessionId, {
      id: createEventId(),
      event: 'thinking',
      data: {
        message: content,
      },
    });
  }

  async handleFailure(userId: string, sessionId: string, error: unknown) {
    const message = error instanceof Error ? error.message : '处理失败';
    await this.emitStored(userId, sessionId, {
      id: createEventId(),
      sessionId,
      kind: 'error',
      message,
      createdAt: now(),
    });
    this.publish(sessionId, {
      id: createEventId(),
      event: 'done',
      data: {},
    });
  }

  private publish(sessionId: string, event: SSEvent) {
    this.streamHub.publish(sessionId, event);
  }

  private buildSkillSummary(assistantMessage: string, files: FileRecord[]) {
    if (files.length === 0) {
      return `${assistantMessage}\n\n任务已完成，但没有生成可下载文件。`;
    }

    const recent = files.slice(0, 3).map((file) => `- ${file.displayName}`).join('\n');
    return `${assistantMessage}\n\n已生成以下文件：\n${recent}`;
  }
}
