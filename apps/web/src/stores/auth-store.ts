import { create } from 'zustand';
import type { UserSummary } from '@skillchat/shared';

type AuthState = {
  user: UserSummary | null;
  ready: boolean;
  setAuthenticated: (user: UserSummary) => void;
  setAnonymous: () => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  ready: false,
  setAuthenticated: (user) => {
    set({
      user,
      ready: true,
    });
  },
  setAnonymous: () => {
    set({
      user: null,
      ready: true,
    });
  },
}));
