import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from './app.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skillsRoot = path.join(repoRoot, 'skills');

const seedInviteCode = (dbPath: string, code: string) => {
  const db = new Database(dbPath);
  db.prepare('INSERT INTO invite_codes (code) VALUES (?)').run(code);
  db.close();
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
  return registerResponse.json() as { token: string; user: { id: string; username: string } };
};

const createSession = async (app: FastifyInstance, token: string, title?: string) => {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: {
      authorization: `Bearer ${token}`,
    },
    payload: title ? { title } : {},
  });

  expect(response.statusCode).toBe(200);
  return response.json() as { id: string; title: string };
};

describe('SkillChat server', () => {
  let app: FastifyInstance;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-test-'));
    app = await createApp({
      cwd: repoRoot,
      inlineJobs: true,
      configOverrides: {
        NODE_ENV: 'test',
        DATA_ROOT: tempDir,
        SKILLS_ROOT: skillsRoot,
        WEB_ORIGIN: 'http://localhost:5173',
        JWT_SECRET: 'test-secret-123',
        DEFAULT_SESSION_ACTIVE_SKILLS: ['zhangxuefeng-perspective'],
        ENABLE_ASSISTANT_TOOLS: false,
        OPENAI_API_KEY: '',
        ANTHROPIC_API_KEY: '',
        ANTHROPIC_AUTH_TOKEN: '',
      },
    });
  });

  afterEach(async () => {
    await app?.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('registers, creates a session, and completes a plain chat response', async () => {
    const auth = await registerAndLogin(app, 'alice_test');
    const session = await createSession(app, auth.token, '测试会话');

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        authorization: `Bearer ${auth.token}`,
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
        authorization: `Bearer ${auth.token}`,
      },
    });

    expect(messagesResponse.statusCode).toBe(200);
    const messages = messagesResponse.json() as Array<{ kind: string; content?: string; role?: string }>;
    expect(messages.some((message) => message.kind === 'message' && message.role === 'assistant')).toBe(true);
  });

  it('creates sessions with configured default active skills', async () => {
    const auth = await registerAndLogin(app, 'default_skill_user');
    const session = await createSession(app, auth.token, '默认技能会话');

    expect(session).toMatchObject({
      activeSkills: ['zhangxuefeng-perspective'],
    });
  });

  it('updates session active skills through the session api', async () => {
    const auth = await registerAndLogin(app, 'update_skill_user');
    const session = await createSession(app, auth.token, '测试会话');

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${session.id}`,
      headers: {
        authorization: `Bearer ${auth.token}`,
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

  it('generates a PDF file and supports sharing and downloading it', async () => {
    const auth = await registerAndLogin(app, 'pdf_user');
    const session = await createSession(app, auth.token, '测试会话');

    const messageResponse = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        authorization: `Bearer ${auth.token}`,
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
        authorization: `Bearer ${auth.token}`,
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
        authorization: `Bearer ${auth.token}`,
      },
    });

    expect(shareResponse.statusCode).toBe(200);
    const sharedFile = shareResponse.json() as { id: string; displayName: string; bucket: string };
    expect(sharedFile.bucket).toBe('shared');

    const downloadResponse = await app.inject({
      method: 'GET',
      url: `/api/files/${sharedFile.id}/download`,
      headers: {
        authorization: `Bearer ${auth.token}`,
      },
    });

    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.headers['content-type']).toContain('application/pdf');
  });

  it('uploads CSV and generates an XLSX artifact through the skill pipeline', async () => {
    const auth = await registerAndLogin(app, 'xlsx_user');
    const session = await createSession(app, auth.token, '测试会话');

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
        Authorization: `Bearer ${auth.token}`,
      },
      body: form,
    });

    expect(uploadResponse.status).toBe(200);

    const messageResponse = await fetch(`${address}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: '把刚上传的 CSV 转成 Excel 并加上图表',
      }),
    });

    expect(messageResponse.status).toBe(200);

    const filesResponse = await fetch(`${address}/api/files?sessionId=${session.id}`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    expect(filesResponse.status).toBe(200);
    const files = await filesResponse.json() as Array<{ displayName: string }>;
    expect(files.some((file) => file.displayName.endsWith('.xlsx'))).toBe(true);
  });

  it('activates the zhangxuefeng chat skill for perspective requests', async () => {
    const auth = await registerAndLogin(app, 'zhang_user');
    const session = await createSession(app, auth.token, '测试会话');

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        authorization: `Bearer ${auth.token}`,
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
        authorization: `Bearer ${auth.token}`,
      },
    });

    const messages = messagesResponse.json() as Array<{ kind: string; role?: string; content?: string }>;
    expect(
      messages.some((message) => message.kind === 'message' && message.role === 'assistant' && message.content?.includes('我跟你说')),
    ).toBe(true);
  });

  it('derives the session title from the first user question', async () => {
    const auth = await registerAndLogin(app, 'title_user');
    const session = await createSession(app, auth.token);

    const response = await app.inject({
      method: 'POST',
      url: `/api/sessions/${session.id}/messages`,
      headers: {
        authorization: `Bearer ${auth.token}`,
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
        authorization: `Bearer ${auth.token}`,
      },
    });

    expect(sessionsResponse.statusCode).toBe(200);
    const sessions = sessionsResponse.json() as Array<{ id: string; title: string }>;
    const updated = sessions.find((item) => item.id === session.id);
    expect(updated?.title).toBe('选一个好一点的专业');
  });
});
