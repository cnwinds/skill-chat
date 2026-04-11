import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../../config/env.js';
import {
  getSessionMessagesPath,
  getSessionMetaPath,
  getSessionOutputsRoot,
  getSessionRoot,
  getSessionTmpRoot,
  getSessionUploadsRoot,
  getSessionsRoot,
  getSharedRoot,
  getTrashRoot,
  getUserRoot,
  getUsersRoot,
} from './paths.js';

export const ensureBaseDirectories = async (config: AppConfig) => {
  await fs.mkdir(config.DATA_ROOT, { recursive: true });
  await fs.mkdir(getUsersRoot(config), { recursive: true });
};

export const ensureUserDirectories = async (config: AppConfig, userId: string) => {
  await fs.mkdir(getUserRoot(config, userId), { recursive: true });
  await fs.mkdir(getSessionsRoot(config, userId), { recursive: true });
  await fs.mkdir(getSharedRoot(config, userId), { recursive: true });
  await fs.mkdir(getTrashRoot(config, userId), { recursive: true });
};

export const ensureSessionDirectories = async (
  config: AppConfig,
  userId: string,
  sessionId: string,
  meta: { sessionId: string; userId: string; title: string; createdAt: string; updatedAt: string; activeSkills?: string[] },
) => {
  const sessionRoot = getSessionRoot(config, userId, sessionId);
  await fs.mkdir(sessionRoot, { recursive: true });
  await fs.mkdir(getSessionUploadsRoot(config, userId, sessionId), { recursive: true });
  await fs.mkdir(getSessionOutputsRoot(config, userId, sessionId), { recursive: true });
  await fs.mkdir(getSessionTmpRoot(config, userId, sessionId), { recursive: true });

  await fs.writeFile(getSessionMetaPath(config, userId, sessionId), JSON.stringify(meta, null, 2), 'utf8');
  await fs.writeFile(getSessionMessagesPath(config, userId, sessionId), '', { flag: 'a' });
};

export const sanitizeFilename = (name: string) =>
  name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || 'file';

export const uniqueFileName = (originalName: string) => {
  const safeName = sanitizeFilename(originalName);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}-${safeName}`;
};

export const assertPathInside = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Resolved path is outside of the allowed root');
  }
};

export const listFilesRecursively = async (rootPath: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(fullPath);
      }
      return [fullPath];
    }));
    return nested.flat();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
};
