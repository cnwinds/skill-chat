import { useOutletContext } from 'react-router-dom';
import type { Dispatch, SetStateAction } from 'react';

export interface AppShellOutletValue {
  pageError: string | null;
  setPageError: Dispatch<SetStateAction<string | null>>;
  openCreateSessionDialog: () => void;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  logoutPending: boolean;
  setMobilePanel: (panel: 'sessions' | 'files' | 'skills' | null) => void;
  mobilePanel: 'sessions' | 'files' | 'skills' | null;
  setInspectorTab: (tab: 'files' | 'skills') => void;
}

export const useAppShellOutlet = () => useOutletContext<AppShellOutletValue>();
