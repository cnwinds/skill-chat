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
  webOrigin: 'http://localhost:5173',
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
  fetchEventSourceMock.mockReset();
  fetchEventSourceMock.mockImplementation(async (_input, init) => {
    await init?.onopen?.(new Response(null, { status: 200 }));
  });
});

afterEach(() => {
  cleanup();
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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
          activeTurnId: 'turn_1',
          activeTurnKind: 'regular',
          activeTurnStatus: 'running',
          activeTurnPhase: 'sampling',
          activeTurnPhaseStartedAt: '2026-04-12T00:00:00.000Z',
          activeTurnCanSteer: true,
          activeTurnRound: 1,
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

    useAuthStore.setState({ token: 'token-admin', user: adminUser });
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText('Session 5')).toBeInTheDocument();
    expect(screen.queryByText('Session 6')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '更多会话（还有 2 条）' })[0]);

    expect(await screen.findByText('Session 6')).toBeInTheDocument();
    expect(screen.getByText('Session 7')).toBeInTheDocument();
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/正在思考\(/)).toBeInTheDocument();
    expect(screen.getByText('regular / sampling / round 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Session 2/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Session 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Session 1/ }));

    expect(await screen.findByText(/正在思考\(/)).toBeInTheDocument();
    expect(screen.getByText('regular / sampling / round 2')).toBeInTheDocument();
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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
              entrypoint: '',
              runtime: 'chat',
              timeoutSec: 120,
              references: [],
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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
              entrypoint: '',
              runtime: 'chat',
              timeoutSec: 120,
              references: [],
              starterPrompts: [
                '扮演张雪峰，帮我看看这个分数怎么填志愿',
              ],
            },
            {
              name: 'pdf',
              description: '导出 PDF',
              entrypoint: '',
              runtime: 'tool',
              timeoutSec: 120,
              references: [],
              starterPrompts: [
                '帮我把这份内容整理成 PDF',
              ],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${url}`);
    });

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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
              entrypoint: '',
              runtime: 'chat',
              timeoutSec: 120,
              references: [],
              starterPrompts: [],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app']);

    expect(await screen.findByText('还没有会话')).toBeInTheDocument();
    expect(createPayload).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('会话标题'), {
      target: { value: '高校咨询' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入会话' }));
    fireEvent.click(screen.getByRole('button', { name: '创建会话' }));

    await waitFor(() => {
      expect(createPayload).toEqual({
        title: '高校咨询',
        activeSkills: ['zhangxuefeng-perspective'],
      });
    });
    expect(await screen.findByRole('heading', { name: '高校咨询' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Skill' })[1]);
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
              entrypoint: '',
              runtime: 'python',
              timeoutSec: 120,
              references: [],
              starterPrompts: [],
            },
          ],
        });
      }

      throw new Error(`Unhandled fetch: ${method} ${url}`);
    });

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    expect(await screen.findByRole('heading', { level: 1, name: '旧会话' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入会话' }));
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
        expect(init?.body).toBe(JSON.stringify({ content: '补充：先修后端', dispatch: 'auto', turnId: 'turn_1' }));
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
    renderApp(['/app/session/s1']);

    expect(await screen.findByText(/正在思考\(/)).toBeInTheDocument();
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
    expect(screen.getByText(/正在思考\(/)).toBeInTheDocument();
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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

    useAuthStore.setState({ token: 'token-member', user: memberUser });
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
