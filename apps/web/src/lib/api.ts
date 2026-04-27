import type {
  AdminUserSummary,
  AuthResponse,
  FileBucket,
  FileRecord,
  FollowUpQueueMutationResponse,
  InviteCodeSummary,
  MessageDispatchRequest,
  MessageDispatchResponse,
  SessionRuntimeSnapshot,
  SessionSummary,
  SkillMetadata,
  StoredEvent,
  SystemSettings,
  SystemStatus,
  TurnInterruptResponse,
  UserPreferenceSettings,
} from '@skillchat/shared';
import { useAuthStore } from '../stores/auth-store';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export type SkillKind = 'instruction' | 'runtime' | 'hybrid';

export interface SkillAuthor {
  name: string;
  url?: string;
  email?: string;
}

export interface SkillManifestSummary {
  id: string;
  name: string;
  displayName?: string;
  version: string;
  kind: SkillKind;
  description: string;
  author: SkillAuthor;
  tags: string[];
  categories: string[];
  permissions: {
    filesystem: string[];
    network: boolean | { allowedHosts: string[] };
    scripts: boolean;
    secrets: string[];
  };
  runtime: {
    type: 'none' | 'python' | 'node' | 'shell';
    entrypoints: Array<{
      name: string;
      path: string;
      description?: string;
    }>;
  };
  starterPrompts: string[];
  license?: string;
  homepage?: string;
  repository?: string;
}

export interface MarketSkillSummary {
  id: string;
  name: string;
  displayName?: string;
  latestVersion: string;
  kind: SkillKind;
  description: string;
  author: SkillAuthor;
  tags: string[];
  categories: string[];
  updatedAt: string;
}

export interface MarketSkillListResponse {
  skills: MarketSkillSummary[];
}

export interface MarketSkillDetail {
  id: string;
  version: string;
  manifest: SkillManifestSummary;
  packageUrl: string;
  checksumSha256?: string;
  sizeBytes?: number;
  publishedAt: string;
}

export interface InstalledSkillRecord {
  id: string;
  version: string;
  manifest: SkillManifestSummary;
  installPath: string;
  sourceMarketUrl: string;
  status: 'installed' | 'disabled' | 'failed';
  installedAt: string;
  updatedAt: string;
}

export interface SkillInstallRequest {
  id: string;
  version?: string;
}

const createHeaders = (headers: HeadersInit = {}, body?: BodyInit | null) => {
  const merged = new Headers(headers);
  if (typeof body === 'string' && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  return merged;
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().setAnonymous();
    }
    let message = '请求失败';
    try {
      const payload = await response.json() as { message?: string };
      message = payload.message ?? message;
    } catch {
      // Ignore non-JSON errors.
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
};

const requestJson = async <T>(input: string, init: RequestInit = {}) => {
  const response = await fetch(input, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers: createHeaders(init.headers, init.body),
  });
  return parseResponse<T>(response);
};

const fetchFileBlob = async (fileId: string) => {
  const response = await fetch(`/api/files/${fileId}/download`, {
    credentials: 'include',
    headers: createHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().setAnonymous();
    }
    throw new ApiError('下载失败', response.status);
  }

  return await response.blob();
};

const fetchFilePreviewBlob = async (file: FileRecord) => {
  const response = await fetch(file.thumbnailUrl ?? `/api/files/${file.id}/thumbnail`, {
    credentials: 'include',
    headers: createHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      useAuthStore.getState().setAnonymous();
    }
    throw new ApiError('图片预览失败', response.status);
  }

  return await response.blob();
};

export const api = {
  getSystemStatus: () => requestJson<SystemStatus>('/api/system/status'),

  bootstrapAdmin: (payload: { username: string; password: string }) =>
    requestJson<AuthResponse>('/api/system/bootstrap-admin', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: { username: string; password: string; inviteCode?: string }) =>
    requestJson<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (payload: { username: string; password: string }) =>
    requestJson<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getAuthSession: async () => {
    try {
      return await requestJson<AuthResponse>('/api/auth/session');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return null;
      }
      throw error;
    }
  },

  logout: () =>
    requestJson<void>('/api/auth/logout', {
      method: 'POST',
    }),

  getMySettings: () => requestJson<UserPreferenceSettings>('/api/me/settings'),

  updateMySettings: (payload: UserPreferenceSettings) =>
    requestJson<UserPreferenceSettings>('/api/me/settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listSessions: () => requestJson<SessionSummary[]>('/api/sessions'),

  createSession: (payload: { title?: string; activeSkills?: string[] } = {}) =>
    requestJson<SessionSummary>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateSession: (sessionId: string, payload: { title?: string; activeSkills?: string[] }) =>
    requestJson<SessionSummary>(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteSession: (sessionId: string) =>
    requestJson<void>(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    }),

  listMessages: (sessionId: string) =>
    requestJson<StoredEvent[]>(`/api/sessions/${sessionId}/messages?limit=200`),

  sendMessage: (sessionId: string, payload: MessageDispatchRequest) =>
    requestJson<MessageDispatchResponse>(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  steerTurn: (sessionId: string, turnId: string, content: string) =>
    requestJson<MessageDispatchResponse>(`/api/sessions/${sessionId}/turns/${turnId}/steer`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  interruptTurn: (sessionId: string, turnId: string) =>
    requestJson<TurnInterruptResponse>(`/api/sessions/${sessionId}/turns/${turnId}/interrupt`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getSessionRuntime: (sessionId: string) =>
    requestJson<SessionRuntimeSnapshot>(`/api/sessions/${sessionId}/runtime`),

  removeFollowUpInput: (sessionId: string, inputId: string) =>
    requestJson<FollowUpQueueMutationResponse>(`/api/sessions/${sessionId}/runtime/queue/${inputId}`, {
      method: 'DELETE',
    }),

  listFiles: (params: { sessionId?: string; bucket?: FileBucket; type?: string } = {}) => {
    const query = new URLSearchParams();
    if (params.sessionId) {
      query.set('sessionId', params.sessionId);
    }
    if (params.bucket) {
      query.set('bucket', params.bucket);
    }
    if (params.type) {
      query.set('type', params.type);
    }
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return requestJson<FileRecord[]>(`/api/files${suffix}`);
  },

  uploadFile: async (sessionId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return requestJson<FileRecord>(`/api/files/${sessionId}/upload`, {
      method: 'POST',
      body: form,
    });
  },

  shareFile: (fileId: string) =>
    requestJson<FileRecord>(`/api/files/${fileId}/share`, {
      method: 'POST',
    }),

  listSkills: () => requestJson<SkillMetadata[]>('/api/skills'),

  listMarketSkills: async () => {
    const payload = await requestJson<MarketSkillListResponse>('/api/market/skills');
    return payload.skills;
  },

  getMarketSkillDetail: (id: string, version?: string) => {
    const [publisher, name] = id.split('/');
    if (!publisher || !name) {
      throw new Error(`Invalid skill id: ${id}`);
    }
    const query = version ? `?${new URLSearchParams({ version }).toString()}` : '';
    return requestJson<MarketSkillDetail>(
      `/api/market/skills/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}${query}`,
    );
  },

  listInstalledSkills: () => requestJson<InstalledSkillRecord[]>('/api/me/skills/installed'),

  installSkill: (payload: SkillInstallRequest) =>
    requestJson<InstalledSkillRecord>('/api/me/skills/install', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  uninstallSkill: (payload: SkillInstallRequest) => {
    const [publisher, name] = payload.id.split('/');
    if (!publisher || !name) {
      throw new Error(`Invalid skill id: ${payload.id}`);
    }
    const query = payload.version
      ? `?${new URLSearchParams({ version: payload.version }).toString()}`
      : '';
    return requestJson<InstalledSkillRecord>(
      `/api/me/skills/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}${query}`,
      {
        method: 'DELETE',
      },
    );
  },

  getAdminSystemSettings: () => requestJson<SystemSettings>('/api/admin/system-settings'),

  updateAdminSystemSettings: (payload: Partial<SystemSettings>) =>
    requestJson<SystemSettings>('/api/admin/system-settings', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listAdminUsers: () => requestJson<AdminUserSummary[]>('/api/admin/users'),

  updateAdminUser: (userId: string, payload: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' }) =>
    requestJson<AdminUserSummary>(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  listAdminInviteCodes: () => requestJson<InviteCodeSummary[]>('/api/admin/invite-codes'),

  createAdminInviteCodes: (count: number) =>
    requestJson<{ codes: string[] }>('/api/admin/invite-codes', {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  deleteAdminInviteCode: (code: string) =>
    requestJson<void>(`/api/admin/invite-codes/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),

  fetchFileBlob,
  fetchFilePreviewBlob,

  downloadFile: async (file: FileRecord) => {
    const blob = await fetchFileBlob(file.id);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.displayName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};
