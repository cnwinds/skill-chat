import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat-service.js';
import type { AppConfig } from '../../config/env.js';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const waitForCondition = async (assertion: () => void, attempts = 40) => {
  let lastError: unknown;

  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushAsync();
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Condition was not met in time');
};

const testConfig = (): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: 'D:/ai_projects/qizhi/.tmp/skillchat-data',
  SKILLS_ROOT: 'D:/ai_projects/qizhi/.tmp/skillchat-data/skills',
  MARKET_BASE_URL: 'http://localhost:3100',
  INSTALLED_SKILLS_ROOT: 'D:/ai_projects/qizhi/.tmp/skillchat-data/installed-skills',
  DB_PATH: 'D:/ai_projects/qizhi/.tmp/skillchat-data/skillchat.sqlite',
  CWD: '/workspace/qizhi',
  INLINE_JOBS: true,
  SESSION_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL: 'gpt-5.4',
  WEB_SEARCH_MODE: 'live',
  OPENAI_REASONING_EFFORT: 'high',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1000,
  STREAM_MAX_RETRIES: 5,
  STREAM_BACKOFF_BASE_MS: 1000,
  STREAM_BACKOFF_MULTIPLIER: 2,
  ENABLE_TOKEN_TRACKING: true,
  ENABLE_REASONING_EVENTS: false,
  IMAGE_THUMBNAIL_THRESHOLD_BYTES: 256 * 1024,
  IMAGE_THUMBNAIL_MAX_WIDTH: 640,
  IMAGE_THUMBNAIL_MAX_HEIGHT: 640,
  IMAGE_THUMBNAIL_QUALITY: 78,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120000,
});

const createSkill = (name: string) => ({
  name,
  description: `${name} desc`,
  directory: `/tmp/skills/${name}`,
  markdown: `# ${name}`,
  starterPrompts: [],
});

const createService = (options: {
  config?: AppConfig;
  activeSkills?: string[];
  skills?: Array<ReturnType<typeof createSkill>>;
  fileContext?: Array<Record<string, unknown>>;
  harnessRun?: ReturnType<typeof vi.fn>;
  compactContext?: ReturnType<typeof vi.fn>;
  contextState?: { version: 1; latestCompaction: null | { summary: string; createdAt: string; baselineCreatedAt: string | null; trigger: 'manual' | 'auto' } };
  seededEvents?: Array<Record<string, unknown>>;
} = {}) => {
  const storedEvents: Array<Record<string, unknown>> = [...(options.seededEvents ?? [])];
  const appendEvent = vi.fn(async (_userId: string, _sessionId: string, event: Record<string, unknown>) => {
    storedEvents.push(event);
  });
  const publish = vi.fn();
  const config = options.config ?? testConfig();
  const skills = options.skills ?? [];
  const compactContext = options.compactContext ?? vi.fn(async () => '压缩后的摘要');
  const contextStore = {
    load: vi.fn(async () => options.contextState ?? { version: 1, latestCompaction: null }),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };
  const session = {
    id: 's1',
    title: '新会话',
    createdAt: '',
    updatedAt: '',
    lastMessageAt: null,
    activeSkills: options.activeSkills ?? [],
  };
  const harnessRun = options.harnessRun ?? vi.fn(async ({ callbacks }: {
    callbacks?: { onTextDelta?: (content: string) => Promise<void> | void };
  }) => {
    await callbacks?.onTextDelta?.('默认回复');
    return { finalText: '默认回复', roundsUsed: 1 };
  });
  const runtimePersistence = {
    load: vi.fn(async () => null),
    save: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
  };

  const service = new ChatService(
    {
      appendEvent,
      readEvents: vi.fn(async () => storedEvents),
    } as never,
    {
      publish,
    } as never,
    {
      get: vi.fn((skillName: string) => {
        const skill = skills.find((item) => item.name === skillName);
        if (!skill) {
          throw new Error(`missing skill ${skillName}`);
        }
        return skill;
      }),
    } as never,
    {
      hasUserInstalled: vi.fn(() => true),
    } as never,
    {
      getFileContext: vi.fn().mockReturnValue(options.fileContext ?? []),
    } as never,
    {
      requireOwned: vi.fn().mockReturnValue(session),
      renameFromMessage: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
    } as never,
    config,
    {
      run: harnessRun,
      compactContext,
    } as never,
    contextStore as never,
  );
  (service as unknown as { getRuntimePersistence: () => typeof runtimePersistence }).getRuntimePersistence = () => runtimePersistence;

  return {
    service,
    storedEvents,
    appendEvent,
    publish,
    harnessRun,
    compactContext,
    contextStore,
    runtimePersistence,
  };
};

describe('ChatService harness-only flow', () => {
  it('streams harness tool callbacks, artifacts, and final assistant text', async () => {
    const skill = createSkill('zhangxuefeng-perspective');
    const harnessRun = vi.fn(async ({ availableSkills, callbacks }: {
      availableSkills?: Array<{ name: string }>;
      callbacks?: {
        onToolCall?: (event: {
          callId: string;
          tool: string;
          arguments: Record<string, unknown>;
        }) => Promise<void> | void;
        onToolProgress?: (event: {
          callId: string;
          tool: string;
          message: string;
          status?: string;
        }) => Promise<void> | void;
        onToolResult?: (event: {
          callId: string;
          tool: string;
          summary: string;
          content?: string;
        }) => Promise<void> | void;
        onArtifact?: (file: Record<string, unknown>) => Promise<void> | void;
        onTextDelta?: (content: string) => Promise<void> | void;
        onTokenUsage?: (usage: {
          inputTokens: number;
          outputTokens: number;
          totalTokens: number;
        }) => Promise<void> | void;
      };
    }) => {
      expect(availableSkills?.map((item) => item.name)).toEqual(['zhangxuefeng-perspective']);
      await callbacks?.onToolCall?.({
        callId: 'call_web',
        tool: 'web_search',
        arguments: { query: '人工智能专业 就业 薪资' },
      });
      await callbacks?.onToolProgress?.({
        callId: 'call_web',
        tool: 'web_search',
        message: '正在联网搜索',
        status: 'running',
      });
      await callbacks?.onToolResult?.({
        callId: 'call_web',
        tool: 'web_search',
        summary: '已完成联网搜索',
        content: '找到 3 条最新结果',
      });
      await callbacks?.onArtifact?.({
        id: 'file_1',
        userId: 'u1',
        sessionId: 's1',
        displayName: 'report.md',
        relativePath: 'sessions/s1/outputs/report.md',
        mimeType: 'text/markdown',
        size: 128,
        bucket: 'outputs',
        source: 'generated',
        createdAt: new Date().toISOString(),
        downloadUrl: '/api/files/file_1/download',
      });
      await callbacks?.onTextDelta?.('先看数据。');
      await callbacks?.onTextDelta?.('再给结论。');
      await callbacks?.onTokenUsage?.({
        inputTokens: 120,
        outputTokens: 45,
        totalTokens: 165,
      });
      return {
        finalText: '先看数据。再给结论。',
        roundsUsed: 1,
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      };
    });

    const { service, storedEvents, publish } = createService({
      skills: [skill],
      activeSkills: [skill.name],
      harnessRun,
    });

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '帮我分析人工智能专业',
    );

    expect(storedEvents.map((event) => event.kind)).toEqual([
      'message',
      'tool_call',
      'tool_progress',
      'tool_result',
      'file',
      'message',
    ]);
    expect(storedEvents[5]).toMatchObject({
      kind: 'message',
      role: 'assistant',
      content: '先看数据。再给结论。',
      meta: {
        turnId: expect.any(String),
        durationMs: expect.any(Number),
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      },
    });
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({
      event: 'file_ready',
    }));
    expect(
      publish.mock.calls
        .map(([_, event]) => event.event)
        .filter((name) => name === 'text_delta'),
    ).toHaveLength(2);
  });

  it('persists generated images from harness callbacks and publishes file_ready', async () => {
    const imageFile = {
      id: 'file_img_1',
      userId: 'u1',
      sessionId: 's1',
      displayName: 'generated-scene.png',
      relativePath: 'sessions/s1/outputs/generated-scene.png',
      mimeType: 'image/png',
      size: 4096,
      bucket: 'outputs',
      source: 'generated',
      createdAt: '2026-04-12T00:00:00.000Z',
      downloadUrl: '/api/files/file_img_1/download',
    };
    const harnessRun = vi.fn(async ({ callbacks }: {
      callbacks?: {
        onImageGenerated?: (event: {
          source: 'responses_tool';
          model: string;
          operation: 'generate' | 'edit';
          file: Record<string, unknown>;
          prompt: string;
          revisedPrompt?: string;
          inputFileIds?: string[];
        }) => Promise<void> | void;
      };
    }) => {
      await callbacks?.onImageGenerated?.({
        source: 'responses_tool',
        model: 'gpt-image-2',
        operation: 'edit',
        file: imageFile,
        prompt: '把这张图改成黄昏海边',
        revisedPrompt: '黄昏海边，暖色电影感',
        inputFileIds: ['upload_img_1'],
      });
      return {
        finalText: '',
        roundsUsed: 1,
      };
    });

    const { service, storedEvents, publish } = createService({ harnessRun });

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '把这张图改成黄昏海边',
    );

    expect(storedEvents.map((event) => event.kind)).toEqual([
      'message',
      'image',
    ]);
    expect(storedEvents[1]).toMatchObject({
      kind: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      operation: 'edit',
      source: 'responses_tool',
      prompt: '把这张图改成黄昏海边',
      revisedPrompt: '黄昏海边，暖色电影感',
      inputFileIds: ['upload_img_1'],
      file: imageFile,
    });
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({
      event: 'file_ready',
      data: {
        file: {
          id: 'file_img_1',
          name: 'generated-scene.png',
          size: 4096,
          url: '/api/files/file_img_1/download',
        },
      },
    }));
  });

  it('continues the same turn when harness drains a steer input between rounds', async () => {
    const releaseFirstRound = createDeferred<void>();
    const roundStarts: number[] = [];
    const harnessRun = vi.fn(async ({ startingRound, drainPendingInputs, callbacks }: {
      startingRound?: number;
      drainPendingInputs?: () => Promise<Array<{ content: string }>>;
      callbacks?: {
        onRoundStart?: (round: number) => Promise<void> | void;
        onTextDelta?: (content: string) => Promise<void> | void;
      };
    }) => {
      const firstRound = startingRound ?? 1;
      await callbacks?.onRoundStart?.(firstRound);
      roundStarts.push(firstRound);
      await callbacks?.onTextDelta?.('第一轮回复\n');
      await releaseFirstRound.promise;

      const pendingInputs = await drainPendingInputs?.() ?? [];
      if (pendingInputs.length > 0) {
        await callbacks?.onRoundStart?.(firstRound + 1);
        roundStarts.push(firstRound + 1);
        await callbacks?.onTextDelta?.(`跟进回复：${pendingInputs.map((item) => item.content).join('\n')}`);
        return {
          finalText: `第一轮回复\n跟进回复：${pendingInputs.map((item) => item.content).join('\n')}`,
          roundsUsed: 2,
        };
      }

      return { finalText: '第一轮回复', roundsUsed: 1 };
    });

    const { service, storedEvents } = createService({ harnessRun });

    const started = await service.dispatchMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      { content: '第一轮请求' },
    );

    await waitForCondition(() => {
      expect(harnessRun).toHaveBeenCalledTimes(1);
    });

    const steer = await service.steerTurn(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      started.response.turnId!,
      '补充：先看失败测试',
    );
    expect(steer.response.dispatch).toBe('steer_accepted');

    releaseFirstRound.resolve();
    await started.task;

    expect(roundStarts).toEqual([1, 2]);
    expect(
      storedEvents
        .filter((event) => event.kind === 'message')
        .map((event) => ({
          role: event.role,
          content: event.content,
        })),
    ).toEqual([
      { role: 'user', content: '第一轮请求' },
      { role: 'assistant', content: '第一轮回复\n' },
      { role: 'user', content: '补充：先看失败测试' },
      { role: 'assistant', content: '跟进回复：补充：先看失败测试' },
    ]);
  });

  it('merges multiple steer inputs into one committed follow-up when harness drains them', async () => {
    const releaseFirstRound = createDeferred<void>();
    const harnessRun = vi.fn(async ({ drainPendingInputs, callbacks }: {
      drainPendingInputs?: () => Promise<Array<{ content: string }>>;
      callbacks?: {
        onTextDelta?: (content: string) => Promise<void> | void;
      };
    }) => {
      await callbacks?.onTextDelta?.('第一轮回复\n');
      await releaseFirstRound.promise;
      const pendingInputs = await drainPendingInputs?.() ?? [];
      await callbacks?.onTextDelta?.(`合并跟进：${pendingInputs.map((item) => item.content).join(' | ')}`);
      return {
        finalText: `第一轮回复\n合并跟进：${pendingInputs.map((item) => item.content).join(' | ')}`,
        roundsUsed: pendingInputs.length > 0 ? 2 : 1,
      };
    });

    const { service, storedEvents } = createService({ harnessRun });

    const started = await service.dispatchMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      { content: '第一轮请求' },
    );

    await waitForCondition(() => {
      expect(harnessRun).toHaveBeenCalledTimes(1);
    });

    await service.steerTurn(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      started.response.turnId!,
      '510分，年级排名199/400',
    );
    await service.steerTurn(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      started.response.turnId!,
      '文科 政史地',
    );

    releaseFirstRound.resolve();
    await started.task;

    expect(
      storedEvents
        .filter((event) => event.kind === 'message' && event.role === 'user')
        .map((event) => event.content),
    ).toEqual(['第一轮请求', '510分，年级排名199/400\n文科 政史地']);
  });

  it('surfaces harness errors and persists failure events without falling back', async () => {
    const config = testConfig();
    config.OPENAI_API_KEY = '';
    const harnessRun = vi.fn(async () => {
      throw new Error('OpenAI API key is not configured');
    });

    const { service, appendEvent } = createService({
      config,
      harnessRun,
    });

    await expect(service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '你好',
    )).rejects.toThrow('OpenAI API key is not configured');

    await service.handleFailure('u1', 's1', new Error('OpenAI API key is not configured'));

    expect(appendEvent).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({
        kind: 'error',
        message: 'OpenAI API key is not configured',
      }),
    );
  });

  it('runs /compact as a dedicated context compaction turn', async () => {
    const compactContext = vi.fn(async () => '用户关注就业和城市，已读取张雪峰 skill。');
    const { service, storedEvents, compactContext: compactMock, contextStore, publish, harnessRun } = createService({
      compactContext,
      seededEvents: [
        {
          id: 'evt_old_user',
          sessionId: 's1',
          kind: 'message',
          role: 'user',
          type: 'text',
          content: '先帮我分析计算机专业',
          createdAt: '2026-04-13T10:00:00.000Z',
        },
        {
          id: 'evt_old_assistant',
          sessionId: 's1',
          kind: 'message',
          role: 'assistant',
          type: 'text',
          content: '先看就业和城市。',
          createdAt: '2026-04-13T10:00:01.000Z',
        },
      ],
    });

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '/compact',
    );

    expect(compactMock).toHaveBeenCalledTimes(1);
    expect(harnessRun).not.toHaveBeenCalled();
    expect(contextStore.save).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({
        version: 1,
        latestCompaction: expect.objectContaining({
          summary: '用户关注就业和城市，已读取张雪峰 skill。',
          trigger: 'manual',
        }),
      }),
    );
    expect(
      storedEvents
        .filter((event) => event.kind === 'message' && event.role === 'assistant')
        .map((event) => event.content),
    ).toContain('上下文已压缩，后续对话会基于摘要继续。');
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({
      event: 'text_delta',
      data: {
        content: '上下文已压缩，后续对话会基于摘要继续。',
      },
    }));
  });

  it('auto compacts long history before a regular turn and passes the compacted state into harness', async () => {
    const config = {
      ...testConfig(),
      MODEL_AUTO_COMPACT_TOKEN_LIMIT: 20,
    };
    const compactContext = vi.fn(async () => '压缩摘要：用户持续关注高考志愿、就业和城市。');
    const harnessRun = vi.fn(async ({ contextState, callbacks }: {
      contextState?: { latestCompaction: { summary: string } | null };
      callbacks?: { onTextDelta?: (content: string) => Promise<void> | void };
    }) => {
      expect(contextState?.latestCompaction?.summary).toContain('压缩摘要');
      await callbacks?.onTextDelta?.('基于压缩摘要继续分析。');
      return {
        finalText: '基于压缩摘要继续分析。',
        roundsUsed: 1,
      };
    });

    const { service, compactContext: compactMock, contextStore, storedEvents } = createService({
      config,
      compactContext,
      harnessRun,
      seededEvents: [
        {
          id: 'evt_u1',
          sessionId: 's1',
          kind: 'message',
          role: 'user',
          type: 'text',
          content: '请分析人工智能、口腔医学和电气工程的就业、城市和薪资差异。',
          createdAt: '2026-04-13T10:00:00.000Z',
        },
        {
          id: 'evt_a1',
          sessionId: 's1',
          kind: 'message',
          role: 'assistant',
          type: 'text',
          content: '先看就业，再看城市和行业集中度。',
          createdAt: '2026-04-13T10:00:01.000Z',
        },
      ],
    });

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '继续，把上海和杭州也纳入比较。',
    );

    expect(compactMock).toHaveBeenCalledTimes(1);
    expect(contextStore.save).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({
        latestCompaction: expect.objectContaining({
          trigger: 'auto',
          summary: '压缩摘要：用户持续关注高考志愿、就业和城市。',
        }),
      }),
    );
    expect(
      storedEvents
        .filter((event) => event.kind === 'message' && event.role === 'assistant')
        .map((event) => event.content),
    ).toContain('基于压缩摘要继续分析。');
  });
});
