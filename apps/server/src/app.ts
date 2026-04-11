import fs from 'node:fs';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { z } from 'zod';
import {
  createMessageSchema,
  createSessionSchema,
  fileBucketSchema,
  loginSchema,
  registerSchema,
  updateSessionSchema,
  type AuthResponse,
} from '@skillchat/shared';
import { getProjectRoot, loadConfig, type ConfigOverrides } from './config/env.js';
import { createDatabase, migrateDatabase } from './db/database.js';
import { ensureBaseDirectories } from './core/storage/fs-utils.js';
import { MessageStore } from './core/storage/message-store.js';
import { StreamHub } from './core/stream/stream-hub.js';
import { SkillRegistry } from './modules/skills/skill-registry.js';
import { createModelClient } from './core/llm/create-model-client.js';
import { AuthService } from './modules/auth/auth-service.js';
import { SessionService } from './modules/sessions/session-service.js';
import { FileService } from './modules/files/file-service.js';
import { RunnerManager } from './core/runner/runner-manager.js';
import { ChatService } from './modules/chat/chat-service.js';
import { AssistantToolService } from './modules/tools/assistant-tool-service.js';
import { OpenAIHarness } from './modules/chat/openai-harness.js';

export interface CreateAppOptions {
  cwd?: string;
  configOverrides?: ConfigOverrides;
  inlineJobs?: boolean;
}

const errorStatus = (error: unknown) => {
  if (error instanceof z.ZodError) {
    return 400;
  }
  const message = error instanceof Error ? error.message : '请求失败';
  if (/不存在/.test(message)) {
    return 404;
  }
  return 400;
};

const errorMessage = (error: unknown, fallback: string) => {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => issue.message).join('；') || fallback;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const formatSse = (event: { id: string; event: string; data: unknown }) =>
  `id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

const normalizeActiveSkills = (input: string[] | undefined, knownSkills: Set<string>) => {
  const seen = new Set<string>();
  const normalized = (input ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      if (seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });

  const invalid = normalized.filter((item) => !knownSkills.has(item));
  if (invalid.length > 0) {
    throw new Error(`未知 Skill：${invalid.join('，')}`);
  }

  return normalized;
};

export const createApp = async (options: CreateAppOptions = {}) => {
  const cwd = options.cwd ?? getProjectRoot();
  const config = loadConfig(cwd, {
    ...options.configOverrides,
    INLINE_JOBS: options.inlineJobs ?? options.configOverrides?.INLINE_JOBS ?? false,
  });

  await ensureBaseDirectories(config);

  const db = createDatabase(config);
  migrateDatabase(db);

  const skillRegistry = new SkillRegistry(config);
  await skillRegistry.load();
  const knownSkillNames = new Set(skillRegistry.list().map((skill) => skill.name));
  const defaultSessionActiveSkills = normalizeActiveSkills(config.DEFAULT_SESSION_ACTIVE_SKILLS, knownSkillNames);

  const messageStore = new MessageStore(config);
  const streamHub = new StreamHub();
  const authService = new AuthService(db, config);
  const sessionService = new SessionService(db, config);
  const fileService = new FileService(db, config);
  const runnerManager = new RunnerManager(config, fileService);
  const assistantToolService = new AssistantToolService(config, fileService, skillRegistry);
  const modelClient = createModelClient(config);
  const openAIHarness = config.OPENAI_API_KEY
    ? new OpenAIHarness(config, assistantToolService, runnerManager, skillRegistry)
    : undefined;
  const chatService = new ChatService(
    messageStore,
    streamHub,
    modelClient,
    skillRegistry,
    fileService,
    runnerManager,
    sessionService,
    assistantToolService,
    config.ENABLE_ASSISTANT_TOOLS,
    openAIHarness,
  );

  const app = Fastify({
    logger: {
      transport: config.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  });

  app.decorate('config', config);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
  });
  await app.register(multipart, {
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
    },
  });
  await app.register(jwt, {
    secret: config.JWT_SECRET,
  });

  app.decorate('authenticate', async (request) => {
    await request.jwtVerify();
  });

  app.addHook('onClose', async () => {
    db.close();
  });

  app.get('/health', async () => ({
    ok: true,
    timestamp: new Date().toISOString(),
  }));

  app.post('/api/auth/register', async (request, reply) => {
    try {
      const input = registerSchema.parse(request.body);
      const user = await authService.register(input);
      const token = await reply.jwtSign(
        { sub: user.id, username: user.username, role: user.role },
        { expiresIn: config.JWT_EXPIRES_IN },
      );
      const payload: AuthResponse = { user, token };
      return payload;
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '注册失败') });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const input = loginSchema.parse(request.body);
      const user = await authService.login(input);
      const token = await reply.jwtSign(
        { sub: user.id, username: user.username, role: user.role },
        { expiresIn: config.JWT_EXPIRES_IN },
      );
      const payload: AuthResponse = { user, token };
      return payload;
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '登录失败') });
    }
  });

  app.get('/api/sessions', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      return await sessionService.list(request.user.sub);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '获取会话失败') });
    }
  });

  app.post('/api/sessions', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const input = createSessionSchema.parse(request.body ?? {});
      const activeSkills = normalizeActiveSkills(input.activeSkills ?? defaultSessionActiveSkills, knownSkillNames);
      return await sessionService.create(request.user.sub, input.title, activeSkills);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '创建会话失败') });
    }
  });

  app.patch('/api/sessions/:id', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const input = updateSessionSchema.parse(request.body ?? {});
      sessionService.requireOwned(request.user.sub, params.id);
      return await sessionService.update(request.user.sub, params.id, {
        title: input.title,
        activeSkills: typeof input.activeSkills === 'undefined'
          ? undefined
          : normalizeActiveSkills(input.activeSkills, knownSkillNames),
      });
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '更新会话失败') });
    }
  });

  app.get('/api/sessions/:id/messages', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const query = z.object({
        after: z.string().optional(),
        before: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional(),
      }).parse(request.query ?? {});
      sessionService.requireOwned(request.user.sub, params.id);
      return await messageStore.readEvents(request.user.sub, params.id, query);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '获取消息失败') });
    }
  });

  app.post('/api/sessions/:id/messages', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ id: z.string().min(1) }).parse(request.params);
      const input = createMessageSchema.parse(request.body);
      sessionService.requireOwned(request.user.sub, params.id);

      const runId = `run_${Date.now()}`;
      const task = chatService.processMessage(
        {
          id: request.user.sub,
          username: request.user.username,
          role: request.user.role,
        },
        params.id,
        input.content,
      ).catch((error) => chatService.handleFailure(request.user.sub, params.id, error));

      if (config.INLINE_JOBS) {
        await task;
      }

      return {
        accepted: true,
        messageId: `msg_${Date.now()}`,
        runId,
      };
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '发送消息失败') });
    }
  });

  app.get('/api/sessions/:id/stream', { preHandler: app.authenticate }, async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).parse(request.params);
    sessionService.requireOwned(request.user.sub, params.id);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');

    const unsubscribe = streamHub.subscribe(params.id, (event) => {
      reply.raw.write(formatSse(event));
    });

    const heartbeat = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 15_000);

    request.raw.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });

    return reply;
  });

  app.get('/api/files', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const query = z.object({
        sessionId: z.string().optional(),
        bucket: fileBucketSchema.optional(),
        type: z.string().optional(),
      }).parse(request.query ?? {});
      return fileService.list(request.user.sub, query);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '获取文件失败') });
    }
  });

  app.post('/api/files/:sessionId/upload', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ sessionId: z.string().min(1) }).parse(request.params);
      sessionService.requireOwned(request.user.sub, params.sessionId);
      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ message: '缺少上传文件' });
      }
      return await fileService.saveUpload(request.user.sub, params.sessionId, file);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '上传失败') });
    }
  });

  app.get('/api/files/:fileId/download', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
      const { file, absolutePath } = await fileService.resolveDownloadPath(request.user.sub, params.fileId);
      reply.header('Content-Type', file.mimeType ?? 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.displayName)}`);
      return reply.send(fs.createReadStream(absolutePath));
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '下载失败') });
    }
  });

  app.post('/api/files/:fileId/share', { preHandler: app.authenticate }, async (request, reply) => {
    try {
      const params = z.object({ fileId: z.string().min(1) }).parse(request.params);
      return await fileService.shareFile(request.user.sub, params.fileId);
    } catch (error) {
      return reply.code(errorStatus(error)).send({ message: errorMessage(error, '共享文件失败') });
    }
  });

  app.get('/api/skills', { preHandler: app.authenticate }, async () => skillRegistry.list());

  return app;
};
