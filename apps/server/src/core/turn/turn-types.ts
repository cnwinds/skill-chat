import type {
  MessageDispatchMode,
  MessageDispatchResponse,
  MessageDispatchResult,
  SessionRuntimeRecovery,
  SessionRuntimeSnapshot,
  TurnConfig,
  TurnKind,
  TurnPhase,
  TurnStatus,
} from '@skillchat/shared';

export type TurnUserContext = {
  id: string;
  username: string;
  role: 'admin' | 'member';
};

export type RuntimeInput = {
  inputId: string;
  content: string;
  createdAt: string;
  source: 'direct' | 'steer' | 'queued';
  requestedKind: TurnKind;
  turnConfig?: TurnConfig;
  consumedInputIds?: string[];
};

export type QueuedRuntimeInput = RuntimeInput;

export type TurnExecutionContext = {
  user: TurnUserContext;
  turnId: string;
  kind: TurnKind;
  initialInput: RuntimeInput;
  signal: AbortSignal;
  updatePhase: (phase: TurnPhase) => void;
  setCanSteer: (canSteer: boolean) => void;
  setRound: (round: number) => void;
  drainPendingInputs: () => Promise<RuntimeInput[]>;
  isAborted: () => boolean;
  throwIfAborted: () => void;
};

export type TurnDispatchArgs = {
  user: TurnUserContext;
  content: string;
  mode?: MessageDispatchMode;
  turnId?: string;
  kind?: TurnKind;
  turnConfig?: TurnConfig;
};

export type TurnDispatchResult = {
  response: MessageDispatchResponse;
  task?: Promise<void>;
};

export type RuntimeCallbacks = {
  onInputCommitted: (args: {
    user: TurnUserContext;
    turnId: string;
    kind: TurnKind;
    input: RuntimeInput;
  }) => Promise<void>;
  onExecuteTurn: (args: TurnExecutionContext) => Promise<void>;
  onTurnFailure: (args: {
    user: TurnUserContext;
    turnId: string;
    error: unknown;
  }) => Promise<void>;
  publish: (event: {
    id: string;
    event: string;
    data: unknown;
  }) => void;
};

export type ActiveTurnState = {
  turnId: string;
  kind: TurnKind;
  status: TurnStatus;
  phase: TurnPhase;
  phaseStartedAt: string;
  canSteer: boolean;
  startedAt: string;
  round: number;
  pendingInputs: RuntimeInput[];
  controller: AbortController;
  task?: Promise<void>;
};

export type PersistedRuntimeInput = {
  inputId: string;
  content: string;
  createdAt: string;
  source: 'steer' | 'queued';
  requestedKind: TurnKind;
  turnConfig?: TurnConfig;
};

export type PersistedActiveTurnState = {
  turnId: string;
  kind: TurnKind;
  status: Extract<TurnStatus, 'running' | 'interrupting'>;
  phase: TurnPhase;
  phaseStartedAt: string;
  canSteer: boolean;
  startedAt: string;
  round: number;
  pendingInputs: PersistedRuntimeInput[];
};

export type PersistedRuntimeState = {
  sessionId: string;
  activeTurn: PersistedActiveTurnState | null;
  queuedInputs: PersistedRuntimeInput[];
  recovery: SessionRuntimeRecovery | null;
};

export type RuntimePersistence = {
  load: () => Promise<PersistedRuntimeState | null>;
  save: (snapshot: PersistedRuntimeState) => Promise<void>;
  clear: () => Promise<void>;
};

export type RuntimeSnapshotBuilder = (snapshot: SessionRuntimeSnapshot) => MessageDispatchResponse;
