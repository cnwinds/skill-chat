import { create } from 'zustand';

type MobilePanel = 'sessions' | 'files' | 'skills' | null;

export type SessionScrollState = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  wasAtBottom: boolean;
};

type UiState = {
  activeSessionId: string | null;
  mobilePanel: MobilePanel;
  drafts: Record<string, string>;
  sessionScrollStates: Record<string, SessionScrollState>;
  setActiveSessionId: (sessionId: string | null) => void;
  setMobilePanel: (panel: MobilePanel) => void;
  setDraft: (sessionId: string, value: string) => void;
  setSessionScrollState: (sessionId: string, scrollState: SessionScrollState) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeSessionId: null,
  mobilePanel: null,
  drafts: {},
  sessionScrollStates: {},
  setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
  setMobilePanel: (panel) => set({ mobilePanel: panel }),
  setDraft: (sessionId, value) => set((state) => ({
    drafts: {
      ...state.drafts,
      [sessionId]: value,
    },
  })),
  setSessionScrollState: (sessionId, scrollState) => set((state) => ({
    sessionScrollStates: {
      ...state.sessionScrollStates,
      [sessionId]: scrollState,
    },
  })),
}));
