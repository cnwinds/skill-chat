import { create } from 'zustand';
import type {
  ErrorEvent,
  RuntimeInputPreview,
  SessionRuntimeRecovery,
  SessionRuntimeSnapshot,
  StoredEvent,
  TokenCountPayload,
  ThinkingEvent,
  ToolCallEvent,
  ToolProgressEvent,
  ToolResultEvent,
  TurnCompletedPayload,
  TurnKind,
  TurnLifecyclePayload,
  TurnPhase,
  TurnStatus,
  UserMessageCommittedPayload,
} from '@skillchat/shared';

type StreamStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

type SessionStreamState = {
  pendingText: string;
  transientEvents: StoredEvent[];
  status: StreamStatus;
  lastError: string | null;
  reconnectAttempt: number | null;
  reconnectLimit: number | null;
  activeTurnId: string | null;
  activeTurnKind: TurnKind | null;
  activeTurnStatus: TurnStatus | null;
  activeTurnPhase: TurnPhase | null;
  activeTurnPhaseStartedAt: string | null;
  activeTurnStartedAt: string | null;
  activeTurnCanSteer: boolean;
  activeTurnRound: number | null;
  reasoningSummary: string;
  currentTurnTokenUsage: TokenCountPayload | null;
  followUpQueue: RuntimeInputPreview[];
  removedFollowUpInputIds: string[];
  recovery: SessionRuntimeRecovery | null;
};

type MobilePanel = 'sessions' | 'files' | 'skills' | null;

type UiState = {
  activeSessionId: string | null;
  mobilePanel: MobilePanel;
  drafts: Record<string, string>;
  streams: Record<string, SessionStreamState>;
  setActiveSessionId: (sessionId: string | null) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  setDraft: (sessionId: string, value: string) => void;
  appendTextDelta: (sessionId: string, chunk: string) => void;
  pushThinking: (sessionId: string, event: ThinkingEvent) => void;
  pushToolCall: (sessionId: string, event: ToolCallEvent) => void;
  pushToolProgress: (sessionId: string, event: ToolProgressEvent) => void;
  pushToolResult: (sessionId: string, event: ToolResultEvent) => void;
  appendReasoningDelta: (sessionId: string, content: string) => void;
  setCurrentTurnTokenUsage: (sessionId: string, usage: TokenCountPayload) => void;
  pushError: (sessionId: string, event: ErrorEvent) => void;
  setStreamStatus: (
    sessionId: string,
    status: StreamStatus,
    options?: {
      lastError?: string | null;
      reconnectAttempt?: number | null;
      reconnectLimit?: number | null;
    },
  ) => void;
  hydrateRuntime: (sessionId: string, snapshot: SessionRuntimeSnapshot) => void;
  applyTurnStarted: (sessionId: string, payload: TurnLifecyclePayload) => void;
  applyTurnStatus: (sessionId: string, payload: TurnLifecyclePayload) => void;
  applyUserMessageCommitted: (sessionId: string, payload: UserMessageCommittedPayload) => void;
  applyTurnCompleted: (sessionId: string, payload: TurnCompletedPayload) => void;
  confirmRemovedFollowUpInput: (sessionId: string, inputId: string) => void;
  clearStreamContent: (sessionId: string) => void;
  resetStream: (sessionId: string) => void;
};

const emptyStream = (): SessionStreamState => ({
  pendingText: '',
  transientEvents: [],
  status: 'idle',
  lastError: null,
  reconnectAttempt: null,
  reconnectLimit: null,
  activeTurnId: null,
  activeTurnKind: null,
  activeTurnStatus: null,
  activeTurnPhase: null,
  activeTurnPhaseStartedAt: null,
  activeTurnStartedAt: null,
  activeTurnCanSteer: false,
  activeTurnRound: null,
  reasoningSummary: '',
  currentTurnTokenUsage: null,
  followUpQueue: [],
  removedFollowUpInputIds: [],
  recovery: null,
});

const filterFollowUpQueue = (queue: RuntimeInputPreview[], removedInputIds: string[]) => (
  removedInputIds.length === 0
    ? queue
    : queue.filter((input) => !removedInputIds.includes(input.inputId))
);

const shouldIgnoreStaleIdleSnapshot = (
  current: SessionStreamState,
  snapshot: SessionRuntimeSnapshot,
) => (
  snapshot.activeTurn === null &&
  snapshot.followUpQueue.length === 0 &&
  snapshot.recovery === null &&
  (
    current.activeTurnId !== null ||
    current.pendingText.length > 0 ||
    current.transientEvents.length > 0
  )
);

const mutateStream = (
  streams: Record<string, SessionStreamState>,
  sessionId: string,
  updater: (current: SessionStreamState) => SessionStreamState,
) => ({
  ...streams,
  [sessionId]: updater(streams[sessionId] ?? emptyStream()),
});

export const useUiStore = create<UiState>((set) => ({
  activeSessionId: null,
  mobilePanel: null,
  drafts: {},
  streams: {},
  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  setMobilePanel: (panel) => set({ mobilePanel: panel }),
  setDraft: (sessionId, value) => set((state) => ({
    drafts: {
      ...state.drafts,
      [sessionId]: value,
    },
  })),
  appendTextDelta: (sessionId, chunk) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      pendingText: `${current.pendingText}${chunk}`,
      transientEvents: current.transientEvents.filter((event) => event.kind !== 'thinking'),
      lastError: null,
    })),
  })),
  pushThinking: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: null,
    })),
  })),
  pushToolCall: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: null,
    })),
  })),
  pushToolProgress: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: null,
    })),
  })),
  pushToolResult: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: null,
    })),
  })),
  appendReasoningDelta: (sessionId, content) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      reasoningSummary: `${current.reasoningSummary}${content}`,
      lastError: null,
    })),
  })),
  setCurrentTurnTokenUsage: (sessionId, usage) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      currentTurnTokenUsage: usage,
      lastError: null,
    })),
  })),
  pushError: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: event.message,
    })),
  })),
  setStreamStatus: (sessionId, status, options) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      status,
      lastError: options?.lastError ?? null,
      reconnectAttempt: options?.reconnectAttempt ?? null,
      reconnectLimit: options?.reconnectLimit ?? null,
    })),
  })),
  hydrateRuntime: (sessionId, snapshot) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...(shouldIgnoreStaleIdleSnapshot(current, snapshot)
        ? current
        : {
          ...current,
          pendingText: snapshot.activeTurn ? current.pendingText : '',
          transientEvents: snapshot.activeTurn ? current.transientEvents : [],
          activeTurnId: snapshot.activeTurn?.turnId ?? null,
          activeTurnKind: snapshot.activeTurn?.kind ?? null,
          activeTurnStatus: snapshot.activeTurn?.status ?? null,
          activeTurnPhase: snapshot.activeTurn?.phase ?? null,
          activeTurnPhaseStartedAt: snapshot.activeTurn?.phaseStartedAt ?? null,
          activeTurnStartedAt: snapshot.activeTurn?.startedAt ?? null,
          activeTurnCanSteer: snapshot.activeTurn?.canSteer ?? false,
          activeTurnRound: snapshot.activeTurn?.round ?? null,
          followUpQueue: filterFollowUpQueue(snapshot.followUpQueue, current.removedFollowUpInputIds),
          recovery: snapshot.recovery,
        }),
    })),
  })),
  applyTurnStarted: (sessionId, payload) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      activeTurnId: payload.turnId,
      activeTurnKind: payload.kind,
      activeTurnStatus: payload.status,
      activeTurnPhase: payload.phase,
      activeTurnPhaseStartedAt: payload.phaseStartedAt,
      activeTurnStartedAt: payload.startedAt ?? current.activeTurnStartedAt,
      activeTurnCanSteer: payload.canSteer,
      activeTurnRound: payload.round,
      reasoningSummary: '',
      currentTurnTokenUsage: null,
      pendingText: '',
      transientEvents: payload.turnId === current.activeTurnId ? current.transientEvents : [],
      recovery: null,
    })),
  })),
  applyTurnStatus: (sessionId, payload) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => {
      if (current.activeTurnId && current.activeTurnId !== payload.turnId) {
        return current;
      }

      return {
        ...current,
        activeTurnId: payload.turnId,
        activeTurnKind: payload.kind,
        activeTurnStatus: payload.status,
        activeTurnPhase: payload.phase,
        activeTurnPhaseStartedAt: payload.phaseStartedAt,
        activeTurnStartedAt: payload.startedAt ?? current.activeTurnStartedAt,
        activeTurnCanSteer: payload.canSteer,
        activeTurnRound: payload.round,
      };
    }),
  })),
  applyUserMessageCommitted: (sessionId, payload) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      followUpQueue: current.followUpQueue.filter((input) => !(
        payload.consumedInputIds?.includes(input.inputId) ?? input.inputId === payload.inputId
      )),
      removedFollowUpInputIds: current.removedFollowUpInputIds.filter((inputId) => !(
        payload.consumedInputIds?.includes(inputId) ?? inputId === payload.inputId
      )),
    })),
  })),
  applyTurnCompleted: (sessionId, payload) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => {
      if (current.activeTurnId !== payload.turnId) {
        return current;
      }

      return {
        ...current,
        activeTurnStatus: payload.status,
        activeTurnId: null,
        activeTurnKind: null,
        activeTurnPhase: null,
        activeTurnPhaseStartedAt: null,
        activeTurnCanSteer: false,
        activeTurnRound: null,
      };
    }),
  })),
  confirmRemovedFollowUpInput: (sessionId, inputId) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      followUpQueue: current.followUpQueue.filter((input) => input.inputId !== inputId),
      removedFollowUpInputIds: current.removedFollowUpInputIds.includes(inputId)
        ? current.removedFollowUpInputIds
        : [...current.removedFollowUpInputIds, inputId],
    })),
  })),
  clearStreamContent: (sessionId) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      pendingText: '',
      transientEvents: [],
      activeTurnStartedAt: null,
      reasoningSummary: '',
      currentTurnTokenUsage: null,
      lastError: null,
    })),
  })),
  resetStream: (sessionId) => set((state) => ({
    streams: {
      ...state.streams,
      [sessionId]: emptyStream(),
    },
  })),
}));
