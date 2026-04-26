import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { useAuthStore } from './stores/auth-store';
import { usePreferencesStore } from './stores/preferences-store';
import { useUiStore } from './stores/ui-store';

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(async () => undefined),
}));

const fetchEventSourceMock = vi.mocked(fetchEventSource);

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

type MockStreamHandlers = {
  onopen?: (response: Response) => Promise<void> | void;
  onclose?: () => Promise<void> | void;
  onmessage?: (event: { id?: string; event?: string; data?: string }) => void;
  onerror?: (error: unknown) => unknown;
};

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
  enableAssistantTools: true,
  modelConfig: {
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiApiKey: 'sk-test',
    openaiModel: 'gpt-5.2',
    openaiReasoningEffort: 'medium' as const,
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
    try {
      return Promise.resolve(handler(url, init));
    } catch (error) {
      const runtimeMatch = url.match(/^\/api\/sessions\/([^/]+)\/runtime$/);
      if (runtimeMatch) {
        return Promise.resolve(jsonResponse({
          body: {
            sessionId: runtimeMatch[1],
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        }));
      }
      throw error;
    }
  }));
};

beforeEach(() => {
    document.documentElement.dataset.theme = 'dark';
  useAuthStore.setState({ user: null, ready: true });
  usePreferencesStore.setState({ themeMode: 'dark' });
  useUiStore.setState({
    activeSessionId: null,
    mobilePanel: null,
    drafts: {},
    streams: {},
    sessionScrollStates: {},
  });
  fetchEventSourceMock.mockReset();
  fetchEventSourceMock.mockImplementation(async (_input, init) => {
    await init?.onopen?.(new Response(null, { status: 200 }));
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

  it('hydrates the current user from the server session before entering a protected route', async () => {
    useAuthStore.setState({ user: null, ready: false });

    installFetchMock((url) => {
      if (url === '/api/auth/session') {
        return jsonResponse({ body: { user: memberUser } });
      }
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Recovered Session',
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

    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/Turn：- · Round：- · 总消耗 token：0/, { selector: 'p' })).toBeInTheDocument();
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

    useAuthStore.setState({ user: adminUser, ready: true });
    const adminView = renderApp(['/app/session/s1']);
    expect(await screen.findByRole('button', { name: '设置' })).toBeInTheDocument();

    adminView.unmount();

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    });
  });

  it('logs out through the server endpoint and returns to the login page', async () => {
    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Logout Session',
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
      if (url === '/api/auth/logout' && method === 'POST') {
        return new Response(null, { status: 204 });
      }
      if (url === '/api/system/status') {
        return jsonResponse({
          body: {
            initialized: true,
            hasAdmin: true,
            registrationRequiresInviteCode: true,
          },
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    fireEvent.click((await screen.findAllByRole('button', { name: '退出' }))[0]);

    expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument();
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

    useAuthStore.setState({ user: adminUser, ready: true });
    renderApp(['/app/session/s1']);

    const toggle = await screen.findByRole('button', { name: '浅色' });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('light');
      expect(usePreferencesStore.getState().themeMode).toBe('light');
    });
  });

  it('renders recovered follow-up queue items from the runtime snapshot after refresh', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Recovered Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [
              {
                inputId: 'input_queued',
                content: '下一轮整理文档',
                createdAt: '2026-04-12T00:00:02.000Z',
              },
            ],
            recovery: {
              recoveredAt: '2026-04-12T00:00:05.000Z',
              previousTurnId: 'turn_recover',
              previousTurnKind: 'regular',
              reason: 'process_restarted',
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/已从重启中恢复/)).toBeInTheDocument();
    expect(screen.getByText('下一轮整理文档')).toBeInTheDocument();
    expect(screen.getByText('待处理队列（按顺序处理）')).toBeInTheDocument();
    const messageList = document.querySelector('.message-list');
    const previewStack = document.querySelector('.runtime-preview-stack');
    expect(messageList).not.toHaveTextContent('下一轮整理文档');
    expect(previewStack).toHaveTextContent('1 下一轮整理文档');
    expect(previewStack).toHaveTextContent('下一轮整理文档');
  });

  it('restores the previous scroll position when switching back to a session', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'First Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
            {
              id: 's2',
              title: 'Second Session',
              createdAt: '2026-04-12T00:01:00.000Z',
              updatedAt: '2026-04-12T00:01:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({
          body: [
            {
              id: 's1_user_1',
              sessionId: 's1',
              kind: 'message',
              role: 'user',
              type: 'text',
              content: '第一条会话的问题',
              createdAt: '2026-04-12T00:00:01.000Z',
            },
          ],
        });
      }
      if (url === '/api/sessions/s2/messages?limit=200') {
        return jsonResponse({
          body: [
            {
              id: 's2_user_1',
              sessionId: 's2',
              kind: 'message',
              role: 'user',
              type: 'text',
              content: '第二条会话的问题',
              createdAt: '2026-04-12T00:01:01.000Z',
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/runtime' || url === '/api/sessions/s2/runtime') {
        return jsonResponse({
          body: {
            sessionId: url.includes('/s1/') ? 's1' : 's2',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1' || url === '/api/files?sessionId=s2') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('第一条会话的问题')).toBeInTheDocument();
    const messageList = document.querySelector('.message-list') as HTMLDivElement;
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 1800 });
    Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: 500 });

    messageList.scrollTop = 620;
    fireEvent.scroll(messageList);

    fireEvent.click(screen.getByText('Second Session'));
    expect(await screen.findByText('第二条会话的问题')).toBeInTheDocument();
    messageList.scrollTop = 120;
    fireEvent.scroll(messageList);

    fireEvent.click(screen.getByText('First Session'));
    expect(await screen.findByText('第一条会话的问题')).toBeInTheDocument();

    await waitFor(() => {
      expect(messageList.scrollTop).toBe(620);
    });
  });

  it('removes a queued follow-up item when the user clicks cancel', async () => {
    let removedInputId: string | null = null;

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Recovered Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [
              {
                inputId: 'input_queued_1',
                content: '可以考公务员',
                createdAt: '2026-04-12T00:00:02.000Z',
              },
              {
                inputId: 'input_queued_2',
                content: '读文科',
                createdAt: '2026-04-12T00:00:03.000Z',
              },
            ],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/runtime/queue/input_queued_1' && method === 'DELETE') {
        removedInputId = 'input_queued_1';
        return jsonResponse({
          body: {
            accepted: true,
            inputId: 'input_queued_1',
            runtime: {
              sessionId: 's1',
              activeTurn: null,
              followUpQueue: [
                {
                  inputId: 'input_queued_2',
                  content: '读文科',
                  createdAt: '2026-04-12T00:00:03.000Z',
                },
              ],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('可以考公务员')).toBeInTheDocument();
    expect(screen.getByText('读文科')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消待处理项：可以考公务员' }));

    await waitFor(() => {
      expect(removedInputId).toBe('input_queued_1');
      expect(screen.queryByText('可以考公务员')).not.toBeInTheDocument();
      expect(screen.getByText('读文科')).toBeInTheDocument();
    });
  });

  it('keeps a removed follow-up item hidden when a stale runtime snapshot arrives later', async () => {
    const deferredRuntime = createDeferred<Response>();

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Running Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return deferredRuntime.promise;
      }
      if (url === '/api/sessions/s1/runtime/queue/input_queued_1' && method === 'DELETE') {
        return jsonResponse({
          body: {
            accepted: true,
            inputId: 'input_queued_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    useUiStore.setState({
      activeSessionId: 's1',
      mobilePanel: null,
      drafts: {},
      streams: {
        s1: {
          pendingText: '',
          transientEvents: [],
          status: 'open',
          lastError: null,
          reconnectAttempt: null,
          reconnectLimit: null,
          activeTurnId: 'turn_1',
          activeTurnKind: 'regular',
          activeTurnStatus: 'running',
          activeTurnPhase: 'sampling',
          activeTurnPhaseStartedAt: '2026-04-12T00:00:00.000Z',
          activeTurnStartedAt: '2026-04-12T00:00:00.000Z',
          activeTurnCanSteer: true,
          activeTurnRound: 1,
          reasoningSummary: '',
          currentTurnTokenUsage: null,
          followUpQueue: [
            {
              inputId: 'input_queued_1',
              content: '怎么回事',
              createdAt: '2026-04-12T00:00:02.000Z',
            },
          ],
          removedFollowUpInputIds: [],
          recovery: null,
        },
      },
    });

    renderApp(['/app/session/s1']);

    expect(await screen.findByText('怎么回事')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消待处理项：怎么回事' }));

    await waitFor(() => {
      expect(screen.queryByText('怎么回事')).not.toBeInTheDocument();
    });

    deferredRuntime.resolve(jsonResponse({
      body: {
        sessionId: 's1',
        activeTurn: {
          turnId: 'turn_1',
          kind: 'regular',
          status: 'running',
          phase: 'sampling',
          phaseStartedAt: '2026-04-12T00:00:00.000Z',
          canSteer: true,
          startedAt: '2026-04-12T00:00:00.000Z',
          round: 1,
        },
        followUpQueue: [
          {
            inputId: 'input_queued_1',
            content: '怎么回事',
            createdAt: '2026-04-12T00:00:02.000Z',
          },
        ],
        recovery: null,
      },
    }));

    await waitFor(() => {
      expect(screen.queryByText('怎么回事')).not.toBeInTheDocument();
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

    useAuthStore.setState({ user: adminUser, ready: true });
    renderApp(['/app/settings']);

    expect(await screen.findByText('设置中心')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '降为成员' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '系统' }));
    expect(await screen.findByDisplayValue('gpt-5.2')).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('sk-test')).toBeInTheDocument();
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

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('Session 5')).toBeInTheDocument();
    expect(screen.queryByText('Session 6')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '更多会话（还有 2 条）' })[0]);

    expect(await screen.findByText('Session 6')).toBeInTheDocument();
    expect(screen.getByText('Session 7')).toBeInTheDocument();
  });

  it('renames a session by clicking the chat title', async () => {
    let patchPayload: Record<string, unknown> | null = null;
    const sessions = [
      {
        id: 's1',
        title: '旧标题',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        lastMessageAt: null,
        activeSkills: [],
      },
    ];

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions' && method === 'GET') {
        return jsonResponse({ body: sessions });
      }
      if (url === '/api/sessions/s1' && method === 'PATCH') {
        patchPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        sessions[0] = {
          ...sessions[0],
          title: '新标题',
          updatedAt: '2026-04-12T00:01:00.000Z',
        };
        return jsonResponse({ body: sessions[0] });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    fireEvent.click(await screen.findByRole('button', { name: '修改会话标题：旧标题' }));
    fireEvent.change(await screen.findByLabelText('会话标题'), {
      target: { value: '新标题' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(patchPayload).toEqual({
        title: '新标题',
      });
      expect(screen.getByRole('heading', { level: 1, name: '新标题' })).toBeInTheDocument();
    });
  });

  it('deletes the current session from the chat title bar and selects the next one', async () => {
    let deletedSessionId: string | null = null;
    let sessions = [
      {
        id: 's1',
        title: '要删除的会话',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        lastMessageAt: null,
        activeSkills: [],
      },
      {
        id: 's2',
        title: '保留的会话',
        createdAt: '2026-04-12T00:01:00.000Z',
        updatedAt: '2026-04-12T00:01:00.000Z',
        lastMessageAt: null,
        activeSkills: [],
      },
    ];

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions' && method === 'GET') {
        return jsonResponse({ body: sessions });
      }
      if (url === '/api/sessions/s1' && method === 'DELETE') {
        deletedSessionId = 's1';
        sessions = sessions.filter((session) => session.id !== 's1');
        return new Response(null, { status: 204 });
      }
      if (url === '/api/sessions/s1/messages?limit=200' || url === '/api/sessions/s2/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/runtime' || url === '/api/sessions/s2/runtime') {
        return jsonResponse({
          body: {
            sessionId: url.includes('/s1/') ? 's1' : 's2',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1' || url === '/api/files?sessionId=s2') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    fireEvent.click(await screen.findByRole('button', { name: '删除会话：要删除的会话' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除' }));

    await waitFor(() => {
      expect(deletedSessionId).toBe('s1');
      expect(screen.getByRole('heading', { level: 1, name: '保留的会话' })).toBeInTheDocument();
      expect(screen.queryByText('要删除的会话')).not.toBeInTheDocument();
    });
  });

  it('restores active turn status and thinking when switching away and back to a running session', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Session 1',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
            {
              id: 's2',
              title: 'Session 2',
              createdAt: '2026-04-12T00:01:00.000Z',
              updatedAt: '2026-04-12T00:01:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200' || url === '/api/sessions/s2/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s1' || url === '/api/files?sessionId=s2') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:30.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 2,
            },
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s2/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's2',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/思考中\(/)).toBeInTheDocument();
    expect(screen.getByText(/Turn：1（1） · Round：2 · 总消耗 token：0 · sampling/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开会话：Session 2' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Session 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^打开会话：Session 1/ }));

    expect(await screen.findByText(/思考中\(/)).toBeInTheDocument();
    expect(screen.getByText(/Turn：1（1） · Round：2 · 总消耗 token：0 · sampling/)).toBeInTheDocument();
  });

  it('shows reconnect progress in the thinking bubble while the stream reconnects and restores thinking after reconnect', async () => {
    const firstConnection = createDeferred<void>();
    const secondConnection = createDeferred<void>();
    let firstHandlers: MockStreamHandlers | undefined;
    let secondHandlers: MockStreamHandlers | undefined;
    let streamCallCount = 0;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      streamCallCount += 1;
      if (streamCallCount === 1) {
        firstHandlers = init as MockStreamHandlers;
        await firstHandlers.onopen?.(new Response(null, { status: 200 }));
        return firstConnection.promise;
      }

      secondHandlers = init as MockStreamHandlers;
      return secondConnection.promise;
    });

    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:30.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/思考中\(/)).toBeInTheDocument();

    await act(async () => {
      await firstHandlers?.onclose?.();
      firstConnection.resolve();
    });

    await waitFor(() => {
      expect(fetchEventSourceMock).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/重连中1\/5\(/)).toBeInTheDocument();
    });

    await act(async () => {
      await secondHandlers?.onopen?.(new Response(null, { status: 200 }));
    });

    await waitFor(() => {
      expect(screen.getByText(/思考中\(/)).toBeInTheDocument();
      expect(screen.queryByText(/重连中1\/5\(/)).not.toBeInTheDocument();
    });

    secondConnection.resolve();
  });

  it('keeps streaming text visible when a stale idle runtime snapshot resolves after the turn has started', async () => {
    const runtimeResponse = createDeferred<Response>();
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return runtimeResponse.promise;
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'turn_started',
            messageId: 'input_start_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_start_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    fireEvent.change(textarea, {
      target: { value: '帮我分析这个分数该怎么填志愿' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_delta_1',
        event: 'text_delta',
        data: JSON.stringify({
          content: '先看你的分数段位，',
        }),
      });
    });

    expect(await screen.findByText('先看你的分数段位，')).toBeInTheDocument();

    runtimeResponse.resolve(jsonResponse({
      body: {
        sessionId: 's1',
        activeTurn: null,
        followUpQueue: [],
        recovery: null,
      },
    }));

    await waitFor(() => {
      expect(screen.getByText('先看你的分数段位，')).toBeInTheDocument();
    });
  });

  it('clears a stale running state when the runtime is idle and the final assistant reply is already persisted', async () => {
    const finalAssistantMessage = {
      id: 'evt_assistant_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'assistant' as const,
      type: 'text' as const,
      content: 'Hi! 怎么帮你？',
      createdAt: '2026-04-12T00:00:04.200Z',
    };

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Recovered Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [finalAssistantMessage] });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    useUiStore.setState({
      activeSessionId: 's1',
      mobilePanel: null,
      drafts: {},
      streams: {
        s1: {
          pendingText: finalAssistantMessage.content,
          transientEvents: [],
          status: 'open',
          lastError: null,
          reconnectAttempt: null,
          reconnectLimit: null,
          activeTurnId: 'turn_1',
          activeTurnKind: 'regular',
          activeTurnStatus: 'running',
          activeTurnPhase: 'streaming_assistant',
          activeTurnPhaseStartedAt: '2026-04-12T00:00:04.000Z',
          activeTurnStartedAt: '2026-04-12T00:00:04.000Z',
          activeTurnCanSteer: true,
          activeTurnRound: 1,
          reasoningSummary: '',
          currentTurnTokenUsage: null,
          followUpQueue: [],
          removedFollowUpInputIds: [],
          recovery: null,
        },
      },
    });

    renderApp(['/app/session/s1']);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '中断当前 turn' })).not.toBeInTheDocument();
      expect(screen.queryByText('当前轮处理中')).not.toBeInTheDocument();
    });
  });

  it('keeps the streaming assistant footer stable after turn completion and suppresses the duplicate final reply', async () => {
    const finalAssistantMessage = {
      id: 'evt_assistant_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'assistant' as const,
      type: 'text' as const,
      content: '最终建议',
      createdAt: '2026-04-12T00:00:04.200Z',
      meta: {
        durationMs: 4200,
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      },
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'turn_started',
            messageId: 'input_start_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_start_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    fireEvent.change(textarea, {
      target: { value: '帮我给个结论' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_delta_1',
        event: 'text_delta',
        data: JSON.stringify({
          content: finalAssistantMessage.content,
        }),
      });
      handleStreamMessage?.({
        id: 'evt_token_1',
        event: 'token_count',
        data: JSON.stringify({
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        }),
      });
    });

    expect(await screen.findByText(/165 \(120\/45\) tokens/)).toBeInTheDocument();

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_complete_1',
        event: 'turn_completed',
        data: JSON.stringify({
          turnId: 'turn_1',
          kind: 'regular',
          status: 'completed',
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/165 \(120\/45\) tokens/)).toBeInTheDocument();
    });

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_done_1',
        event: 'done',
        data: JSON.stringify({}),
      });
    });

    refetchMessages.resolve(jsonResponse({ body: [finalAssistantMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(screen.getAllByText(finalAssistantMessage.content)).toHaveLength(1);
      expect(screen.getAllByText(/165 \(120\/45\) tokens/)).toHaveLength(1);
    });
  });

  it('stops showing the current turn as running when done arrives before turn_completed', async () => {
    const finalAssistantMessage = {
      id: 'evt_assistant_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'assistant' as const,
      type: 'text' as const,
      content: 'Hi! 怎么帮你？',
      createdAt: '2026-04-12T00:00:04.200Z',
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'turn_started',
            messageId: 'input_start_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_start_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    fireEvent.change(textarea, {
      target: { value: 'hi' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    expect(await screen.findByRole('button', { name: '中断当前 turn' })).toBeInTheDocument();

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_delta_1',
        event: 'text_delta',
        data: JSON.stringify({
          content: finalAssistantMessage.content,
        }),
      });
      handleStreamMessage?.({
        id: 'evt_done_1',
        event: 'done',
        data: JSON.stringify({}),
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '中断当前 turn' })).not.toBeInTheDocument();
      expect(screen.queryByText('当前轮处理中')).not.toBeInTheDocument();
    });

    refetchMessages.resolve(jsonResponse({ body: [finalAssistantMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(screen.getByText(finalAssistantMessage.content)).toBeInTheDocument();
    });
  });

  it('replaces the optimistic user message with the committed one instead of rendering both', async () => {
    const committedMessage = {
      id: 'evt_user_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'user' as const,
      type: 'text' as const,
      content: '帮我分析这个分数该怎么填志愿',
      createdAt: '2026-04-12T00:00:01.000Z',
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'turn_started',
            messageId: 'input_start_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_start_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    fireEvent.change(textarea, {
      target: { value: committedMessage.content },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(screen.getAllByText(committedMessage.content)).toHaveLength(1);
    });

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_commit_1',
        event: 'user_message_committed',
        data: JSON.stringify({
          turnId: 'turn_1',
          inputId: 'input_start_1',
          content: committedMessage.content,
          createdAt: committedMessage.createdAt,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(committedMessage.content)).toHaveLength(1);
    });

    refetchMessages.resolve(jsonResponse({ body: [committedMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(screen.getAllByText(committedMessage.content)).toHaveLength(1);
    });
  });

  it('keeps steer-accepted guidance out of the chat stream until it is committed', async () => {
    const followUpContent = '补充：优先讲就业和城市';
    const committedMessage = {
      id: 'evt_user_followup_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'user' as const,
      type: 'text' as const,
      content: followUpContent,
      createdAt: '2026-04-12T00:00:03.000Z',
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        expect(init?.body).toBe(JSON.stringify({
          content: followUpContent,
          attachmentIds: [],
          dispatch: 'auto',
          turnId: 'turn_1',
        }));
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'steer_accepted',
            messageId: 'input_pending_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_pending_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [
                {
                  inputId: 'input_pending_1',
                  content: followUpContent,
                  createdAt: '2026-04-12T00:00:02.000Z',
                },
              ],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    fireEvent.change(textarea, {
      target: { value: followUpContent },
    });
    fireEvent.click(screen.getByRole('button', { name: '补充信息' }));

    await waitFor(() => {
      expect(screen.getByText(followUpContent)).toBeInTheDocument();
    });
    expect(document.querySelector('.message-list')).not.toHaveTextContent(followUpContent);

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_commit_followup_1',
        event: 'user_message_committed',
        data: JSON.stringify({
          turnId: 'turn_1',
          inputId: 'input_pending_1',
          content: followUpContent,
          createdAt: committedMessage.createdAt,
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(followUpContent)).toHaveLength(1);
    });

    refetchMessages.resolve(jsonResponse({ body: [committedMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(document.querySelector('.message-list')).toHaveTextContent(followUpContent);
    });
  });

  it('renders committed assistant text before the inserted guidance it answered around', async () => {
    const assistantSegment = {
      id: 'evt_assistant_segment_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'assistant' as const,
      type: 'text' as const,
      content: '先答第一段。',
      createdAt: '2026-04-12T00:00:02.000Z',
      meta: {
        turnId: 'turn_1',
      },
    };
    const followUpMessage = {
      id: 'evt_user_followup_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'user' as const,
      type: 'text' as const,
      content: '补充：把城市因素也加上',
      createdAt: '2026-04-12T00:00:03.000Z',
    };
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        return jsonResponse({
          body: messageRequestCount === 1 ? [] : [assistantSegment, followUpMessage],
        });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'streaming_assistant',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    await screen.findByLabelText('聊天输入框');

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_delta_1',
        event: 'text_delta',
        data: JSON.stringify({ content: assistantSegment.content }),
      });
    });

    await act(async () => {
      handleStreamMessage?.({
        id: assistantSegment.id,
        event: 'assistant_message_committed',
        data: JSON.stringify({ message: assistantSegment }),
      });
      handleStreamMessage?.({
        id: 'evt_commit_followup_1',
        event: 'user_message_committed',
        data: JSON.stringify({
          turnId: 'turn_1',
          inputId: 'input_pending_1',
          content: followUpMessage.content,
          createdAt: followUpMessage.createdAt,
        }),
      });
      handleStreamMessage?.({
        id: 'evt_delta_2',
        event: 'text_delta',
        data: JSON.stringify({ content: '再结合补充继续。' }),
      });
    });

    await waitFor(() => {
      expect(messageRequestCount).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByText(assistantSegment.content)).toHaveLength(1);
      expect(document.querySelector('.message-list')).toHaveTextContent('再结合补充继续。');
    });

    const listText = document.querySelector('.message-list')?.textContent ?? '';
    expect(listText.indexOf(assistantSegment.content)).toBeLessThan(listText.indexOf(followUpMessage.content));
    expect(listText.indexOf(followUpMessage.content)).toBeLessThan(listText.indexOf('再结合补充继续。'));
  });

  it('uploads pasted images into the current session and shows them as composer attachments', async () => {
    let uploadCount = 0;

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Clipboard Session',
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
      if (url === '/api/files/s1/upload' && method === 'POST') {
        uploadCount += 1;
        const form = init?.body as FormData;
        const file = form.get('file');
        expect(file).toBeInstanceOf(File);
        expect((file as File).name).toBe('clipboard-shot.png');
        expect((file as File).type).toBe('image/png');

        return jsonResponse({
          body: {
            id: 'file_clipboard_1',
            userId: 'u_member',
            sessionId: 's1',
            displayName: 'clipboard-shot.png',
            relativePath: 'sessions/s1/uploads/clipboard-shot.png',
            mimeType: 'image/png',
            size: 7,
            bucket: 'uploads',
            source: 'upload',
            createdAt: '2026-04-12T00:00:00.000Z',
          },
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    const image = new File(['pngdata'], 'clipboard-shot.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image,
          },
        ],
      },
    });

    await waitFor(() => {
      expect(uploadCount).toBe(1);
    });
    expect(await screen.findByText('clipboard-shot.png')).toBeInTheDocument();
    expect(screen.getByText('图片附件 · 7 B')).toBeInTheDocument();
  });

  it('sends uploaded attachment ids with the next message', async () => {
    let messagePayload: Record<string, unknown> | null = null;

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Attachment Session',
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
      if (url === '/api/files/s1/upload' && method === 'POST') {
        return jsonResponse({
          body: {
            id: 'file_clipboard_1',
            userId: 'u_member',
            sessionId: 's1',
            displayName: 'clipboard-shot.png',
            relativePath: 'sessions/s1/uploads/clipboard-shot.png',
            mimeType: 'image/png',
            size: 7,
            bucket: 'uploads',
            source: 'upload',
            createdAt: '2026-04-12T00:00:00.000Z',
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        messagePayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'turn_started',
            messageId: 'input_start_1',
            runId: 'turn_1',
            turnId: 'turn_1',
            inputId: 'input_start_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    const textarea = await screen.findByLabelText('聊天输入框');
    const image = new File(['pngdata'], 'clipboard-shot.png', { type: 'image/png' });

    fireEvent.paste(textarea, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => image,
          },
        ],
      },
    });

    expect(await screen.findByText('图片附件 · 7 B')).toBeInTheDocument();

    fireEvent.change(textarea, {
      target: { value: '参考这张图继续修改' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(messagePayload).toEqual({
        content: '参考这张图继续修改',
        attachmentIds: ['file_clipboard_1'],
        dispatch: 'new_turn',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('图片附件 · 7 B')).not.toBeInTheDocument();
    });
  });

  it('loads image message previews through the thumbnail path and lets the user reuse the image', async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const createObjectURL = vi.fn(() => 'blob:generated-image-preview');
    const revokeObjectURL = vi.fn();

    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectURL,
    });

    try {
      let previewFetchCount = 0;

      installFetchMock((url, init) => {
        const method = init?.method ?? 'GET';

        if (url === '/api/me/settings') {
          return jsonResponse({ body: { themeMode: 'dark' } });
        }
        if (url === '/api/sessions') {
          return jsonResponse({
            body: [
              {
                id: 's1',
                title: 'Image Session',
                createdAt: '2026-04-12T00:00:00.000Z',
                updatedAt: '2026-04-12T00:00:00.000Z',
                lastMessageAt: null,
                activeSkills: [],
              },
            ],
          });
        }
        if (url === '/api/sessions/s1/messages?limit=200') {
          return jsonResponse({
            body: [
              {
                id: 'evt_img_1',
                sessionId: 's1',
                kind: 'image',
                file: {
                  id: 'file_img_1',
                  userId: 'u_member',
                  sessionId: 's1',
                  displayName: 'generated-banner.png',
                  relativePath: 'sessions/s1/outputs/generated-banner.png',
                  mimeType: 'image/png',
                  size: 2048,
                  bucket: 'outputs',
                  source: 'generated',
                  createdAt: '2026-04-12T00:00:00.000Z',
                },
                operation: 'generate',
                provider: 'openai',
                model: 'gpt-image-2',
                source: 'responses_tool',
                prompt: '生成一张横版横幅',
                revisedPrompt: '横版横幅，暖色夕阳风格',
                createdAt: '2026-04-12T00:00:01.000Z',
              },
            ],
          });
        }
        if (url === '/api/files?sessionId=s1') {
          return jsonResponse({ body: [] });
        }
        if (url === '/api/skills') {
          return jsonResponse({ body: [] });
        }
        if (url === '/api/files/file_img_1/thumbnail' && method === 'GET') {
          previewFetchCount += 1;
          return new Response(new Blob(['pngdata'], { type: 'image/png' }), {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
            },
          });
        }

        throw new Error(`Unhandled fetch: ${method} ${url}`);
      });

      useAuthStore.setState({ user: memberUser, ready: true });
      renderApp(['/app/session/s1']);

      expect(await screen.findByText('图片生成')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: '继续编辑' })).toBeInTheDocument();

      await waitFor(() => {
        expect(previewFetchCount).toBe(1);
      });
      expect(createObjectURL).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));

      expect(await screen.findByText('图片附件 · 2.0 KB')).toBeInTheDocument();
      expect(screen.getAllByText('generated-banner.png').length).toBeGreaterThan(1);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        writable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        writable: true,
        value: originalRevokeObjectURL,
      });
    }
  });

  it('shares a generated image without sending an empty json body header', async () => {
    let fileRequestCount = 0;
    let shareRequestCount = 0;

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Share Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        fileRequestCount += 1;
        return jsonResponse({
          body: fileRequestCount === 1
            ? [
              {
                id: 'file_output_1',
                userId: 'u_member',
                sessionId: 's1',
                displayName: 'generated-image.png',
                relativePath: 'sessions/s1/outputs/generated-image.png',
                mimeType: 'image/png',
                size: 1536000,
                bucket: 'outputs',
                source: 'generated',
                createdAt: '2026-04-12T00:00:00.000Z',
                downloadUrl: '/api/files/file_output_1/download',
                thumbnailUrl: '/api/files/file_output_1/thumbnail',
              },
            ]
            : [
              {
                id: 'file_shared_1',
                userId: 'u_member',
                sessionId: null,
                displayName: 'generated-image.png',
                relativePath: 'shared/generated-image.png',
                mimeType: 'image/png',
                size: 1536000,
                bucket: 'shared',
                source: 'shared',
                createdAt: '2026-04-12T00:00:10.000Z',
                downloadUrl: '/api/files/file_shared_1/download',
                thumbnailUrl: '/api/files/file_shared_1/thumbnail',
              },
            ],
        });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files/file_output_1/share' && method === 'POST') {
        shareRequestCount += 1;
        expect(init?.body).toBeUndefined();
        expect(new Headers(init?.headers).get('Content-Type')).toBeNull();
        return jsonResponse({
          body: {
            id: 'file_shared_1',
            userId: 'u_member',
            sessionId: null,
            displayName: 'generated-image.png',
            relativePath: 'shared/generated-image.png',
            mimeType: 'image/png',
            size: 1536000,
            bucket: 'shared',
            source: 'shared',
            createdAt: '2026-04-12T00:00:10.000Z',
            downloadUrl: '/api/files/file_shared_1/download',
            thumbnailUrl: '/api/files/file_shared_1/thumbnail',
          },
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('generated-image.png')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '共享' }));

    await waitFor(() => {
      expect(shareRequestCount).toBe(1);
      expect(fileRequestCount).toBeGreaterThanOrEqual(2);
    });
    expect(await screen.findByText('已共享')).toBeInTheDocument();
    expect(screen.getByText('generated-image.png 已加入共享区')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '共享' })).toBeInTheDocument();
  });

  it('renders skill starter badges in the empty state and writes the clicked prompt into the composer', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Starter Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: ['zhangxuefeng-perspective'],
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
        return jsonResponse({
          body: [
            {
              name: 'zhangxuefeng-perspective',
              description: '张雪峰视角的专业和志愿分析',
              starterPrompts: [
                '扮演张雪峰，帮我分析这个专业值不值得报',
                '用张雪峰的视角，帮我看看这个分数怎么填志愿',
              ],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('当前会话已启用：zhangxuefeng-perspective')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '扮演张雪峰，帮我分析这个专业值不值得报' }));

    const textarea = screen.getByLabelText('聊天输入框') as HTMLTextAreaElement;
    expect(textarea.value).toBe('扮演张雪峰，帮我分析这个专业值不值得报');
  });

  it('does not render skill starter badges when the session has no enabled skills', async () => {
    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Empty Starter Session',
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
        return jsonResponse({
          body: [
            {
              name: 'zhangxuefeng-perspective',
              description: '张雪峰视角的专业和志愿分析',
              starterPrompts: [
                '扮演张雪峰，帮我看看这个分数怎么填志愿',
              ],
            },
            {
              name: 'pdf',
              description: '导出 PDF',
              starterPrompts: [
                '帮我把这份内容整理成 PDF',
              ],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('开始一个任务')).toBeInTheDocument();
    expect(screen.getByText('可以直接聊天或上传文件；如果要启用特定 skill，先在右侧面板把它加入当前会话。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '扮演张雪峰，帮我看看这个分数怎么填志愿' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '帮我把这份内容整理成 PDF' })).not.toBeInTheDocument();
  });

  it('does not auto-create a session and requires explicit skill selection when creating one', async () => {
    let createPayload: Record<string, unknown> | null = null;
    const sessions: Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      lastMessageAt: string | null;
      activeSkills: string[];
    }> = [];

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions' && method === 'GET') {
        return jsonResponse({ body: sessions });
      }
      if (url === '/api/sessions' && method === 'POST') {
        createPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const createdSession = {
          id: 's_new',
          title: '高校咨询',
          createdAt: '2026-04-12T00:00:00.000Z',
          updatedAt: '2026-04-12T00:00:00.000Z',
          lastMessageAt: null,
          activeSkills: ['zhangxuefeng-perspective'],
        };
        sessions.push(createdSession);
        return jsonResponse({ body: createdSession });
      }
      if (url === '/api/sessions/s_new/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s_new') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s_new/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's_new',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/skills') {
        return jsonResponse({
          body: [
            {
              name: 'zhangxuefeng-perspective',
              description: '张雪峰视角的专业和志愿分析',
              starterPrompts: [],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app']);

    expect(await screen.findByText('还没有会话')).toBeInTheDocument();
    expect(createPayload).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('会话标题'), {
      target: { value: '高校咨询' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入会话：zhangxuefeng-perspective' }));
    fireEvent.click(screen.getByRole('button', { name: '创建会话' }));

    await waitFor(() => {
      expect(createPayload).toEqual({
        title: '高校咨询',
        activeSkills: ['zhangxuefeng-perspective'],
      });
    });
    expect(await screen.findByRole('heading', { name: '高校咨询' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skill' }));
    expect(await screen.findByText('当前会话 Skill 作用域')).toBeInTheDocument();
    expect(screen.getByText('当前会话只允许使用这些 skills：zhangxuefeng-perspective。未启用的 skill 不会进入上下文，也不可调用。')).toBeInTheDocument();
  });

  it('keeps the newly created session active when created from an existing session', async () => {
    let createPayload: Record<string, unknown> | null = null;
    const sessions: Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      lastMessageAt: string | null;
      activeSkills: string[];
    }> = [
      {
        id: 's1',
        title: '旧会话',
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
        lastMessageAt: null,
        activeSkills: [],
      },
    ];

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions' && method === 'GET') {
        return jsonResponse({ body: sessions });
      }
      if (url === '/api/sessions' && method === 'POST') {
        createPayload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const createdSession = {
          id: 's2',
          title: '新会话',
          createdAt: '2026-04-12T00:01:00.000Z',
          updatedAt: '2026-04-12T00:01:00.000Z',
          lastMessageAt: null,
          activeSkills: ['pdf'],
        };
        sessions.unshift(createdSession);
        return jsonResponse({ body: createdSession });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s2/messages?limit=200') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/files?sessionId=s2') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s2/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's2',
            activeTurn: null,
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/skills') {
        return jsonResponse({
          body: [
            {
              name: 'pdf',
              description: '导出 PDF',
              starterPrompts: [],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByRole('heading', { level: 1, name: '旧会话' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入会话：pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '创建会话' }));

    await waitFor(() => {
      expect(createPayload).toEqual({
        activeSkills: ['pdf'],
      });
    });

    expect(await screen.findByRole('heading', { level: 1, name: '新会话' })).toBeInTheDocument();
    const sessionButtons = screen.getAllByRole('button', { name: /新会话/ });
    expect(sessionButtons[0]).toHaveClass('session-item', 'active');
    expect(screen.queryByRole('heading', { level: 1, name: '旧会话' })).not.toBeInTheDocument();
  });

  it('renders a unified follow-up queue and dispatches running-turn input through auto mode', async () => {
    let queueCount = 0;
    let interruptCount = 0;

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
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
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        queueCount += 1;
        expect(init?.body).toBe(JSON.stringify({
          content: '补充：先修后端',
          attachmentIds: [],
          dispatch: 'auto',
          turnId: 'turn_1',
        }));
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'queued',
            messageId: 'input_queue_2',
            runId: 'queued_input_queue_2',
            inputId: 'input_queue_2',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'running',
                phase: 'sampling',
                phaseStartedAt: '2026-04-12T00:00:00.000Z',
                canSteer: true,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [
                {
                  inputId: 'input_pending_1',
                  content: '先看失败测试',
                  createdAt: '2026-04-12T00:00:01.000Z',
                },
                {
                  inputId: 'input_queue_1',
                  content: '下一轮整理文档',
                  createdAt: '2026-04-12T00:00:02.000Z',
                },
                {
                  inputId: 'input_queue_2',
                  content: '补充：先修后端',
                  createdAt: '2026-04-12T00:00:03.000Z',
                },
              ],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [
              {
                inputId: 'input_pending_1',
                content: '先看失败测试',
                createdAt: '2026-04-12T00:00:01.000Z',
              },
              {
                inputId: 'input_queue_1',
                content: '下一轮整理文档',
                createdAt: '2026-04-12T00:00:02.000Z',
              },
            ],
            recovery: null,
          },
        });
      }
      if (url === '/api/sessions/s1/turns/turn_1/interrupt' && method === 'POST') {
        interruptCount += 1;
        return jsonResponse({
          body: {
            accepted: true,
            turnId: 'turn_1',
            runtime: {
              sessionId: 's1',
              activeTurn: null,
              followUpQueue: [
                {
                  inputId: 'input_pending_1',
                  content: '先看失败测试',
                  createdAt: '2026-04-12T00:00:01.000Z',
                },
                {
                  inputId: 'input_queue_1',
                  content: '下一轮整理文档',
                  createdAt: '2026-04-12T00:00:02.000Z',
                },
                {
                  inputId: 'input_queue_2',
                  content: '补充：先修后端',
                  createdAt: '2026-04-12T00:00:03.000Z',
                },
              ],
              recovery: null,
            },
          },
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/思考中\(/)).toBeInTheDocument();
    expect(await screen.findByText('待处理队列（按顺序处理）')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '补充信息' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '中断当前 turn' })).toBeInTheDocument();
    const messageList = document.querySelector('.message-list');
    const previewStack = document.querySelector('.runtime-preview-stack');
    expect(messageList).not.toHaveTextContent('先看失败测试');
    expect(previewStack).toHaveTextContent('1 先看失败测试');
    expect(previewStack).toHaveTextContent('2 下一轮整理文档');
    expect(previewStack).toHaveTextContent('先看失败测试');
    expect(previewStack).toHaveTextContent('下一轮整理文档');
    expect(screen.getByPlaceholderText('继续补充信息，系统会按顺序处理')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('继续补充信息，系统会按顺序处理'), {
      target: { value: '补充：先修后端' },
    });
    fireEvent.click(screen.getByRole('button', { name: '补充信息' }));

    await waitFor(() => {
      expect(queueCount).toBe(1);
      expect(screen.getByText('补充：先修后端')).toBeInTheDocument();
    });
    expect(messageList).not.toHaveTextContent('补充：先修后端');
    expect(screen.getByText(/思考中\(/)).toBeInTheDocument();
    expect(previewStack).toHaveTextContent('3 补充：先修后端');
    const previewText = previewStack?.textContent ?? '';
    expect(previewText.indexOf('先看失败测试')).toBeLessThan(previewText.indexOf('下一轮整理文档'));
    expect(previewText.indexOf('下一轮整理文档')).toBeLessThan(previewText.indexOf('补充：先修后端'));

    fireEvent.click(screen.getByRole('button', { name: '中断当前 turn' }));

    await waitFor(() => {
      expect(interruptCount).toBe(1);
      expect(screen.queryByRole('button', { name: '中断当前 turn' })).not.toBeInTheDocument();
    });
  });

  it('keeps the next turn streamed output visible after interrupting and immediately sending a follow-up', async () => {
    let interruptCount = 0;
    let sendCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url, init) => {
      const method = init?.method ?? 'GET';

      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
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
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/sessions/s1/turns/turn_1/interrupt' && method === 'POST') {
        interruptCount += 1;
        return jsonResponse({
          body: {
            accepted: true,
            turnId: 'turn_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'interrupting',
                phase: 'non_steerable',
                phaseStartedAt: '2026-04-12T00:00:04.000Z',
                canSteer: false,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [],
              recovery: null,
            },
          },
        });
      }
      if (url === '/api/sessions/s1/messages' && method === 'POST') {
        sendCount += 1;
        expect(init?.body).toBe(JSON.stringify({
          content: '继续第二轮',
          attachmentIds: [],
          dispatch: 'auto',
          turnId: 'turn_1',
        }));
        return jsonResponse({
          body: {
            accepted: true,
            dispatch: 'queued',
            messageId: 'input_queue_1',
            runId: 'queued_input_queue_1',
            inputId: 'input_queue_1',
            runtime: {
              sessionId: 's1',
              activeTurn: {
                turnId: 'turn_1',
                kind: 'regular',
                status: 'interrupting',
                phase: 'non_steerable',
                phaseStartedAt: '2026-04-12T00:00:04.000Z',
                canSteer: false,
                startedAt: '2026-04-12T00:00:00.000Z',
                round: 1,
              },
              followUpQueue: [
                {
                  inputId: 'input_queue_1',
                  content: '继续第二轮',
                  createdAt: '2026-04-12T00:00:05.000Z',
                },
              ],
              recovery: null,
            },
          },
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByRole('button', { name: '中断当前 turn' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '中断当前 turn' }));
    await waitFor(() => {
      expect(interruptCount).toBe(1);
    });

    fireEvent.change(screen.getByPlaceholderText('继续补充信息，系统会按顺序处理'), {
      target: { value: '继续第二轮' },
    });
    fireEvent.click(screen.getByRole('button', { name: '补充信息' }));

    await waitFor(() => {
      expect(sendCount).toBe(1);
      expect(screen.getByText('继续第二轮')).toBeInTheDocument();
    });

    vi.useFakeTimers();

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_turn_1_done',
        event: 'turn_completed',
        data: JSON.stringify({
          turnId: 'turn_1',
          kind: 'regular',
          status: 'interrupted',
        }),
      });
      handleStreamMessage?.({
        id: 'evt_done_1',
        event: 'done',
        data: JSON.stringify({}),
      });
      handleStreamMessage?.({
        id: 'evt_turn_2_started',
        event: 'turn_started',
        data: JSON.stringify({
          turnId: 'turn_2',
          kind: 'regular',
          status: 'running',
          phase: 'sampling',
          phaseStartedAt: '2026-04-12T00:00:06.000Z',
          canSteer: true,
          startedAt: '2026-04-12T00:00:06.000Z',
          round: 1,
          followUpQueueCount: 0,
        }),
      });
      handleStreamMessage?.({
        id: 'evt_delta_2',
        event: 'text_delta',
        data: JSON.stringify({
          content: '这是第二轮的流式输出',
        }),
      });
    });

    expect(screen.getByText('这是第二轮的流式输出')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText('这是第二轮的流式输出')).toBeInTheDocument();
  });

  it('moves a steer input from the bottom preview into the chat stream only after commit confirmation', async () => {
    const committedMessage = {
      id: 'evt_user_1',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'user' as const,
      type: 'text' as const,
      content: '510分，年级排名199/400',
      createdAt: '2026-04-12T00:00:01.000Z',
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [
              {
                inputId: 'input_pending_1',
                content: committedMessage.content,
                createdAt: committedMessage.createdAt,
              },
            ],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('待处理队列（按顺序处理）')).toBeInTheDocument();
    const initialMessageList = document.querySelector('.message-list');
    expect(initialMessageList).not.toHaveTextContent(committedMessage.content);
    expect(document.querySelector('.runtime-preview-stack')).toHaveTextContent(committedMessage.content);

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_commit_1',
        event: 'user_message_committed',
        data: JSON.stringify({
          turnId: 'turn_1',
          inputId: 'input_pending_1',
          content: committedMessage.content,
          createdAt: committedMessage.createdAt,
        }),
      });
    });

    await waitFor(() => {
      expect(document.querySelector('.runtime-preview-stack')).toBeNull();
      expect(document.querySelector('.message-list')).toHaveTextContent(committedMessage.content);
    });

    refetchMessages.resolve(jsonResponse({ body: [committedMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(screen.getByText(committedMessage.content)).toBeInTheDocument();
    });
  });

  it('moves multiple queued inputs into the chat stream as one merged message after a single commit confirmation', async () => {
    const mergedMessage = {
      id: 'evt_user_merged',
      sessionId: 's1',
      kind: 'message' as const,
      role: 'user' as const,
      type: 'text' as const,
      content: '想考公\n想留在上海',
      createdAt: '2026-04-12T00:00:03.000Z',
    };
    const refetchMessages = createDeferred<Response>();
    let messageRequestCount = 0;
    let handleStreamMessage: ((event: { id?: string; event?: string; data?: string }) => void) | undefined;

    fetchEventSourceMock.mockImplementation(async (_input, init) => {
      handleStreamMessage = init?.onmessage as typeof handleStreamMessage;
      await init?.onopen?.(new Response(null, { status: 200 }));
    });

    installFetchMock((url) => {
      if (url === '/api/me/settings') {
        return jsonResponse({ body: { themeMode: 'dark' } });
      }
      if (url === '/api/sessions') {
        return jsonResponse({
          body: [
            {
              id: 's1',
              title: 'Streaming Session',
              createdAt: '2026-04-12T00:00:00.000Z',
              updatedAt: '2026-04-12T00:00:00.000Z',
              lastMessageAt: null,
              activeSkills: [],
            },
          ],
        });
      }
      if (url === '/api/sessions/s1/messages?limit=200') {
        messageRequestCount += 1;
        if (messageRequestCount === 1) {
          return jsonResponse({ body: [] });
        }
        return refetchMessages.promise;
      }
      if (url === '/api/sessions/s1/runtime') {
        return jsonResponse({
          body: {
            sessionId: 's1',
            activeTurn: {
              turnId: 'turn_1',
              kind: 'regular',
              status: 'running',
              phase: 'sampling',
              phaseStartedAt: '2026-04-12T00:00:00.000Z',
              canSteer: true,
              startedAt: '2026-04-12T00:00:00.000Z',
              round: 1,
            },
            followUpQueue: [
              {
                inputId: 'input_pending_1',
                content: '想考公',
                createdAt: '2026-04-12T00:00:01.000Z',
              },
              {
                inputId: 'input_pending_2',
                content: '想留在上海',
                createdAt: '2026-04-12T00:00:02.000Z',
              },
            ],
            recovery: null,
          },
        });
      }
      if (url === '/api/files?sessionId=s1') {
        return jsonResponse({ body: [] });
      }
      if (url === '/api/skills') {
        return jsonResponse({ body: [] });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ user: memberUser, ready: true });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('待处理队列（按顺序处理）')).toBeInTheDocument();
    expect(document.querySelector('.runtime-preview-stack')).toHaveTextContent('1 想考公');
    expect(document.querySelector('.runtime-preview-stack')).toHaveTextContent('2 想留在上海');

    await act(async () => {
      handleStreamMessage?.({
        id: 'evt_commit_merged',
        event: 'user_message_committed',
        data: JSON.stringify({
          turnId: 'turn_1',
          inputId: 'input_merged_1',
          content: mergedMessage.content,
          createdAt: mergedMessage.createdAt,
          consumedInputIds: ['input_pending_1', 'input_pending_2'],
        }),
      });
    });

    await waitFor(() => {
      expect(document.querySelector('.runtime-preview-stack')).toBeNull();
      expect(document.querySelector('.message-list')).toHaveTextContent(/想考公\s*想留在上海/);
    });

    refetchMessages.resolve(jsonResponse({ body: [mergedMessage] }));

    await waitFor(() => {
      expect(messageRequestCount).toBe(2);
      expect(document.querySelector('.message-list')).toHaveTextContent(/想考公\s*想留在上海/);
    });
  });
});

