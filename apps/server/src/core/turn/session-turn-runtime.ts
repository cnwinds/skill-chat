import { nanoid } from 'nanoid';
import type {
  MessageDispatchResponse,
  RuntimeInputPreview,
  SessionRuntimeSnapshot,
  TurnCompletedPayload,
  TurnKind,
  TurnLifecyclePayload,
  UserMessageCommittedPayload,
} from '@skillchat/shared';
import type {
  ActiveTurnState,
  PersistedRuntimeInput,
  PersistedRuntimeState,
  QueuedRuntimeInput,
  RuntimeCallbacks,
  RuntimeInput,
  RuntimePersistence,
  TurnDispatchArgs,
  TurnDispatchResult,
  TurnExecutionContext,
  TurnUserContext,
} from './turn-types.js';

const now = () => new Date().toISOString();
const createEventId = () => `evt_${nanoid()}`;
const createTurnId = () => `turn_${nanoid()}`;
const createInputId = () => `input_${nanoid()}`;

const reviewTurnPattern = /^\/review(?:\s|$)/i;
const compactTurnPattern = /^\/compact(?:\s|$)/i;
const maintenanceTurnPattern = /^\/maintenance(?:\s|$)/i;

const inferTurnKind = (content: string, requestedKind?: TurnKind): TurnKind => {
  if (requestedKind) {
    return requestedKind;
  }

  const normalized = content.trim();
  if (reviewTurnPattern.test(normalized)) {
    return 'review';
  }
  if (compactTurnPattern.test(normalized)) {
    return 'compact';
  }
  if (maintenanceTurnPattern.test(normalized)) {
    return 'maintenance';
  }
  return 'regular';
};

const isAbortLikeError = (error: unknown) => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }

  if (error instanceof Error && /abort|interrupted/i.test(error.message)) {
    return true;
  }

  return false;
};

const createInterruptedError = () => new DOMException('Turn interrupted', 'AbortError');

const toPreview = (
  input: PersistedRuntimeInput | RuntimeInput,
): RuntimeInputPreview => ({
  inputId: input.inputId,
  content: input.content,
  createdAt: input.createdAt,
});

const toPersistedInput = (input: RuntimeInput): PersistedRuntimeInput => ({
  inputId: input.inputId,
  content: input.content,
  createdAt: input.createdAt,
  source: input.source === 'steer' ? 'steer' : 'queued',
  requestedKind: input.requestedKind,
  attachmentIds: input.attachmentIds,
  turnConfig: input.turnConfig,
});

const fromPersistedInput = (input: PersistedRuntimeInput): QueuedRuntimeInput => ({
  inputId: input.inputId,
  content: input.content,
  createdAt: input.createdAt,
  source: input.source,
  requestedKind: input.requestedKind,
  attachmentIds: input.attachmentIds,
  turnConfig: input.turnConfig,
});

export class SessionTurnRuntime {
  private activeTurn: ActiveTurnState | null = null;
  private queuedInputs: QueuedRuntimeInput[] = [];
  private lastUser: TurnUserContext | null = null;
  private recovery: SessionRuntimeSnapshot['recovery'] = null;

  constructor(
    private readonly sessionId: string,
    private readonly callbacks: RuntimeCallbacks,
    private readonly persistence: RuntimePersistence,
    initialState?: PersistedRuntimeState | null,
    private readonly onBecameIdle?: () => void,
  ) {
    this.restoreFromState(initialState ?? null);
  }

  isIdle() {
    return this.activeTurn === null && this.queuedInputs.length === 0 && this.recovery === null;
  }

  getSnapshot(): SessionRuntimeSnapshot {
    return {
      sessionId: this.sessionId,
      activeTurn: this.activeTurn
        ? {
            turnId: this.activeTurn.turnId,
            kind: this.activeTurn.kind,
            status: this.activeTurn.status,
            phase: this.activeTurn.phase,
            phaseStartedAt: this.activeTurn.phaseStartedAt,
            canSteer: this.activeTurn.canSteer,
            startedAt: this.activeTurn.startedAt,
            round: this.activeTurn.round,
          }
        : null,
      followUpQueue: [
        ...(this.activeTurn?.pendingInputs.map((input) => toPreview(input)) ?? []),
        ...this.queuedInputs.map((input) => toPreview(input)),
      ],
      recovery: this.recovery,
    };
  }

  async dispatchMessage(args: TurnDispatchArgs): Promise<TurnDispatchResult> {
    this.lastUser = args.user;
    const requestedKind = inferTurnKind(args.content, args.kind);
    const activeTurn = this.activeTurn;

    if (!activeTurn) {
      return this.startTurn(args.user, this.createInput(args.content, 'direct', requestedKind, args.turnConfig, args.attachmentIds));
    }

    const mode = args.mode ?? 'auto';
    const canAcceptSteer = (
      mode !== 'new_turn' &&
      mode !== 'queue_next' &&
      this.queuedInputs.length === 0 &&
      activeTurn.kind === 'regular' &&
      activeTurn.status === 'running' &&
      activeTurn.canSteer &&
      (!args.turnId || args.turnId === activeTurn.turnId)
    );

    if (canAcceptSteer) {
      activeTurn.pendingInputs.push(this.createInput(args.content, 'steer', requestedKind, args.turnConfig, args.attachmentIds));
      await this.persistSnapshot();
      this.publishTurnStatus(activeTurn);
      return {
        response: this.toDispatchResponse({
          accepted: true,
          dispatch: 'steer_accepted',
          messageId: activeTurn.pendingInputs[activeTurn.pendingInputs.length - 1]!.inputId,
          runId: activeTurn.turnId,
          turnId: activeTurn.turnId,
          inputId: activeTurn.pendingInputs[activeTurn.pendingInputs.length - 1]!.inputId,
          runtime: this.getSnapshot(),
        }),
      };
    }

    const queuedInput = this.createInput(
      args.content,
      mode === 'steer' ? 'steer' : 'queued',
      requestedKind,
      args.turnConfig,
      args.attachmentIds,
    );
    this.queuedInputs.push(queuedInput);
    await this.persistSnapshot();
    return {
      response: this.toDispatchResponse({
        accepted: true,
        dispatch: 'queued',
        messageId: queuedInput.inputId,
        runId: `queued_${queuedInput.inputId}`,
        inputId: queuedInput.inputId,
        runtime: this.getSnapshot(),
      }),
    };
  }

  async steerTurn(user: TurnUserContext, turnId: string, content: string) {
    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      throw new Error('当前 turn 不存在');
    }

    return this.dispatchMessage({
      user,
      content,
      mode: 'steer',
      turnId,
    });
  }

  async interruptTurn(user: TurnUserContext, turnId: string) {
    this.lastUser = user;

    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      throw new Error('当前 turn 不存在');
    }

    const pendingInputs = this.activeTurn.pendingInputs.splice(0);
    if (pendingInputs.length > 0) {
      this.queuedInputs = [...pendingInputs, ...this.queuedInputs];
    }

    this.activeTurn.status = 'interrupting';
    this.activeTurn.phase = 'non_steerable';
    this.activeTurn.phaseStartedAt = now();
    this.activeTurn.canSteer = false;
    await this.persistSnapshot();
    this.publishTurnStatus(this.activeTurn);
    this.activeTurn.controller.abort(createInterruptedError());

    return {
      accepted: true,
      turnId,
      runtime: this.getSnapshot(),
    };
  }

  async removeFollowUpInput(user: TurnUserContext, inputId: string) {
    this.lastUser = user;

    let removed = false;
    if (this.activeTurn) {
      const nextPendingInputs = this.activeTurn.pendingInputs.filter((input) => input.inputId !== inputId);
      if (nextPendingInputs.length !== this.activeTurn.pendingInputs.length) {
        this.activeTurn.pendingInputs = nextPendingInputs;
        removed = true;
      }
    }

    const nextQueuedInputs = this.queuedInputs.filter((input) => input.inputId !== inputId);
    if (nextQueuedInputs.length !== this.queuedInputs.length) {
      this.queuedInputs = nextQueuedInputs;
      removed = true;
    }

    if (!removed) {
      throw new Error('待处理输入不存在');
    }

    await this.persistOrClearSnapshot();
    if (this.activeTurn) {
      this.publishTurnStatus(this.activeTurn);
    } else if (this.isIdle()) {
      this.onBecameIdle?.();
    }

    return {
      accepted: true,
      inputId,
      runtime: this.getSnapshot(),
    };
  }

  private createInput(
    content: string,
    source: RuntimeInput['source'],
    requestedKind: TurnKind,
    turnConfig?: RuntimeInput['turnConfig'],
    attachmentIds?: string[],
  ): RuntimeInput {
    return {
      inputId: createInputId(),
      content,
      createdAt: now(),
      source,
      requestedKind,
      attachmentIds: attachmentIds && attachmentIds.length > 0 ? [...new Set(attachmentIds)] : undefined,
      turnConfig,
    };
  }

  private combineInputs(inputs: RuntimeInput[]): RuntimeInput {
    if (inputs.length === 1) {
      return {
        ...inputs[0]!,
        consumedInputIds: [inputs[0]!.inputId],
      };
    }

    const last = inputs[inputs.length - 1]!;
    return {
      inputId: createInputId(),
      content: inputs.map((input) => input.content.trim()).filter(Boolean).join('\n'),
      createdAt: last.createdAt,
      source: last.source,
      requestedKind: last.requestedKind,
      attachmentIds: [...new Set(inputs.flatMap((input) => input.attachmentIds ?? []))],
      turnConfig: last.turnConfig,
      consumedInputIds: inputs.map((input) => input.inputId),
    };
  }

  private async startTurn(user: TurnUserContext, input: RuntimeInput): Promise<TurnDispatchResult> {
    this.recovery = null;
    const startedAt = now();
    const turn: ActiveTurnState = {
      turnId: createTurnId(),
      kind: input.requestedKind,
      status: 'running',
      phase: input.requestedKind === 'regular' ? 'sampling' : 'non_steerable',
      phaseStartedAt: startedAt,
      canSteer: input.requestedKind === 'regular',
      startedAt,
      round: 1,
      pendingInputs: [],
      controller: new AbortController(),
    };

    this.activeTurn = turn;
    await this.persistSnapshot();
    await this.callbacks.onInputCommitted({
      user,
      turnId: turn.turnId,
      kind: turn.kind,
      input,
    });
    this.publishTurnStarted(turn);
    this.publishUserMessageCommitted(turn.turnId, input, input.consumedInputIds ?? [input.inputId]);

    const task = this.executeTurn(user, turn, input);
    // HTTP dispatch usually returns before the background turn finishes.
    // Keep the original failing task observable to explicit awaiters, but
    // attach a noop rejection handler so provider-side failures do not crash
    // the process via an unhandled rejection.
    void task.catch(() => undefined);
    turn.task = task;

    return {
      response: this.toDispatchResponse({
        accepted: true,
        dispatch: 'turn_started',
        messageId: input.inputId,
        runId: turn.turnId,
        turnId: turn.turnId,
        inputId: input.inputId,
        runtime: this.getSnapshot(),
      }),
      task,
    };
  }

  private async executeTurn(user: TurnUserContext, turn: ActiveTurnState, initialInput: RuntimeInput) {
    let finalStatus: ActiveTurnState['status'] = 'completed';
    let failure: unknown;

    try {
      await this.callbacks.onExecuteTurn(this.createExecutionContext(user, turn, initialInput));
      if (turn.controller.signal.aborted) {
        finalStatus = 'interrupted';
      }
    } catch (error) {
      if (turn.controller.signal.aborted || isAbortLikeError(error)) {
        finalStatus = 'interrupted';
      } else {
        finalStatus = 'failed';
        failure = error;
        await this.callbacks.onTurnFailure({
          user,
          turnId: turn.turnId,
          error,
        });
      }
    } finally {
      if (this.activeTurn?.turnId !== turn.turnId) {
        return;
      }

      turn.status = finalStatus;
      turn.canSteer = false;
      if (finalStatus !== 'completed') {
        turn.phase = 'non_steerable';
      }
      this.publishTurnCompleted(turn.turnId, turn.kind, finalStatus);
      this.callbacks.publish({
        id: createEventId(),
        event: 'done',
        data: {},
      });

      this.activeTurn = null;
      await this.persistOrClearSnapshot();
      await this.startNextQueuedTurn();
      await this.persistOrClearSnapshot();

      if (this.isIdle()) {
        this.onBecameIdle?.();
      }
    }

    if (finalStatus === 'failed') {
      throw failure instanceof Error ? failure : new Error('Turn failed');
    }
  }

  private createExecutionContext(
    user: TurnUserContext,
    turn: ActiveTurnState,
    initialInput: RuntimeInput,
  ): TurnExecutionContext {
    return {
      user,
      turnId: turn.turnId,
      kind: turn.kind,
      initialInput,
      signal: turn.controller.signal,
      updatePhase: (phase) => {
        if (!this.activeTurn || this.activeTurn.turnId !== turn.turnId) {
          return;
        }
        if (this.activeTurn.phase === phase) {
          return;
        }
        this.activeTurn.phase = phase;
        this.activeTurn.phaseStartedAt = now();
        void this.persistSnapshot();
        this.publishTurnStatus(this.activeTurn);
      },
      setCanSteer: (canSteer) => {
        if (!this.activeTurn || this.activeTurn.turnId !== turn.turnId) {
          return;
        }
        if (this.activeTurn.canSteer === canSteer) {
          return;
        }
        this.activeTurn.canSteer = canSteer;
        void this.persistSnapshot();
        this.publishTurnStatus(this.activeTurn);
      },
      setRound: (round) => {
        if (!this.activeTurn || this.activeTurn.turnId !== turn.turnId) {
          return;
        }
        if (this.activeTurn.round === round) {
          return;
        }
        this.activeTurn.round = round;
        this.activeTurn.phaseStartedAt = now();
        void this.persistSnapshot();
        this.publishTurnStatus(this.activeTurn);
      },
      drainPendingInputs: async () => this.drainPendingInputs(user, turn.turnId),
      isAborted: () => turn.controller.signal.aborted,
      throwIfAborted: () => {
        if (turn.controller.signal.aborted) {
          throw turn.controller.signal.reason instanceof Error ? turn.controller.signal.reason : createInterruptedError();
        }
      },
    };
  }

  private async drainPendingInputs(user: TurnUserContext, turnId: string) {
    if (!this.activeTurn || this.activeTurn.turnId !== turnId) {
      return [] as RuntimeInput[];
    }

    const drained = this.activeTurn.pendingInputs.splice(0);
    if (drained.length === 0) {
      return [] as RuntimeInput[];
    }

    const mergedInput = this.combineInputs(drained);
    await this.callbacks.onInputCommitted({
      user,
      turnId,
      kind: this.activeTurn.kind,
      input: mergedInput,
    });
    this.publishUserMessageCommitted(turnId, mergedInput, drained.map((input) => input.inputId));
    if (drained.length > 0 && this.activeTurn) {
      await this.persistSnapshot();
      this.publishTurnStatus(this.activeTurn);
    }
    return [mergedInput];
  }

  private async startNextQueuedTurn() {
    if (this.activeTurn || this.queuedInputs.length === 0 || !this.lastUser) {
      return;
    }

    const nextInput = this.combineInputs(this.queuedInputs.splice(0));
    await this.startTurn(this.lastUser, nextInput);
  }

  private publishTurnStarted(turn: ActiveTurnState) {
    const payload: TurnLifecyclePayload = {
      turnId: turn.turnId,
      kind: turn.kind,
      status: turn.status,
      phase: turn.phase,
      phaseStartedAt: turn.phaseStartedAt,
      canSteer: turn.canSteer,
      startedAt: turn.startedAt,
      round: turn.round,
      followUpQueueCount: turn.pendingInputs.length + this.queuedInputs.length,
    };
    this.callbacks.publish({
      id: createEventId(),
      event: 'turn_started',
      data: payload,
    });
  }

  private publishTurnStatus(turn: ActiveTurnState) {
    const payload: TurnLifecyclePayload = {
      turnId: turn.turnId,
      kind: turn.kind,
      status: turn.status,
      phase: turn.phase,
      phaseStartedAt: turn.phaseStartedAt,
      canSteer: turn.canSteer,
      startedAt: turn.startedAt,
      round: turn.round,
      followUpQueueCount: turn.pendingInputs.length + this.queuedInputs.length,
    };
    this.callbacks.publish({
      id: createEventId(),
      event: 'turn_status',
      data: payload,
    });
  }

  private publishUserMessageCommitted(turnId: string, input: RuntimeInput, consumedInputIds: string[]) {
    const payload: UserMessageCommittedPayload = {
      turnId,
      inputId: input.inputId,
      content: input.content,
      createdAt: input.createdAt,
      consumedInputIds,
    };
    this.callbacks.publish({
      id: createEventId(),
      event: 'user_message_committed',
      data: payload,
    });
  }

  private publishTurnCompleted(turnId: string, kind: TurnKind, status: ActiveTurnState['status']) {
    const payload: TurnCompletedPayload = {
      turnId,
      kind,
      status,
    };
    this.callbacks.publish({
      id: createEventId(),
      event: 'turn_completed',
      data: payload,
    });
  }

  private restoreFromState(state: PersistedRuntimeState | null) {
    if (!state) {
      return;
    }

    this.queuedInputs = state.queuedInputs.map(fromPersistedInput);
    this.recovery = state.recovery;

    if (!state.activeTurn) {
      return;
    }

    this.recovery = {
      recoveredAt: now(),
      previousTurnId: state.activeTurn.turnId,
      previousTurnKind: state.activeTurn.kind,
      reason: 'process_restarted',
    };
    this.queuedInputs = [
      ...state.activeTurn.pendingInputs.map(fromPersistedInput),
      ...this.queuedInputs,
    ];

    void this.persistSnapshot();
  }

  private toPersistedState(): PersistedRuntimeState {
    return {
      sessionId: this.sessionId,
      activeTurn: this.activeTurn
        ? {
            turnId: this.activeTurn.turnId,
            kind: this.activeTurn.kind,
            status: this.activeTurn.status === 'interrupting' ? 'interrupting' : 'running',
            phase: this.activeTurn.phase,
            phaseStartedAt: this.activeTurn.phaseStartedAt,
            canSteer: this.activeTurn.canSteer,
            startedAt: this.activeTurn.startedAt,
            round: this.activeTurn.round,
            pendingInputs: this.activeTurn.pendingInputs.map(toPersistedInput),
          }
        : null,
      queuedInputs: this.queuedInputs.map(toPersistedInput),
      recovery: this.recovery,
    };
  }

  private async persistSnapshot() {
    await this.persistence.save(this.toPersistedState());
  }

  private async persistOrClearSnapshot() {
    if (this.activeTurn || this.queuedInputs.length > 0 || this.recovery) {
      await this.persistSnapshot();
      return;
    }

    await this.persistence.clear();
  }

  private toDispatchResponse(payload: MessageDispatchResponse) {
    return payload;
  }
}
