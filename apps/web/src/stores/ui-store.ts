import { create } from 'zustand';
import type { ErrorEvent, StoredEvent, ThinkingEvent, ToolCallEvent, ToolProgressEvent, ToolResultEvent } from '@skillchat/shared';

type StreamStatus = 'idle' | 'connecting' | 'open' | 'error';

type SessionStreamState = {
  pendingText: string;
  transientEvents: StoredEvent[];
  status: StreamStatus;
  lastError: string | null;
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
  pushError: (sessionId: string, event: ErrorEvent) => void;
  setStreamStatus: (sessionId: string, status: StreamStatus, lastError?: string | null) => void;
  clearStreamContent: (sessionId: string) => void;
  resetStream: (sessionId: string) => void;
};

const emptyStream = (): SessionStreamState => ({
  pendingText: '',
  transientEvents: [],
  status: 'idle',
  lastError: null,
});

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
  pushError: (sessionId, event) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      transientEvents: [...current.transientEvents, event],
      lastError: event.message,
    })),
  })),
  setStreamStatus: (sessionId, status, lastError = null) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      status,
      lastError,
    })),
  })),
  clearStreamContent: (sessionId) => set((state) => ({
    streams: mutateStream(state.streams, sessionId, (current) => ({
      ...current,
      pendingText: '',
      transientEvents: [],
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
