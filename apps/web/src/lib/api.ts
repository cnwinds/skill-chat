import type {
  AdminUserSummary,
  AuthResponse,
  FileBucket,
  FileRecord,
  InviteCodeSummary,
  SessionSummary,
  SkillMetadata,
  StoredEvent,
  SystemSettings,
  SystemStatus,
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

const readToken = () => useAuthStore.getState().token;

const createHeaders = (headers: HeadersInit = {}, skipJson?: boolean) => {
  const token = readToken();
  const merged = new Headers(headers);
  if (!skipJson && !merged.has('Content-Type')) {
    merged.set('Content-Type', 'application/json');
  }
  if (token) {
    merged.set('Authorization', `Bearer ${token}`);
  }
  return merged;
};

const parseResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
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
    headers: createHeaders(init.headers, init.body instanceof FormData),
  });
  return parseResponse<T>(response);
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

  listMessages: (sessionId: string) =>
    requestJson<StoredEvent[]>(`/api/sessions/${sessionId}/messages?limit=200`),

  sendMessage: (sessionId: string, content: string) =>
    requestJson<{ accepted: boolean; messageId: string; runId: string }>(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
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

  downloadFile: async (file: FileRecord) => {
    const response = await fetch(`/api/files/${file.id}/download`, {
      headers: createHeaders({}, true),
    });

    if (!response.ok) {
      throw new ApiError('下载失败', response.status);
    }

    const blob = await response.blob();
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
