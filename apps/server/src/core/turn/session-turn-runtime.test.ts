import { describe, expect, it } from 'vitest';
import type { PersistedRuntimeState, RuntimePersistence } from './turn-types.js';
import { SessionTurnRuntime } from './session-turn-runtime.js';

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
};

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createMemoryPersistence = (initialState: PersistedRuntimeState | null = null) => {
  let snapshot = initialState ? structuredClone(initialState) : null;

  const persistence: RuntimePersistence = {
    load: async () => snapshot ? structuredClone(snapshot) : null,
    save: async (next) => {
      snapshot = structuredClone(next);
    },
    clear: async () => {
      snapshot = null;
    },
  };

  return {
    persistence,
    read: () => snapshot ? structuredClone(snapshot) : null,
  };
};

const user = {
  id: 'u1',
  username: 'tester',
  role: 'member' as const,
};

describe('SessionTurnRuntime', () => {
  it('accepts steer input into the active regular turn and commits it at the next drain boundary', async () => {
    const committed: string[] = [];
    const publishedEvents: string[] = [];
    const releaseTurn = createDeferred<void>();
    let drained: string[] = [];
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async ({ input }) => {
          committed.push(input.content);
        },
        onExecuteTurn: async (execution) => {
          expect(execution.kind).toBe('regular');
          execution.setCanSteer(true);
          await releaseTurn.promise;
          drained = (await execution.drainPendingInputs()).map((input) => input.content);
        },
        onTurnFailure: async () => undefined,
        publish: (event) => {
          publishedEvents.push(event.event);
        },
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '先分析代码结构',
    });

    expect(started.response.dispatch).toBe('turn_started');
    expect(started.response.turnId).toBeTruthy();
    expect(started.response.runtime.activeTurn).toMatchObject({
      kind: 'regular',
      phase: 'sampling',
      round: 1,
    });

    const steer = await runtime.steerTurn(user, started.response.turnId!, '补充：先看失败测试');
    expect(steer.response.dispatch).toBe('steer_accepted');
    expect(runtime.getSnapshot().followUpQueue).toHaveLength(1);

    releaseTurn.resolve();
    await started.task;

    expect(drained).toEqual(['补充：先看失败测试']);
    expect(committed).toEqual(['先分析代码结构', '补充：先看失败测试']);
    expect(publishedEvents).toEqual(expect.arrayContaining([
      'turn_started',
      'turn_status',
      'user_message_committed',
      'turn_completed',
      'done',
    ]));
    expect(storage.read()).toBeNull();
    expect(runtime.getSnapshot()).toEqual({
      sessionId: 's1',
      activeTurn: null,
      followUpQueue: [],
      recovery: null,
    });
  });

  it('queues steer requests for non-regular turns instead of accepting them into the active turn', async () => {
    const releaseTurn = createDeferred<void>();
    const executedInputs: string[] = [];
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async () => undefined,
        onExecuteTurn: async (execution) => {
          executedInputs.push(execution.initialInput.content);
          await releaseTurn.promise;
        },
        onTurnFailure: async () => undefined,
        publish: () => undefined,
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '/review 看看这里的变更风险',
      kind: 'review',
    });

    expect(started.response.runtime.activeTurn).toMatchObject({
      kind: 'review',
      canSteer: false,
      phase: 'non_steerable',
    });

    const steer = await runtime.steerTurn(user, started.response.turnId!, '补充：顺便检查测试缺口');
    expect(steer.response.dispatch).toBe('queued');
    expect(runtime.getSnapshot().followUpQueue.map((input) => input.content)).toEqual(['补充：顺便检查测试缺口']);

    releaseTurn.resolve();
    await started.task;
    await flushAsync();

    expect(executedInputs).toEqual([
      '/review 看看这里的变更风险',
      '补充：顺便检查测试缺口',
    ]);
  });

  it('keeps later inputs queued behind earlier queued inputs instead of letting them re-enter the current turn', async () => {
    const unblockTurn = createDeferred<void>();
    let allowSteerAgain!: () => void;
    const steerEnabledAgain = new Promise<void>((resolve) => {
      allowSteerAgain = resolve;
    });
    const executedInputs: string[] = [];
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async () => undefined,
        onExecuteTurn: async (execution) => {
          executedInputs.push(execution.initialInput.content);
          if (execution.initialInput.content !== '初始请求') {
            return;
          }

          execution.setCanSteer(false);
          await steerEnabledAgain;
          execution.setCanSteer(true);
          await unblockTurn.promise;
        },
        onTurnFailure: async () => undefined,
        publish: () => undefined,
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '初始请求',
    });

    const firstQueued = await runtime.steerTurn(user, started.response.turnId!, '文科 政史地');
    expect(firstQueued.response.dispatch).toBe('queued');
    expect(runtime.getSnapshot().followUpQueue.map((input) => input.content)).toEqual(['文科 政史地']);

    allowSteerAgain();
    await flushAsync();

    const secondQueued = await runtime.steerTurn(user, started.response.turnId!, '可以考公务员');
    expect(secondQueued.response.dispatch).toBe('queued');
    expect(runtime.getSnapshot().followUpQueue.map((input) => input.content)).toEqual([
      '文科 政史地',
      '可以考公务员',
    ]);

    unblockTurn.resolve();
    await started.task;
    await flushAsync();

    expect(executedInputs).toEqual([
      '初始请求',
      '文科 政史地\n可以考公务员',
    ]);
  });

  it('commits multiple pending steer inputs into one merged follow-up message when the turn drains them', async () => {
    const releaseTurn = createDeferred<void>();
    const committed: string[] = [];
    const publishedCommittedPayloads: Array<{ content: string; consumedInputIds?: string[] }> = [];
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async ({ input }) => {
          committed.push(input.content);
        },
        onExecuteTurn: async (execution) => {
          await releaseTurn.promise;
          await execution.drainPendingInputs();
        },
        onTurnFailure: async () => undefined,
        publish: (event) => {
          if (event.event === 'user_message_committed') {
            publishedCommittedPayloads.push(event.data as { content: string; consumedInputIds?: string[] });
          }
        },
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '先分析代码结构',
    });

    await runtime.steerTurn(user, started.response.turnId!, '510分，年级排名199/400');
    await runtime.steerTurn(user, started.response.turnId!, '文科 政史地');

    releaseTurn.resolve();
    await started.task;

    expect(committed).toEqual([
      '先分析代码结构',
      '510分，年级排名199/400\n文科 政史地',
    ]);
    expect(publishedCommittedPayloads.at(-1)).toMatchObject({
      content: '510分，年级排名199/400\n文科 政史地',
      consumedInputIds: expect.arrayContaining([
        expect.stringMatching(/^input_/),
        expect.stringMatching(/^input_/),
      ]),
    });
  });

  it('removes a pending or queued follow-up input by inputId', async () => {
    const releaseTurn = createDeferred<void>();
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async () => undefined,
        onExecuteTurn: async () => {
          await releaseTurn.promise;
        },
        onTurnFailure: async () => undefined,
        publish: () => undefined,
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '初始请求',
    });

    const pending = await runtime.steerTurn(user, started.response.turnId!, '文科 政史地');
    const queued = await runtime.dispatchMessage({
      user,
      content: '可以考公务员',
      mode: 'queue_next',
      turnId: started.response.turnId,
    });

    expect(runtime.getSnapshot().followUpQueue.map((input) => input.content)).toEqual([
      '文科 政史地',
      '可以考公务员',
    ]);

    await runtime.removeFollowUpInput(user, pending.response.inputId);
    expect(runtime.getSnapshot().followUpQueue.map((input) => input.content)).toEqual(['可以考公务员']);

    await runtime.removeFollowUpInput(user, queued.response.inputId);
    expect(runtime.getSnapshot().followUpQueue).toEqual([]);

    releaseTurn.resolve();
    await started.task;
  });

  it('recovers persisted pending inputs after process restart and exposes a recovery snapshot', async () => {
    const initialState: PersistedRuntimeState = {
      sessionId: 's1',
      activeTurn: {
        turnId: 'turn_old',
        kind: 'regular',
        status: 'running',
        phase: 'streaming_assistant',
        phaseStartedAt: '2026-04-12T00:00:02.000Z',
        canSteer: true,
        startedAt: '2026-04-12T00:00:00.000Z',
        round: 3,
        pendingInputs: [
          {
            inputId: 'input_pending',
            content: '先看失败测试',
            createdAt: '2026-04-12T00:00:03.000Z',
            source: 'steer',
            requestedKind: 'regular',
          },
        ],
      },
      queuedInputs: [
        {
          inputId: 'input_queued',
          content: '下一轮整理文档',
          createdAt: '2026-04-12T00:00:04.000Z',
          source: 'queued',
          requestedKind: 'regular',
        },
      ],
      recovery: null,
    };
    const storage = createMemoryPersistence(initialState);

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async () => undefined,
        onExecuteTurn: async () => undefined,
        onTurnFailure: async () => undefined,
        publish: () => undefined,
      },
      storage.persistence,
      initialState,
    );

    await flushAsync();

    expect(runtime.getSnapshot()).toEqual({
      sessionId: 's1',
      activeTurn: null,
      followUpQueue: [
        {
          inputId: 'input_pending',
          content: '先看失败测试',
          createdAt: '2026-04-12T00:00:03.000Z',
        },
        {
          inputId: 'input_queued',
          content: '下一轮整理文档',
          createdAt: '2026-04-12T00:00:04.000Z',
        },
      ],
      recovery: {
        recoveredAt: expect.any(String),
        previousTurnId: 'turn_old',
        previousTurnKind: 'regular',
        reason: 'process_restarted',
      },
    });
    expect(storage.read()).toMatchObject({
      recovery: {
        previousTurnId: 'turn_old',
        previousTurnKind: 'regular',
        reason: 'process_restarted',
      },
      activeTurn: null,
      queuedInputs: [
        expect.objectContaining({ inputId: 'input_pending', source: 'steer' }),
        expect.objectContaining({ inputId: 'input_queued', source: 'queued' }),
      ],
    });
  });

  it('does not leak unhandled rejections when a background turn fails after dispatch returns', async () => {
    const failures: string[] = [];
    const storage = createMemoryPersistence();

    const runtime = new SessionTurnRuntime(
      's1',
      {
        onInputCommitted: async () => undefined,
        onExecuteTurn: async () => {
          throw new Error('upstream 502');
        },
        onTurnFailure: async ({ error }) => {
          failures.push((error as Error).message);
        },
        publish: () => undefined,
      },
      storage.persistence,
    );

    const started = await runtime.dispatchMessage({
      user,
      content: '先分析代码结构',
    });

    await flushAsync();

    expect(failures).toEqual(['upstream 502']);
    expect(runtime.getSnapshot().activeTurn).toBeNull();
    await expect(started.task).rejects.toThrow('upstream 502');
  });
});
