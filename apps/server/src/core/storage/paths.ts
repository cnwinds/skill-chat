import path from 'node:path';
import type { AppConfig } from '../../config/env.js';

export const getUsersRoot = (config: AppConfig) => path.join(config.DATA_ROOT, 'users');

export const getUserRoot = (config: AppConfig, userId: string) =>
  path.join(getUsersRoot(config), userId);

export const getSharedRoot = (config: AppConfig, userId: string) =>
  path.join(getUserRoot(config, userId), 'shared');

export const getTrashRoot = (config: AppConfig, userId: string) =>
  path.join(getUserRoot(config, userId), 'trash');

export const getSessionsRoot = (config: AppConfig, userId: string) =>
  path.join(getUserRoot(config, userId), 'sessions');

export const getSessionRoot = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionsRoot(config, userId), sessionId);

export const getSessionMetaPath = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'meta.json');

export const getSessionMessagesPath = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'messages.jsonl');

export const getSessionTurnRuntimePath = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'turn-runtime.json');

export const getSessionContextStatePath = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'session-context.json');

export const getSessionUploadsRoot = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'uploads');

export const getSessionOutputsRoot = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'outputs');

export const getSessionTmpRoot = (config: AppConfig, userId: string, sessionId: string) =>
  path.join(getSessionRoot(config, userId, sessionId), 'tmp');

export const resolveUserPath = (config: AppConfig, userId: string, relativePath: string) =>
  path.join(getUserRoot(config, userId), relativePath);
