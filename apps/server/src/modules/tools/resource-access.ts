import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../../config/env.js';
import { assertPathInside } from '../../core/storage/fs-utils.js';
import { getSessionOutputsRoot, getSessionRoot, getUserRoot } from '../../core/storage/paths.js';

export type WorkspaceRootName = 'session' | 'workspace';

export type WorkspaceRootDescriptor = {
  root: WorkspaceRootName;
  absoluteRoot: string;
  label: string;
};

export type ListedWorkspaceEntry = {
  relativePath: string;
  kind: 'file' | 'directory';
  depth: number;
};

type ResolveWorkspaceRootArgs = {
  config: AppConfig;
  userId: string;
  sessionId: string;
  root: WorkspaceRootName;
};

const DEFAULT_IGNORED_NAMES = new Set([
  '.git',
  '.DS_Store',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.venv',
  '.pytest_cache',
  '__pycache__',
]);

const textFilePattern = /\.(txt|md|markdown|json|jsonl|csv|ts|tsx|js|jsx|mjs|cjs|py|java|go|rs|rb|php|html|htm|xml|css|scss|less|yaml|yml|toml|ini|conf|env|sql|log|sh|bash|zsh)$/i;

export const resolveWorkspaceRoot = ({
  config,
  userId,
  sessionId,
  root,
}: ResolveWorkspaceRootArgs): WorkspaceRootDescriptor => {
  if (root === 'session') {
    return {
      root,
      absoluteRoot: getSessionRoot(config, userId, sessionId),
      label: '当前会话目录',
    };
  }

  return {
    root,
    absoluteRoot: config.CWD,
    label: '当前工作区',
  };
};

export const resolveWorkspacePath = (
  descriptor: WorkspaceRootDescriptor,
  requestedPath = '',
) => {
  const normalized = requestedPath.trim();
  if (normalized) {
    const segments = normalized.split(/[\\/]+/).filter(Boolean);
    if (segments.some((segment) => segment.startsWith('.'))) {
      throw new Error('不允许访问隐藏路径或点文件');
    }
  }
  const targetPath = normalized
    ? path.resolve(descriptor.absoluteRoot, normalized)
    : descriptor.absoluteRoot;

  assertPathInside(descriptor.absoluteRoot, targetPath);
  return targetPath;
};

export const ensureArtifactPath = async (
  config: AppConfig,
  userId: string,
  sessionId: string,
  fileName: string,
  subdir?: string,
) => {
  const outputsRoot = getSessionOutputsRoot(config, userId, sessionId);
  const targetDir = subdir
    ? path.resolve(outputsRoot, subdir)
    : outputsRoot;

  assertPathInside(outputsRoot, targetDir);
  await fs.mkdir(targetDir, { recursive: true });

  const absolutePath = path.join(targetDir, fileName);
  assertPathInside(outputsRoot, absolutePath);
  return absolutePath;
};

export const listWorkspaceEntries = async (args: {
  descriptor: WorkspaceRootDescriptor;
  requestedPath?: string;
  depth: number;
  offset: number;
  limit: number;
}) => {
  const basePath = resolveWorkspacePath(args.descriptor, args.requestedPath);
  const items: ListedWorkspaceEntry[] = [];

  const walk = async (currentPath: string, currentDepth: number) => {
    let entries: Array<{ name: string; isDirectory: () => boolean }> = [];

    try {
      const dirents = await fs.readdir(currentPath, { withFileTypes: true });
      entries = dirents
        .filter((entry) => !entry.name.startsWith('.') && !DEFAULT_IGNORED_NAMES.has(entry.name))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => ({
          name: entry.name,
          isDirectory: () => entry.isDirectory(),
        }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = path.relative(basePath, fullPath) || entry.name;
      items.push({
        relativePath: relativePath.replace(/\\/g, '/'),
        kind: entry.isDirectory() ? 'directory' : 'file',
        depth: currentDepth,
      });

      if (entry.isDirectory() && currentDepth < args.depth) {
        await walk(fullPath, currentDepth + 1);
      }
    }
  };

  const stat = await fs.stat(basePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      throw new Error(`路径不存在：${args.requestedPath || '.'}`);
    }
    throw error;
  });

  if (stat.isDirectory()) {
    await walk(basePath, 0);
  } else {
    items.push({
      relativePath: path.basename(basePath),
      kind: 'file',
      depth: 0,
    });
  }

  return {
    absolutePath: basePath,
    entries: items.slice(args.offset, args.offset + args.limit),
    total: items.length,
    hasMore: args.offset + args.limit < items.length,
  };
};

export const isTextLikePath = (targetPath: string, mimeType?: string | null) =>
  (mimeType?.startsWith('text/') ?? false) || textFilePattern.test(targetPath);

export const readTextSlice = async (args: {
  filePath: string;
  maxChars: number;
  startLine?: number;
  endLine?: number;
}) => {
  const raw = await fs.readFile(args.filePath, 'utf8');
  if (typeof args.startLine === 'number' || typeof args.endLine === 'number') {
    const lines = raw.split(/\r?\n/);
    const start = Math.max(1, args.startLine ?? 1);
    const end = Math.max(start, args.endLine ?? start + 79);
    const excerpt = lines.slice(start - 1, end).join('\n');
    const truncated = excerpt.length > args.maxChars;
    return {
      excerpt: truncated ? `${excerpt.slice(0, args.maxChars)}...` : excerpt,
      range: {
        startLine: start,
        endLine: Math.min(end, lines.length),
      },
      truncated,
    };
  }

  const excerpt = raw.slice(0, args.maxChars);
  return {
    excerpt: excerpt.length < raw.length ? `${excerpt}...` : excerpt,
    range: undefined,
    truncated: excerpt.length < raw.length,
  };
};

export const formatListedWorkspaceEntries = (entries: ListedWorkspaceEntry[]) => entries.map((entry) => {
  const indent = '  '.repeat(entry.depth);
  const suffix = entry.kind === 'directory' ? '/' : '';
  return `${indent}- ${entry.relativePath}${suffix}`;
}).join('\n');

export const resolveUserVisiblePath = (config: AppConfig, userId: string, absolutePath: string) => {
  const userRoot = getUserRoot(config, userId);
  if (absolutePath.startsWith(userRoot)) {
    return path.relative(userRoot, absolutePath).replace(/\\/g, '/');
  }

  if (absolutePath.startsWith(config.CWD)) {
    return path.relative(config.CWD, absolutePath).replace(/\\/g, '/');
  }

  return absolutePath;
};
