import { create } from 'zustand';
import type { UserSummary } from '@skillchat/shared';

const STORAGE_KEY = 'skillchat-auth';

type AuthState = {
  token: string | null;
  user: UserSummary | null;
  setAuth: (payload: { token: string; user: UserSummary }) => void;
  logout: () => void;
};

const readInitialState = () => {
  if (typeof window === 'undefined') {
    return {
      token: null,
      user: null,
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { token: null, user: null };
    }
    const parsed = JSON.parse(raw) as { token: string; user: UserSummary };
    return parsed;
  } catch {
    return { token: null, user: null };
  }
};

const persist = (state: { token: string | null; user: UserSummary | null }) => {
  if (typeof window === 'undefined') {
    return;
  }

  if (!state.token || !state.user) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const useAuthStore = create<AuthState>((set) => ({
  ...readInitialState(),
  setAuth: ({ token, user }) => {
    persist({ token, user });
    set({ token, user });
  },
  logout: () => {
    persist({ token: null, user: null });
    set({ token: null, user: null });
  },
}));
