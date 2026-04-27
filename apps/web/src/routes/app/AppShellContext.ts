import { useOutletContext } from 'react-router-dom';

export interface AppShellOutletValue {
  /** Surfaces an error to the user via toast. Pass null to no-op. */
  setPageError: (message: string | null) => void;
  openCreateSessionDialog: () => void;
  openSidebarSheet: () => void;
  openInspectorSheet: (tab: 'files' | 'skills') => void;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  logoutPending: boolean;
  sessionActionPending: boolean;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  activeSkills: string[];
  hasActiveSession: boolean;
  onToggleSkill: (skillName: string) => void;
  toggleSkillPending: boolean;
}

export const useAppShellOutlet = () => useOutletContext<AppShellOutletValue>();
