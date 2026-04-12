import { create } from 'zustand';
import type { UserPreferenceSettings } from '@skillchat/shared';

type PreferenceState = UserPreferenceSettings & {
  setThemeMode: (themeMode: 'light' | 'dark') => void;
};

export const applyThemeMode = (themeMode: 'light' | 'dark') => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = themeMode;
};

export const usePreferencesStore = create<PreferenceState>((set) => ({
  themeMode: 'dark',
  setThemeMode: (themeMode) => {
    applyThemeMode(themeMode);
    set({ themeMode });
  },
}));
