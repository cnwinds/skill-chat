import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import * as tar from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';
import { getSessionMessagesPath, getSessionRoot, getSessionTurnRuntimePath } from './core/storage/paths.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skillsRoot = path.join(repoRoot, 'skills');
const originalFetch = globalThis.fetch.bind(globalThis);

const createResponsesStreamResponse = (events: Array<{ event: string; data: unknown }>) => new Response(
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const item of events) {
        controller.enqueue(encoder.encode(`event: ${item.event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item.data)}\n\n`));
      }
      controller.close();
    },
  }),
  {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  },
);

const createHarnessResponsesResponse = (body: BodyInit | null | undefined) => {
  const payload = JSON.parse(typeof body === 'string' ? body : String(body ?? '{}')) as {
    input?: Array<Record<string, unknown>>;
  };
  const inputItems = payload.input ?? [];
  const latestUserMessage = [...inputItems]
    .reverse()
    .find((item) => item.role === 'user' && typeof item.content === 'string')?.content as string | undefined;
  const hasFunctionOutput = inputItems.some((item) => item.type === 'function_call_output');

  if (hasFunctionOutput) {
    const finalDelta = latestUserMessage?.includes('张雪峰')
      ? '我跟你说，这事得看数据和就业。'
      : '产物已经生成。';
    return createResponsesStreamResponse([
      {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          delta: finalDelta,
        },
      },
    ]);
  }

  if (latestUserMessage?.includes('PDF')) {
    return createResponsesStreamResponse([
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          item: {
            id: 'fc_pdf',
            type: 'function_call',
            call_id: 'call_run_pdf',
            name: 'run_workspace_script',
            arguments: JSON.stringify({
              path: 'skills/artifact-smoke/scripts/make-artifact.js',
              args: [
                'outputs/weekly-sales-report.pdf',
                'generated pdf body',
              ],
            }),
          },
        },
      },
    ]);
  }

  if (latestUserMessage?.includes('Excel') || latestUserMessage?.includes('CSV')) {
    return createResponsesStreamResponse([
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          item: {
            id: 'fc_xlsx',
            type: 'function_call',
            call_id: 'call_run_xlsx',
            name: 'run_workspace_script',
            arguments: JSON.stringify({
              path: 'skills/artifact-smoke/scripts/make-artifact.js',
              args: [
                'outputs/sales-chart.xlsx',
                'generated xlsx body',
              ],
            }),
          },
        },
      },
    ]);
  }

  if (latestUserMessage?.includes('张雪峰')) {
    return createResponsesStreamResponse([
      {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          delta: '我跟你说，这个专业不能只看名字，得先看就业。',
        },
      },
    ]);
  }

  return createResponsesStreamResponse([
    {
      event: 'response.output_text.delta',
      data: {
        type: 'response.output_text.delta',
        delta: '测试回复',
      },
    },
  ]);
};

const seedInviteCode = (dbPath: string, code: string) => {
  const db = new Database(dbPath);
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code);
  db.close();
};

type TestAuthSession = {
  cookie: string;
  user: {
    id: string;
    username: string;
    role: string;
  };
};

const readSessionCookie = (response: Awaited<ReturnType<FastifyInstance['inject']>>) => {
  const header = response.headers['set-cookie'];
  const rawCookie = Array.isArray(header) ? header[0] : header;
  expect(rawCookie).toBeTruthy();
  return String(rawCookie).split(';')[0]!;
};

const bootstrapAdmin = async (app: FastifyInstance, username = 'admin_user') => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/system/bootstrap-admin',
    payload: {
      username,
      password: 'secret123',
    },
  });

  expect(response.statusCode).toBe(200);
  return {
    cookie: readSessionCookie(response),
    user: (response.json() as { user: { id: string; username: string; role: string } }).user,
  } satisfies TestAuthSession;
};

const registerAndLogin = async (app: FastifyInstance, username: string) => {
  const inviteCode = `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  seedInviteCode(app.config.DB_PATH, inviteCode);

  const registerResponse = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: {
      username,
      password: 'secret123',
      inviteCode,
    },
  });

  expect(registerResponse.statusCode).toBe(200);
  const payload = registerResponse.json() as { user: { id: string; username: string; role: string } };
  return {
    cookie: readSessionCookie(registerResponse),
    user: payload.user,
  } satisfies TestAuthSession;
};

const createSession = async (app: FastifyInstance, cookie: string, title?: string, activeSkills?: string[]) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: {
      cookie,
    },
    payload: {
      ...(title ? { title } : {}),
      ...(activeSkills ? { activeSkills } : {}),
    },
  });

  expect(response.statusCode).toBe(200);
  return response.json() as { id: string; title: string; activeSkills: string[] };
};

describe('SkillChat server', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let tempSkillsRoot: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-test-'));
    tempSkillsRoot = path.join(tempDir, 'skills');
    await fs.cp(skillsRoot, tempSkillsRoot, { recursive: true });
    await fs.mkdir(path.join(tempSkillsRoot, 'artifact-smoke', 'scripts'), { recursive: true });
    await fs.writeFile(path.join(tempSkillsRoot, 'artifact-smoke', 'SKILL.md'), [
      '---',
      'name: artifact-smoke',
      'description: test-only artifact generation fixture',
      '---',
      '',
      '# Artifact Smoke',
      '',
      'A test-only skill used by integration tests.',
    ].join('\n'), 'utf8');
    await fs.writeFile(path.join(tempSkillsRoot, 'artifact-smoke', 'scripts', 'make-artifact.js'), [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const outputArg = process.argv[2];",
      "const body = process.argv[3] ?? '';",
      "if (!outputArg || !outputArg.startsWith('outputs/')) {",
      "  throw new Error('output path must be inside outputs/');",
      "}",
      "const outputPath = path.resolve(process.cwd(), outputArg);",
      "fs.mkdirSync(path.dirname(outputPath), { recursive: true });",
      "fs.writeFileSync(outputPath, body || `generated:${path.basename(outputPath)}`, 'utf8');",
      "process.stdout.write(JSON.stringify({ type: 'artifact', path: outputArg, label: path.basename(outputPath) }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'result', message: 'done' }) + '\\n');",
    ].join('\n'), 'utf8');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
      if (/\/responses$/.test(url)) {
        return createHarnessResponsesResponse(init?.body);
      }
      return originalFetch(input as RequestInfo | URL, init);
    }));
    app = await createApp({
      cwd: tempDir,
      inlineJobs: true,
      configOverrides: {
        NODE_ENV: 'test',
        DATA_ROOT: tempDir,
        SKILLS_ROOT: tempSkillsRoot,
        WEB_ORIGIN: 'http://localhost:5173',
        ENABLE_ASSISTANT_TOOLS: false,
        OPENAI_API_KEY: 'test-token',
        IMAGE_THUMBNAIL_THRESHOLD_BYTES: 1,
        IMAGE_THUMBNAIL_MAX_WIDTH: 32,
        IMAGE_THUMBNAIL_MAX_HEIGHT: 32,
      },
    });
  });

  afterEach(async () => {
    await app?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('registers, creates a session, and completes a plain chat response', async () => {
    const auth = await registerAndLogin(app, 'alice_test');
    const session = await createSession(app, auth.cookie, '测试会话');

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        content: '你好，介绍一下你能做什么',
      },
    });

    expect(messageResponse.statusCode).toBe(200);

    const messagesResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/messages?limit=200`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(messagesResponse.statusCode).toBe(200);
    const messages = messagesResponse.json() as Array<{ kind: string; content?: string; role?: string }>;
    expect(messages.some((message) => message.kind === 'message' && message.role === 'assistant')).toBe(true);
  });

  it('restores auth state from the session cookie and clears it on logout', async () => {
    const auth = await registerAndLogin(app, 'session_cookie_user');
    const originalCookie = auth.cookie;

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(sessionResponse.statusCode).toBe(200);
    expect(sessionResponse.json()).toEqual({
      user: expect.objectContaining({
        id: auth.user.id,
        username: auth.user.username,
        role: auth.user.role,
      }),
    });

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(logoutResponse.statusCode).toBe(204);
    expect(String(logoutResponse.headers['set-cookie'] ?? '')).toContain('Max-Age=0');
    const clearedCookie = readSessionCookie(logoutResponse);

    const replayedCookieResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: {
        cookie: originalCookie,
      },
    });

    expect(replayedCookieResponse.statusCode).toBe(401);

    const afterLogoutResponse = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: {
        cookie: clearedCookie,
      },
    });

    expect(afterLogoutResponse.statusCode).toBe(401);
  });

  it('rejects cross-origin mutating requests when using cookie auth', async () => {
    const auth = await registerAndLogin(app, 'origin_guard_user');

    const response = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: {
        cookie: auth.cookie,
        origin: 'https://evil.example',
      },
      payload: {
        title: '恶意跨源请求',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      message: '请求来源不受信任',
    });
  });

  it('creates sessions without enabled skills unless explicitly selected', async () => {
    const auth = await registerAndLogin(app, 'default_skill_user');
    const session = await createSession(app, auth.cookie, '默认技能会话');

    expect(session).toMatchObject({
      activeSkills: [],
    });
  });

  it('returns skill starter prompts for the client empty state', async () => {
    const auth = await registerAndLogin(app, 'skills_user');

    const response = await app.inject({
      method: 'GET',
      url: '/api/skills',
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    const skills = response.json() as Array<{ name: string; starterPrompts?: string[] }>;
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'zhangxuefeng-perspective',
        starterPrompts: expect.arrayContaining([
          '扮演张雪峰',
        ]),
      }),
    ]));
  });

  it('installs a market skill package and reloads the registry for canonical ids', async () => {
    const auth = await registerAndLogin(app, 'market_install_user');
    const packageRoot = path.join(tempDir, 'market-package');
    const packagePath = path.join(tempDir, 'official-pdf.tgz');
    const manifest = {
      id: 'official/pdf',
      name: 'pdf',
      version: '1.0.0',
      kind: 'runtime',
      description: 'Official PDF skill',
      author: {
        name: 'Official',
      },
      starterPrompts: ['Create a PDF'],
    };
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(path.join(packageRoot, 'skill.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await fs.writeFile(path.join(packageRoot, 'SKILL.md'), '# Official PDF\n\nInstalled from market.\n', 'utf8');
    await tar.c({
      cwd: packageRoot,
      file: packagePath,
      gzip: true,
    }, ['skill.json', 'SKILL.md']);
    const packageBytes = await fs.readFile(packagePath);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === 'http://localhost:3100/api/v1/skills/official/pdf/versions/1.0.0/manifest') {
        return Response.json(manifest);
      }
      if (url === 'http://localhost:3100/api/v1/skills/official/pdf/versions/1.0.0/package') {
        return new Response(packageBytes, {
          status: 200,
          headers: {
            'content-type': 'application/gzip',
          },
        });
      }
      if (url === 'http://localhost:3100/api/v1/skills') {
        return Response.json({
          skills: [{
            id: 'official/pdf',
            name: 'pdf',
            latestVersion: '1.0.0',
            kind: 'runtime',
            description: 'Official PDF skill',
            author: { name: 'Official' },
            tags: [],
            categories: [],
            updatedAt: '2026-04-27T00:00:00.000Z',
          }],
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }));

    const marketResponse = await app.inject({
      method: 'GET',
      url: '/api/market/skills',
      headers: {
        cookie: auth.cookie,
      },
    });
    expect(marketResponse.statusCode).toBe(200);
    expect(marketResponse.json()).toMatchObject({
      skills: [expect.objectContaining({ id: 'official/pdf' })],
    });

    const installResponse = await app.inject({
      method: 'POST',
      url: '/api/skills/install',
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        id: 'official/pdf',
        version: '1.0.0',
      },
    });
    expect(installResponse.statusCode).toBe(200);
    expect(installResponse.json()).toMatchObject({
      id: 'official/pdf',
      version: '1.0.0',
      status: 'installed',
    });

    const installedResponse = await app.inject({
      method: 'GET',
      url: '/api/skills/installed',
      headers: {
        cookie: auth.cookie,
      },
    });
    expect(installedResponse.statusCode).toBe(200);
    expect(installedResponse.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'official/pdf', version: '1.0.0' }),
    ]));

    const session = await createSession(app, auth.cookie, 'market skill session', ['official/pdf']);
    expect(session.activeSkills).toEqual(['official/pdf']);

    const other = await registerAndLogin(app, 'market_other_user');
    const otherInstalledResponse = await app.inject({
      method: 'GET',
      url: '/api/skills/installed',
      headers: {
        cookie: other.cookie,
      },
    });
    expect(otherInstalledResponse.statusCode).toBe(200);
    expect(otherInstalledResponse.json()).toEqual([]);

    const otherSessionResponse = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: {
        cookie: other.cookie,
      },
      payload: {
        title: 'other market skill session',
        activeSkills: ['official/pdf'],
      },
    });
    expect(otherSessionResponse.statusCode).toBe(400);

    const uninstallResponse = await app.inject({
      method: 'DELETE',
      url: '/api/me/skills/official/pdf',
      headers: {
        cookie: auth.cookie,
      },
    });
    expect(uninstallResponse.statusCode).toBe(200);
    expect(uninstallResponse.json()).toMatchObject({
      id: 'official/pdf',
      version: '1.0.0',
    });

    const sessionsAfterUninstallResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: {
        cookie: auth.cookie,
      },
    });
    expect(sessionsAfterUninstallResponse.statusCode).toBe(200);
    const sessionsAfterUninstall = sessionsAfterUninstallResponse.json() as Array<{ id: string; activeSkills: string[] }>;
    expect(sessionsAfterUninstall.find((item) => item.id === session.id)?.activeSkills).toEqual([]);
  });

  it('returns market skill detail via GET /api/market/skills/:publisher/:name', async () => {
    const auth = await registerAndLogin(app, 'market_detail_user');
    const manifest = {
      id: 'official/detail-skill',
      name: 'detail-skill',
      version: '2.0.0',
      kind: 'instruction',
      description: 'A detail skill for testing',
      author: { name: 'Official' },
      tags: ['test'],
      categories: ['testing'],
      starterPrompts: ['Start here'],
      permissions: {
        filesystem: [],
        network: false,
        scripts: false,
        secrets: [],
      },
      runtime: { type: 'none', entrypoints: [] },
    };

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

      if (url === 'http://localhost:3100/api/v1/skills/official/detail-skill/versions') {
        return Response.json({
          versions: [{
            id: 'official/detail-skill',
            version: '2.0.0',
            manifest,
            packageUrl: 'http://localhost:3100/api/v1/skills/official/detail-skill/versions/2.0.0/package',
            publishedAt: '2026-04-27T00:00:00.000Z',
          }],
        });
      }
      return originalFetch(input as RequestInfo | URL);
    }));

    const detailResponse = await app.inject({
      method: 'GET',
      url: '/api/market/skills/official/detail-skill',
      headers: { cookie: auth.cookie },
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      id: 'official/detail-skill',
      version: '2.0.0',
      manifest: expect.objectContaining({ description: 'A detail skill for testing' }),
    });
  });

  it('rejects unauthenticated GET /api/market/skills/:publisher/:name with 401', async () => {
    const detailResponse = await app.inject({
      method: 'GET',
      url: '/api/market/skills/official/some-skill',
    });
    expect(detailResponse.statusCode).toBe(401);
  });

  it('exposes idle runtime snapshots and rejects explicit steer or interrupt without an active turn', async () => {
    const auth = await registerAndLogin(app, 'runtime_user');
    const session = await createSession(app, auth.cookie, '运行态测试');

    const runtimeResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/runtime`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toEqual({
      sessionId: session.id,
      activeTurn: null,
      followUpQueue: [],
      recovery: null,
      tokenUsage: null,
    });

    const steerResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/turns/turn_missing/steer`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        content: '补充说明',
      },
    });

    expect(steerResponse.statusCode).toBe(404);
    expect(steerResponse.json()).toEqual({
      message: '当前 turn 不存在',
    });

    const interruptResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/turns/turn_missing/interrupt`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {},
    });

    expect(interruptResponse.statusCode).toBe(404);
    expect(interruptResponse.json()).toEqual({
      message: '当前 turn 不存在',
    });
  });

  it('recovers a persisted runtime snapshot after process restart', async () => {
    const auth = await registerAndLogin(app, 'recovery_user');
    const session = await createSession(app, auth.cookie, '恢复测试');
    const runtimePath = getSessionTurnRuntimePath(app.config, auth.user.id, session.id);

    await fs.writeFile(runtimePath, JSON.stringify({
      sessionId: session.id,
      activeTurn: {
        turnId: 'turn_recover',
        kind: 'regular',
        status: 'running',
        phase: 'streaming_assistant',
        phaseStartedAt: '2026-04-12T00:00:00.000Z',
        canSteer: true,
        startedAt: '2026-04-12T00:00:00.000Z',
        round: 2,
        pendingInputs: [
          {
            inputId: 'input_pending',
            content: '先看失败测试',
            createdAt: '2026-04-12T00:00:01.000Z',
            source: 'steer',
            requestedKind: 'regular',
          },
        ],
      },
      queuedInputs: [
        {
          inputId: 'input_queued',
          content: '下一轮整理文档',
          createdAt: '2026-04-12T00:00:02.000Z',
          source: 'queued',
          requestedKind: 'regular',
        },
      ],
      recovery: null,
    }, null, 2), 'utf8');

    await app.close();
    app = await createApp({
      cwd: tempDir,
      inlineJobs: true,
      configOverrides: {
        NODE_ENV: 'test',
        DATA_ROOT: tempDir,
        SKILLS_ROOT: tempSkillsRoot,
        WEB_ORIGIN: 'http://localhost:5173',
        ENABLE_ASSISTANT_TOOLS: false,
        OPENAI_API_KEY: 'test-token',
      },
    });

    const runtimeResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/runtime`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(runtimeResponse.statusCode).toBe(200);
    expect(runtimeResponse.json()).toMatchObject({
      sessionId: session.id,
      activeTurn: null,
      followUpQueue: [
        {
          inputId: 'input_pending',
          content: '先看失败测试',
          createdAt: '2026-04-12T00:00:01.000Z',
        },
        {
          inputId: 'input_queued',
          content: '下一轮整理文档',
          createdAt: '2026-04-12T00:00:02.000Z',
        },
      ],
      recovery: {
        previousTurnId: 'turn_recover',
        previousTurnKind: 'regular',
        reason: 'process_restarted',
      },
    });
  });

  it('removes a queued follow-up input through the runtime api', async () => {
    const auth = await registerAndLogin(app, 'remove_runtime_user');
    const session = await createSession(app, auth.cookie, '删除待处理输入');
    const runtimePath = getSessionTurnRuntimePath(app.config, auth.user.id, session.id);

    await fs.writeFile(runtimePath, JSON.stringify({
      sessionId: session.id,
      activeTurn: null,
      queuedInputs: [
        {
          inputId: 'input_queued_1',
          content: '可以考公务员',
          createdAt: '2026-04-12T00:00:02.000Z',
          source: 'queued',
          requestedKind: 'regular',
        },
        {
          inputId: 'input_queued_2',
          content: '读文科',
          createdAt: '2026-04-12T00:00:03.000Z',
          source: 'queued',
          requestedKind: 'regular',
        },
      ],
      recovery: null,
    }, null, 2), 'utf8');

    const removeResponse = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${session.id}/runtime/queue/input_queued_1`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(removeResponse.statusCode).toBe(200);
    expect(removeResponse.json()).toEqual({
      accepted: true,
      inputId: 'input_queued_1',
      runtime: {
        sessionId: session.id,
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
    });
  });

  it('updates session active skills through the session api', async () => {
    const auth = await registerAndLogin(app, 'update_skill_user');
    const session = await createSession(app, auth.cookie, '测试会话');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        activeSkills: ['pdf', 'zhangxuefeng-perspective'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: session.id,
      activeSkills: ['pdf', 'zhangxuefeng-perspective'],
    });
  });

  it('deletes a session through the session api', async () => {
    const auth = await registerAndLogin(app, 'delete_session_user');
    const session = await createSession(app, auth.cookie, '待删除会话');
    const sessionRoot = getSessionRoot(app.config, auth.user.id, session.id);
    await expect(fs.stat(sessionRoot)).resolves.toBeTruthy();

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${session.id}`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(response.statusCode).toBe(204);

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(sessionsResponse.statusCode).toBe(200);
    expect((sessionsResponse.json() as Array<{ id: string }>).map((item) => item.id)).not.toContain(session.id);
    await expect(fs.stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a user-friendly validation message for invalid registration input', async () => {
    const inviteCode = 'INV-TEST01';
    seedInviteCode(app.config.DB_PATH, inviteCode);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'bob_test',
        password: '1234567',
        inviteCode,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      message: '密码至少需要 8 个字符',
    });
  });

  it('bootstraps the first admin and then closes bootstrap mode', async () => {
    const statusBefore = await app.inject({
      method: 'GET',
      url: '/api/system/status',
    });

    expect(statusBefore.statusCode).toBe(200);
    expect(statusBefore.json()).toMatchObject({
      initialized: false,
      hasAdmin: false,
      registrationRequiresInviteCode: true,
    });

    const admin = await bootstrapAdmin(app, 'root_admin');
    expect(admin.user.role).toBe('admin');

    const statusAfter = await app.inject({
      method: 'GET',
      url: '/api/system/status',
    });

    expect(statusAfter.json()).toMatchObject({
      initialized: true,
      hasAdmin: true,
    });

    const secondBootstrap = await app.inject({
      method: 'POST',
      url: '/api/system/bootstrap-admin',
      payload: {
        username: 'another_admin',
        password: 'secret123',
      },
    });

    expect(secondBootstrap.statusCode).toBe(409);
    expect(secondBootstrap.json()).toEqual({
      message: '系统已存在管理员，不能重复初始化',
    });
  });

  it('allows registration without invite after admin disables invite requirement', async () => {
    const admin = await bootstrapAdmin(app, 'settings_admin');

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/admin/system-settings',
      headers: {
        cookie: admin.cookie,
      },
      payload: {
        registrationRequiresInviteCode: false,
        modelConfig: {
          openaiModel: 'gpt-4o-mini',
          llmMaxOutputTokens: 2048,
        },
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    expect(app.config.OPENAI_MODEL).toBe('gpt-4o-mini');
    expect(app.config.LLM_MAX_OUTPUT_TOKENS).toBe(2048);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'invite_free_user',
        password: 'secret123',
      },
    });

    expect(registerResponse.statusCode).toBe(200);
    expect(registerResponse.json()).toMatchObject({
      user: {
        username: 'invite_free_user',
        role: 'member',
      },
    });
  });

  it('supports admin user management, invite management, and user preference settings', async () => {
    const admin = await bootstrapAdmin(app, 'ops_admin');

    const createInvites = await app.inject({
      method: 'POST',
      url: '/api/admin/invite-codes',
      headers: {
        cookie: admin.cookie,
      },
      payload: {
        count: 2,
      },
    });

    expect(createInvites.statusCode).toBe(200);
    const createdInvites = createInvites.json() as { codes: string[] };
    expect(createdInvites.codes).toHaveLength(2);

    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'managed_user',
        password: 'secret123',
        inviteCode: createdInvites.codes[0],
      },
    });
    expect(registerResponse.statusCode).toBe(200);
    const managedMember = registerResponse.json() as { user: { username: string } };

    const usersResponse = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        cookie: admin.cookie,
      },
    });

    expect(usersResponse.statusCode).toBe(200);
    const users = usersResponse.json() as Array<{ id: string; username: string; role: string; status: string }>;
    const managedUser = users.find((user) => user.username === 'managed_user');
    expect(managedUser).toBeTruthy();

    const disableResponse = await app.inject({
      method: 'PATCH',
      url: `/api/admin/users/${managedUser!.id}`,
      headers: {
        cookie: admin.cookie,
      },
      payload: {
        status: 'disabled',
      },
    });

    expect(disableResponse.statusCode).toBe(200);
    expect(disableResponse.json()).toMatchObject({
      id: managedUser!.id,
      status: 'disabled',
    });

    const disabledLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        username: 'managed_user',
        password: 'secret123',
      },
    });

    expect(disabledLogin.statusCode).toBe(400);
    expect(disabledLogin.json()).toEqual({
      message: '用户已被禁用',
    });

    const meSettingsPatch = await app.inject({
      method: 'PATCH',
      url: '/api/me/settings',
      headers: {
        cookie: admin.cookie,
      },
      payload: {
        themeMode: 'light',
      },
    });

    expect(meSettingsPatch.statusCode).toBe(200);
    expect(meSettingsPatch.json()).toEqual({
      themeMode: 'light',
    });

    const meSettingsGet = await app.inject({
      method: 'GET',
      url: '/api/me/settings',
      headers: {
        cookie: admin.cookie,
      },
    });

    expect(meSettingsGet.statusCode).toBe(200);
    expect(meSettingsGet.json()).toEqual({
      themeMode: 'light',
    });

    const inviteList = await app.inject({
      method: 'GET',
      url: '/api/admin/invite-codes',
      headers: {
        cookie: admin.cookie,
      },
    });

    expect(inviteList.statusCode).toBe(200);
    const invites = inviteList.json() as Array<{ code: string; usedBy: string | null }>;
    expect(invites.some((invite) => invite.code === createdInvites.codes[0] && invite.usedBy === managedMember.user.username)).toBe(true);

    const deleteUsedInvite = await app.inject({
      method: 'DELETE',
      url: `/api/admin/invite-codes/${createdInvites.codes[0]}`,
      headers: {
        cookie: admin.cookie,
      },
    });
    expect(deleteUsedInvite.statusCode).toBe(400);

    const deleteUnusedInvite = await app.inject({
      method: 'DELETE',
      url: `/api/admin/invite-codes/${createdInvites.codes[1]}`,
      headers: {
        cookie: admin.cookie,
      },
    });
    expect(deleteUnusedInvite.statusCode).toBe(204);
  });

  it('rejects admin endpoints for non-admin users', async () => {
    const admin = await bootstrapAdmin(app, 'policy_admin');
    const settingsResponse = await app.inject({
      method: 'PATCH',
      url: '/api/admin/system-settings',
      headers: {
        cookie: admin.cookie,
      },
      payload: {
        registrationRequiresInviteCode: false,
      },
    });
    expect(settingsResponse.statusCode).toBe(200);

    const memberRegister = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        username: 'plain_member',
        password: 'secret123',
      },
    });
    expect(memberRegister.statusCode).toBe(200);
    const member = {
      cookie: readSessionCookie(memberRegister),
      user: (memberRegister.json() as { user: { id: string; username: string; role: string } }).user,
    } satisfies TestAuthSession;

    const memberAdminAccess = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: {
        cookie: member.cookie,
      },
    });

    expect(memberAdminAccess.statusCode).toBe(403);
    expect(memberAdminAccess.json()).toEqual({
      message: '仅管理员可访问',
    });
  });

  it('sanitizes tool details for non-admin users when reading session messages', async () => {
    const member = await registerAndLogin(app, 'tooltrace_member');
    const session = await createSession(app, member.cookie, '工具权限测试');
    const messagesPath = getSessionMessagesPath(app.config, member.user.id, session.id);

    await fs.appendFile(messagesPath, `${JSON.stringify({
      id: 'tool-call',
      sessionId: session.id,
      kind: 'tool_call',
      callId: 'call_1',
      skill: 'web_search',
      arguments: { query: '金融专业就业' },
      meta: { provider: 'openai' },
      createdAt: '2026-04-12T00:00:00.000Z',
    })}\n`, 'utf8');
    await fs.appendFile(messagesPath, `${JSON.stringify({
      id: 'tool-result',
      sessionId: session.id,
      kind: 'tool_result',
      callId: 'call_1',
      skill: 'web_search',
      message: '检索到 3 条网页结果',
      content: '1. Example News',
      meta: { raw: 'secret payload' },
      createdAt: '2026-04-12T00:00:01.000Z',
    })}\n`, 'utf8');

    const response = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/messages?limit=200`,
      headers: {
        cookie: member.cookie,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject([
      {
        id: 'tool-call',
        kind: 'tool_call',
        arguments: {},
      },
      {
        id: 'tool-result',
        kind: 'tool_result',
        message: '检索到 3 条网页结果',
      },
    ]);
    const [toolCall, toolResult] = response.json() as Array<Record<string, unknown>>;
    expect(toolCall.meta).toBeUndefined();
    expect(toolResult.content).toBeUndefined();
    expect(toolResult.meta).toBeUndefined();
  });

  it('serves image thumbnails separately from original downloads', async () => {
    const auth = await registerAndLogin(app, 'thumb_user');
    const session = await createSession(app, auth.cookie, '缩略图测试');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const image = await sharp({
      create: {
        width: 120,
        height: 80,
        channels: 3,
        background: '#4f8cff',
      },
    }).png().toBuffer();
    const imageBody = image.buffer.slice(
      image.byteOffset,
      image.byteOffset + image.byteLength,
    ) as ArrayBuffer;
    const form = new FormData();
    form.append('file', new Blob([imageBody], { type: 'image/png' }), 'large-preview.png');

    const uploadResponse = await fetch(`${address}/api/files/${session.id}/upload`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
      },
      body: form,
    });

    expect(uploadResponse.status).toBe(200);
    const file = await uploadResponse.json() as { id: string; thumbnailUrl?: string; downloadUrl?: string };
    expect(file.thumbnailUrl).toBe(`/api/files/${file.id}/thumbnail`);
    expect(file.downloadUrl).toBe(`/api/files/${file.id}/download`);

    const thumbnailResponse = await fetch(`${address}/api/files/${file.id}/thumbnail`, {
      headers: {
        Cookie: auth.cookie,
      },
    });

    expect(thumbnailResponse.status).toBe(200);
    expect(thumbnailResponse.headers.get('content-type')).toContain('image/webp');
    expect(thumbnailResponse.headers.get('content-disposition')).toBe('inline');
    expect((await thumbnailResponse.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const downloadResponse = await fetch(`${address}/api/files/${file.id}/download`, {
      headers: {
        Cookie: auth.cookie,
      },
    });

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get('content-type')).toContain('image/png');
    expect(downloadResponse.headers.get('content-disposition')).toContain('attachment');
    await downloadResponse.arrayBuffer();
  });

  it('generates a PDF file and supports sharing and downloading it', async () => {
    const auth = await registerAndLogin(app, 'pdf_user');
    const session = await createSession(app, auth.cookie, '测试会话', ['artifact-smoke']);

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        content: '帮我生成一份本周销售报告 PDF',
      },
    });

    expect(messageResponse.statusCode).toBe(200);

    const filesResponse = await app.inject({
      method: 'GET',
      url: `/api/files?sessionId=${session.id}`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(filesResponse.statusCode).toBe(200);
    const files = filesResponse.json() as Array<{ id: string; displayName: string; bucket: string }>;
    const pdfFile = files.find((file) => file.displayName.endsWith('.pdf'));
    expect(pdfFile).toBeTruthy();

    const shareResponse = await app.inject({
      method: 'POST',
      url: `/api/files/${pdfFile!.id}/share`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(shareResponse.statusCode).toBe(200);
    const sharedFile = shareResponse.json() as { id: string; displayName: string; bucket: string };
    expect(sharedFile.bucket).toBe('shared');

    const sharedVisibleInSessionResponse = await app.inject({
      method: 'GET',
      url: `/api/files?sessionId=${session.id}`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(sharedVisibleInSessionResponse.statusCode).toBe(200);
    expect(
      (sharedVisibleInSessionResponse.json() as Array<{ id: string; bucket: string }>).some(
        (file) => file.id === sharedFile.id && file.bucket === 'shared',
      ),
    ).toBe(true);

    const downloadResponse = await app.inject({
      method: 'GET',
      url: `/api/files/${sharedFile.id}/download`,
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers['content-type']).toContain('application/pdf');
  });

  it('uploads CSV and generates an XLSX artifact through the skill pipeline', async () => {
    const auth = await registerAndLogin(app, 'xlsx_user');
    const session = await createSession(app, auth.cookie, '测试会话', ['artifact-smoke']);

    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const form = new FormData();
    form.append(
      'file',
      new Blob(['name,amount\nA,12\nB,18'], { type: 'text/csv' }),
      'sales.csv',
    );

    const uploadResponse = await fetch(`${address}/api/files/${session.id}/upload`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
      },
      body: form,
    });

    expect(uploadResponse.status).toBe(200);

    const messageResponse = await fetch(`${address}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: '把刚上传的 CSV 转成 Excel 并加上图表',
      }),
    });

    expect(messageResponse.status).toBe(200);

    const filesResponse = await fetch(`${address}/api/files?sessionId=${session.id}`, {
      headers: {
        Cookie: auth.cookie,
      },
    });

    expect(filesResponse.status).toBe(200);
    const files = await filesResponse.json() as Array<{ displayName: string }>;
    expect(files.some((file) => file.displayName.endsWith('.xlsx'))).toBe(true);
  });

  it('activates the zhangxuefeng chat skill for perspective requests', async () => {
    const auth = await registerAndLogin(app, 'zhang_user');
    const session = await createSession(app, auth.cookie, '测试会话');

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        content: '用张雪峰的视角帮我分析金融专业',
      },
    });

    expect(response.statusCode).toBe(200);

    const messagesResponse = await app.inject({
      method: 'GET',
      url: `/api/sessions/${session.id}/messages?limit=200`,
      headers: {
        cookie: auth.cookie,
      },
    });

    const messages = messagesResponse.json() as Array<{ kind: string; role?: string; content?: string }>;
    expect(
      messages.some((message) => message.kind === 'message' && message.role === 'assistant' && message.content?.includes('我跟你说')),
    ).toBe(true);
  });

  it('derives the session title from the first user question', async () => {
    const auth = await registerAndLogin(app, 'title_user');
    const session = await createSession(app, auth.cookie);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        cookie: auth.cookie,
      },
      payload: {
        content: '帮我选一个好一点的专业吧',
      },
    });

    expect(response.statusCode).toBe(200);

    const sessionsResponse = await app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: {
        cookie: auth.cookie,
      },
    });

    expect(sessionsResponse.statusCode).toBe(200);
    const sessions = sessionsResponse.json() as Array<{ id: string; title: string }>;
    const updated = sessions.find((item) => item.id === session.id);
    expect(updated?.title).toBe('选一个好一点的专业');
  });
});

