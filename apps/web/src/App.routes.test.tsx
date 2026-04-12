import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './stores/auth-store';
import { usePreferencesStore } from './stores/preferences-store';
import { useUiStore } from './stores/ui-store';

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(async () => undefined),
}));

type MockResponseInit = {
  body: unknown;
  status?: number;
};

const jsonResponse = ({ body, status = 200 }: MockResponseInit) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });

const systemSettings = {
  registrationRequiresInviteCode: true,
  defaultSessionActiveSkills: ['planner'],
  enableAssistantTools: true,
  webOrigin: 'http://localhost:5173',
  modelConfig: {
    openaiModelRouter: 'gpt-5-mini',
    openaiModelPlanner: 'gpt-5',
    openaiModelReply: 'gpt-5.2',
    openaiReasoningEffortReply: 'medium' as const,
    llmMaxOutputTokens: 4096,
    toolMaxOutputTokens: 2048,
  },
};

const adminUser = {
  id: 'u_admin',
  username: 'admin',
  role: 'admin' as const,
  status: 'active' as const,
};

const memberUser = {
  id: 'u_member',
  username: 'member',
  role: 'member' as const,
  status: 'active' as const,
};

const renderApp = (initialEntries: string[]) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const installFetchMock = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
  vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return Promise.resolve(handler(url, init));
  }));
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  useAuthStore.setState({ token: null, user: null });
  usePreferencesStore.setState({ themeMode: 'dark' });
  useUiStore.setState({
    activeSessionId: null,
    mobilePanel: null,
    drafts: {},
    streams: {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('App routes', () => {
  it('shows bootstrap admin entry when the system is not initialized', async () => {
    installFetchMock((url) => {
      if (url === '/api/system/status') {
        return jsonResponse({
          body: {
            initialized: false,
            hasAdmin: false,
            registrationRequiresInviteCode: true,
          },
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderApp(['/login']);

    expect(await screen.findByRole('button', { name: '首次启动？创建管理员' })).toBeInTheDocument();
  });

  it('hides the invite code field when registration is open', async () => {
    installFetchMock((url) => {
      if (url === '/api/system/status') {
        return jsonResponse({
          body: {
            initialized: true,
            hasAdmin: true,
            registrationRequiresInviteCode: false,
          },
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    renderApp(['/register']);

    expect(await screen.findByText('当前已开放注册，不需要邀请码。')).toBeInTheDocument();
    expect(screen.queryByLabelText('邀请码')).not.toBeInTheDocument();
  });

  it('shows the admin settings entry only for admins', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Admin Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ token: 'token-admin', user: adminUser });
    const adminView = renderApp(['/app/session/s1']);
    expect(await screen.findByText('系统配置 / 用户 / 邀请码')).toBeInTheDocument();

    adminView.unmount();

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    await waitFor(() => {
      expect(screen.queryByText('系统配置 / 用户 / 邀请码')).not.toBeInTheDocument();
    });
  });

  it('persists theme changes to user settings', async () => {
    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings' && method === 'GET') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/me/settings' && method === 'PATCH') {
        expect(init?.body).toBe(JSON.stringify({ themeMode: 'light' }));
        return jsonResponse({ body: { themeMode: 'light' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Theme Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ token: 'token-admin', user: adminUser });
    renderApp(['/app/session/s1']);

    const toggle = await screen.findByRole('button', { name: '浅色' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(usePreferencesStore.getState().themeMode).toBe('light');
    });
  });

  it('renders the admin settings page and loads system config data', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'light' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/admin/system-settings') {
        return jsonResponse({ body: systemSettings });
      }
      if (url === '/api/admin/users') {
        return jsonResponse({
          body: [
            {
              ...adminUser,
              createdAt: '2026-04-12T00:00:00.000Z',
            },
          ],
        });
      }
      if (url === '/api/admin/invite-codes') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ token: 'token-admin', user: adminUser });
    renderApp(['/app/settings']);

    expect(await screen.findByText('设置中心')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '降为成员' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));
    expect(await screen.findByDisplayValue('gpt-5.2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('planner')).toBeInTheDocument();
  });

  it('shows only the latest five sessions by default and expands progressively', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: Array.from({ length: 7 }, (_, index) => ({
            id: `s${index + 1}`,
            title: `Session ${index + 1}`,
            createdAt: '2026-04-12T00:00:00.000Z',
            updatedAt: `2026-04-12T00:00:0${index}.000Z`,
            lastMessageAt: null,
            activeSkills: [],
          })),
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    expect(await screen.findAllByText('Session 5')).toHaveLength(2);
    expect(screen.queryByText('Session 6')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '更多会话（还有 2 条）' })[0]);

    expect(await screen.findByText('Session 6')).toBeInTheDocument();
    expect(screen.getByText('Session 7')).toBeInTheDocument();
  });
});
