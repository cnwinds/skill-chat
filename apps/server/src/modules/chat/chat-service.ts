import { nanoid } from 'nanoid';
import type {
  FollowUpQueueMutationResponse,
  MessageDispatchRequest,
  MessageDispatchResponse,
  MessageRole,
  SessionRuntimeSnapshot,
  SSEvent,
  StoredEvent,
  TextMessageEvent,
  TurnKind,
  TurnInterruptResponse,
  ToolCallEvent,
  ToolProgressEvent,
} from '@skillchat/shared';
import { SessionTurnRegistry } from '../../core/turn/session-turn-registry.js';
import { SessionTurnRuntime } from '../../core/turn/session-turn-runtime.js';
import { FileRuntimePersistence } from '../../core/turn/turn-persistence.js';
import type { RuntimeInput, TurnExecutionContext } from '../../core/turn/turn-types.js';
import type { StreamHub } from '../../core/stream/stream-hub.js';
import { MessageStore } from '../../core/storage/message-store.js';
import { getSessionTurnRuntimePath } from '../../core/storage/paths.js';
import type { RegisteredSkill, SkillRegistry } from '../skills/skill-registry.js';
import { FileService } from '../files/file-service.js';
import { SessionService } from '../sessions/session-service.js';
import { OpenAIHarness } from './openai-harness.js';
import type { AppConfig } from '../../config/env.js';
import { buildResponsesHistoryInput, shouldAutoCompactHistory } from './openai-harness-context.js';
import { SessionContextStore } from './session-context-store.js';

type UserContext = {
  id: string;
  username: string;
  role: 'admin' | 'member';
};

const createEventId = () => `evt_${nanoid()}`;
const now = () => new Date().toISOString();

export class ChatService {
  private readonly turnRegistry: SessionTurnRegistry;

  constructor(
    private readonly messageStore: MessageStore,
    private readonly streamHub: StreamHub,
    private readonly skillRegistry: SkillRegistry,
    private readonly fileService: FileService,
    private readonly sessionService: SessionService,
    private readonly config: AppConfig,
    private readonly openAIHarness: OpenAIHarness,
    private readonly sessionContextStore: SessionContextStore,
  ) {
    this.turnRegistry = new SessionTurnRegistry(
      async (userId, runtimeSessionId) => this.getRuntimePersistence(userId, runtimeSessionId).load(),
      (userId, runtimeSessionId, initialState, onBecameIdle) => new SessionTurnRuntime(
        runtimeSessionId,
        {
          onInputCommitted: async ({ user, turnId, kind, input }) => {
            await this.commitUserInput(user.id, runtimeSessionId, turnId, kind, input);
          },
          onExecuteTurn: async (execution) => {
            await this.executeTurn(runtimeSessionId, execution);
          },
          onTurnFailure: async ({ user, error }) => {
            await this.handleFailure(user.id, runtimeSessionId, error, { publishDone: false });
          },
          publish: (event) => {
            this.publish(runtimeSessionId, event as SSEvent);
          },
        },
        this.getRuntimePersistence(userId, runtimeSessionId),
        initialState,
        onBecameIdle,
      ),
    );
  }

  async processMessage(user: UserContext, sessionId: string, content: string) {
    const result = await this.dispatchMessage(user, sessionId, {
      content,
      dispatch: 'new_turn',
    });
    await result.task;
  }

  async dispatchMessage(user: UserContext, sessionId: string, input: MessageDispatchRequest): Promise<{
    response: MessageDispatchResponse;
    task?: Promise<void>;
  }> {
    this.sessionService.requireOwned(user.id, sessionId);
    const runtime = await this.turnRegistry.getOrCreate(user.id, sessionId);
    return await runtime.dispatchMessage({
      user,
      content: input.content,
      mode: input.dispatch,
      turnId: input.turnId,
      kind: input.kind,
    });
  }

  async steerTurn(user: UserContext, sessionId: string, turnId: string, content: string) {
    this.sessionService.requireOwned(user.id, sessionId);
    const runtime = await this.turnRegistry.getOrCreate(user.id, sessionId);
    return await runtime.steerTurn(user, turnId, content);
  }

  async interruptTurn(user: UserContext, sessionId: string, turnId: string): Promise<TurnInterruptResponse> {
    this.sessionService.requireOwned(user.id, sessionId);
    const runtime = await this.turnRegistry.get(user.id, sessionId);
    if (!runtime) {
      throw new Error('当前 turn 不存在');
    }
    return await runtime.interruptTurn(user, turnId);
  }

  async removeFollowUpInput(user: UserContext, sessionId: string, inputId: string): Promise<FollowUpQueueMutationResponse> {
    this.sessionService.requireOwned(user.id, sessionId);
    const runtime = await this.turnRegistry.get(user.id, sessionId);
    if (!runtime) {
      throw new Error('待处理输入不存在');
    }
    return await runtime.removeFollowUpInput(user, inputId);
  }

  async getRuntime(userId: string, sessionId: string): Promise<SessionRuntimeSnapshot> {
    this.sessionService.requireOwned(userId, sessionId);
    const runtime = await this.turnRegistry.get(userId, sessionId);
    if (!runtime) {
      return {
        sessionId,
        activeTurn: null,
        followUpQueue: [],
        recovery: null,
      };
    }
    return runtime.getSnapshot();
  }

  private async commitUserInput(
    userId: string,
    sessionId: string,
    _turnId: string,
    _kind: TurnKind,
    input: RuntimeInput,
  ) {
    const session = this.sessionService.requireOwned(userId, sessionId);
    await this.sessionService.renameFromMessage(userId, sessionId, session.title, input.content);
    const userMessage: TextMessageEvent = {
      id: createEventId(),
      sessionId,
      kind: 'message',
      role: 'user',
      type: 'text',
      content: input.content,
      createdAt: input.createdAt,
    };
    await this.messageStore.appendEvent(userId, sessionId, userMessage);
    await this.sessionService.touch(userId, sessionId);
  }

  private async executeTurn(sessionId: string, execution: TurnExecutionContext) {
    const { user } = execution;
    let currentInput = execution.initialInput;
    let nextRound = 1;

    while (true) {
      const session = this.sessionService.requireOwned(user.id, sessionId);
      let history = await this.messageStore.readEvents(user.id, sessionId);
      let contextState = await this.sessionContextStore.load(user.id, sessionId);
      execution.throwIfAborted();
      const files = this.fileService.getFileContext(user.id, sessionId);

      if (execution.kind === 'compact') {
        await this.executeCompactTurn({
          sessionId,
          userId: user.id,
          history,
          contextState,
          execution,
          input: currentInput,
        });
        return;
      }

      if (execution.kind === 'regular') {
        contextState = await this.maybeAutoCompactHistory({
          sessionId,
          userId: user.id,
          history,
          contextState,
          execution,
          input: currentInput,
        });
        history = await this.messageStore.readEvents(user.id, sessionId);
      }

      const { roundsUsed } = await this.executeTurnRound({
        sessionId,
        session,
        history,
        contextState,
        files,
        execution,
        input: currentInput,
        startingRound: nextRound,
      });

      nextRound += roundsUsed;
      execution.throwIfAborted();
      execution.updatePhase('finalizing');
      execution.setCanSteer(false);

      if (execution.kind !== 'regular') {
        return;
      }

      const pendingInputs = await execution.drainPendingInputs();
      if (pendingInputs.length === 0) {
        return;
      }

      currentInput = this.mergeContinuationInputs(pendingInputs);
    }
  }

  private async executeTurnRound(args: {
    sessionId: string;
    session: ReturnType<SessionService['requireOwned']>;
    history: StoredEvent[];
    contextState: Awaited<ReturnType<SessionContextStore['load']>>;
    files: ReturnType<FileService['getFileContext']>;
    execution: TurnExecutionContext;
    input: RuntimeInput;
    startingRound: number;
  }) {
    const { sessionId, session, history, contextState, files, execution, input, startingRound } = args;
    const { user } = execution;
    const availableSkills = this.resolveSessionSkills(session.activeSkills ?? []);

    execution.setRound(startingRound);
    execution.updatePhase('sampling');
    execution.setCanSteer(execution.kind === 'regular');
    this.publishThinking(sessionId, startingRound === 1 ? '正在分析需求' : '继续处理追加引导');

    let finalText = '';
    const result = await this.openAIHarness.run({
      userId: user.id,
      sessionId,
      message: input.content,
      history,
      files,
      availableSkills,
      contextState,
      signal: execution.signal,
      drainPendingInputs: async () => execution.drainPendingInputs(),
      startingRound,
      callbacks: {
        onRoundStart: (round) => {
          execution.throwIfAborted();
          execution.setRound(round);
          execution.updatePhase('sampling');
          execution.setCanSteer(execution.kind === 'regular');
        },
        onToolCall: async ({ callId, tool, arguments: toolArguments, hidden, meta }) => {
          execution.throwIfAborted();
          execution.updatePhase('tool_call');
          execution.setCanSteer(false);
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
          execution.throwIfAborted();
          execution.updatePhase('waiting_tool_result');
          execution.setCanSteer(false);
          await this.emitToolProgress(user.id, sessionId, callId, tool, message, percent, status, hidden, meta);
        },
        onToolResult: async ({ callId, tool, summary, content: resultContent, hidden, meta }) => {
          execution.throwIfAborted();
          execution.updatePhase('waiting_tool_result');
          execution.setCanSteer(false);
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
          execution.throwIfAborted();
          execution.updatePhase('waiting_tool_result');
          execution.setCanSteer(false);
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
          execution.throwIfAborted();
          execution.updatePhase('streaming_assistant');
          execution.setCanSteer(execution.kind === 'regular');
          finalText += delta;
          this.publish(sessionId, {
            id: createEventId(),
            event: 'text_delta',
            data: {
              content: delta,
            },
          });
        },
        onContextCompactionStart: async () => {
          execution.throwIfAborted();
          execution.updatePhase('sampling');
          execution.setCanSteer(false);
          this.publishThinking(sessionId, '本轮上下文较长，正在压缩后继续');
        },
      },
    });

    execution.throwIfAborted();
    if (finalText.trim()) {
      await this.persistTextMessage(user.id, sessionId, finalText, 'assistant');
    }
    return {
      roundsUsed: result.roundsUsed,
    };
  }

  private async maybeAutoCompactHistory(args: {
    sessionId: string;
    userId: string;
    history: StoredEvent[];
    contextState: Awaited<ReturnType<SessionContextStore['load']>>;
    execution: TurnExecutionContext;
    input: RuntimeInput;
  }) {
    const buildResult = buildResponsesHistoryInput({
      config: this.config,
      history: args.history,
      currentMessage: args.input.content,
      contextState: args.contextState,
    });

    if (!shouldAutoCompactHistory({ config: this.config, buildResult })) {
      return args.contextState;
    }

    const historyBeforeCurrentTurn = args.history.filter((event) => event.createdAt < args.input.createdAt);
    if (historyBeforeCurrentTurn.length === 0) {
      return args.contextState;
    }

    args.execution.throwIfAborted();
    args.execution.updatePhase('sampling');
    args.execution.setCanSteer(false);
    this.publishThinking(args.sessionId, '上下文较长，正在压缩历史');

    const summary = await this.openAIHarness.compactContext({
      history: historyBeforeCurrentTurn,
      contextState: args.contextState,
      signal: args.execution.signal,
    });

    args.execution.throwIfAborted();
    const baselineCreatedAt = historyBeforeCurrentTurn[historyBeforeCurrentTurn.length - 1]?.createdAt ?? null;
    const nextState = {
      version: 1 as const,
      latestCompaction: {
        summary,
        createdAt: now(),
        baselineCreatedAt,
        trigger: 'auto' as const,
      },
    };
    await this.sessionContextStore.save(args.userId, args.sessionId, nextState);
    return nextState;
  }

  private async executeCompactTurn(args: {
    sessionId: string;
    userId: string;
    history: StoredEvent[];
    contextState: Awaited<ReturnType<SessionContextStore['load']>>;
    execution: TurnExecutionContext;
    input: RuntimeInput;
  }) {
    const historyBeforeCompactCommand = args.history.filter((event) => event.createdAt < args.input.createdAt);
    args.execution.throwIfAborted();
    args.execution.updatePhase('sampling');
    args.execution.setCanSteer(false);
    this.publishThinking(args.sessionId, '正在压缩上下文');

    const summary = await this.openAIHarness.compactContext({
      history: historyBeforeCompactCommand,
      contextState: args.contextState,
      signal: args.execution.signal,
    });

    args.execution.throwIfAborted();
    const replyCreatedAt = now();
    const reply = '上下文已压缩，后续对话会基于摘要继续。';

    await this.persistTextMessage(args.userId, args.sessionId, reply, 'assistant', replyCreatedAt);
    await this.sessionContextStore.save(args.userId, args.sessionId, {
      version: 1,
      latestCompaction: {
        summary,
        createdAt: replyCreatedAt,
        baselineCreatedAt: replyCreatedAt,
        trigger: 'manual',
      },
    });

    this.publish(args.sessionId, {
      id: createEventId(),
      event: 'text_delta',
      data: {
        content: reply,
      },
    });
  }

  private mergeContinuationInputs(inputs: RuntimeInput[]): RuntimeInput {
    if (inputs.length === 1) {
      return inputs[0]!;
    }

    const last = inputs[inputs.length - 1]!;
    return {
      ...last,
      content: inputs.map((input) => input.content.trim()).filter(Boolean).join('\n'),
    };
  }

  private resolveSessionSkills(sessionSkillNames: string[]): RegisteredSkill[] {
    return sessionSkillNames.flatMap((skillName) => {
      try {
        const skill = this.skillRegistry.get(skillName);
        return skill ? [skill] : [];
      } catch {
        return [];
      }
    });
  }

  private async persistTextMessage(
    userId: string,
    sessionId: string,
    content: string,
    role: MessageRole,
    createdAt = now(),
  ) {
    const event: TextMessageEvent = {
      id: createEventId(),
      sessionId,
      kind: 'message',
      role,
      type: 'text',
      content,
      createdAt,
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

  async handleFailure(
    userId: string,
    sessionId: string,
    error: unknown,
    options: { publishDone?: boolean } = {},
  ) {
    const message = error instanceof Error ? error.message : '处理失败';
    await this.emitStored(userId, sessionId, {
      id: createEventId(),
      sessionId,
      kind: 'error',
      message,
      createdAt: now(),
    });
    if (options.publishDone ?? true) {
      this.publish(sessionId, {
        id: createEventId(),
        event: 'done',
        data: {},
      });
    }
  }

  private publish(sessionId: string, event: SSEvent) {
    this.streamHub.publish(sessionId, event);
  }

  private getRuntimePersistence(userId: string, sessionId: string) {
    return new FileRuntimePersistence(getSessionTurnRuntimePath(this.config, userId, sessionId));
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
      return;
    }

    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Turn interrupted', 'AbortError');
  }
}
