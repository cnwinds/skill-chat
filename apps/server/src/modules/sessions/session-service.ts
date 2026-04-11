import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { SessionSummary } from '@skillchat/shared';
import { DEFAULT_SESSION_TITLE } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import type { AppDatabase } from '../../db/database.js';
import { ensureSessionDirectories } from '../../core/storage/fs-utils.js';
import { getSessionMessagesPath, getSessionMetaPath } from '../../core/storage/paths.js';

type SessionRow = {
  id: string;
  title: string;
  active_skills: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  user_id: string;
};

const parseActiveSkills = (raw: string | null | undefined) => {
  if (!raw) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  } catch {
    return [];
  }
};

const toSessionSummary = (row: SessionRow): SessionSummary => ({
  id: row.id,
  title: row.title || DEFAULT_SESSION_TITLE,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessageAt: row.last_message_at,
  activeSkills: parseActiveSkills(row.active_skills),
});

const sessionTitlePrefixPattern = /^(请)?(帮我|帮忙|麻烦你|麻烦|请你|给我|替我|帮忙把)\s*/;
const sessionTitleSuffixPattern = /[吧呀啊呢嘛哈~～。！!？?，,；;：:]+$/;
const markdownNoisePattern = /[`*_#>\[\]\(\)]/g;

const deriveSessionTitle = (message: string) => {
  const compact = message
    .replace(markdownNoisePattern, ' ')
    .replace(/https?:\/\/\S+/gi, '网页链接')
    .replace(/\s+/g, ' ')
    .trim();

  const normalized = compact
    .replace(sessionTitlePrefixPattern, '')
    .replace(sessionTitleSuffixPattern, '')
    .trim();

  const title = normalized || compact || DEFAULT_SESSION_TITLE;
  return title.length > 24 ? `${title.slice(0, 24)}...` : title;
};

export class SessionService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  async create(userId: string, title?: string, activeSkills: string[] = []): Promise<SessionSummary> {
    const id = nanoid();
    const now = new Date().toISOString();
    const sessionTitle = title?.trim() || DEFAULT_SESSION_TITLE;
    const serializedActiveSkills = JSON.stringify(activeSkills);

    this.db
      .prepare('INSERT INTO sessions (id, user_id, title, active_skills, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, userId, sessionTitle, serializedActiveSkills, now, now, null);

    await ensureSessionDirectories(this.config, userId, id, {
      sessionId: id,
      userId,
      title: sessionTitle,
      createdAt: now,
      updatedAt: now,
      activeSkills,
    });

    return {
      id,
      title: sessionTitle,
      createdAt: now,
      updatedAt: now,
      lastMessageAt: null,
      activeSkills,
    };
  }

  async list(userId: string): Promise<SessionSummary[]> {
    const rows = this.db
      .prepare('SELECT id, title, active_skills, created_at, updated_at, last_message_at, user_id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId) as SessionRow[];

    return await Promise.all(rows.map(async (row) => {
      const title = row.title?.trim();
      if (title && title !== DEFAULT_SESSION_TITLE) {
        return toSessionSummary(row);
      }

      const firstMessage = await this.readFirstUserMessage(userId, row.id);
      if (!firstMessage) {
        return toSessionSummary(row);
      }

      const derivedTitle = deriveSessionTitle(firstMessage);
      if (!derivedTitle || derivedTitle === DEFAULT_SESSION_TITLE) {
        return toSessionSummary(row);
      }

      await this.persistTitle(userId, row.id, derivedTitle);
      return toSessionSummary({
        ...row,
        title: derivedTitle,
      });
    }));
  }

  requireOwned(userId: string, sessionId: string): SessionSummary {
    const row = this.db
      .prepare('SELECT id, title, active_skills, created_at, updated_at, last_message_at, user_id FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as SessionRow | undefined;

    if (!row) {
      throw new Error('会话不存在');
    }

    return toSessionSummary(row);
  }

  async touch(userId: string, sessionId: string) {
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE sessions SET updated_at = ?, last_message_at = ? WHERE id = ? AND user_id = ?')
      .run(now, now, sessionId, userId);

    await this.patchMeta(userId, sessionId, (meta) => {
      meta.updatedAt = now;
    });
  }

  async renameFromMessage(userId: string, sessionId: string, currentTitle: string, message: string) {
    const normalizedTitle = currentTitle.trim();
    if (normalizedTitle && normalizedTitle !== DEFAULT_SESSION_TITLE) {
      return;
    }

    const nextTitle = deriveSessionTitle(message);
    if (!nextTitle || nextTitle === DEFAULT_SESSION_TITLE) {
      return;
    }

    await this.persistTitle(userId, sessionId, nextTitle);
  }

  async update(userId: string, sessionId: string, input: { title?: string; activeSkills?: string[] }) {
    const current = this.requireOwned(userId, sessionId);
    const nextTitle = typeof input.title === 'string' ? input.title.trim() || DEFAULT_SESSION_TITLE : current.title;
    const nextActiveSkills = input.activeSkills ? [...input.activeSkills] : current.activeSkills;
    const now = new Date().toISOString();

    this.db
      .prepare('UPDATE sessions SET title = ?, active_skills = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .run(nextTitle, JSON.stringify(nextActiveSkills), now, sessionId, userId);

    await this.patchMeta(userId, sessionId, (meta) => {
      meta.title = nextTitle;
      meta.updatedAt = now;
      meta.activeSkills = nextActiveSkills;
    });

    return this.requireOwned(userId, sessionId);
  }

  private async readFirstUserMessage(userId: string, sessionId: string) {
    const filePath = getSessionMessagesPath(this.config, userId, sessionId);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) {
          continue;
        }

        const event = JSON.parse(line) as {
          kind?: string;
          role?: string;
          content?: unknown;
        };

        if (event.kind === 'message' && event.role === 'user' && typeof event.content === 'string' && event.content.trim()) {
          return event.content;
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private async persistTitle(userId: string, sessionId: string, title: string) {
    this.db
      .prepare('UPDATE sessions SET title = ? WHERE id = ? AND user_id = ?')
      .run(title, sessionId, userId);

    await this.patchMeta(userId, sessionId, (meta) => {
      meta.title = title;
    });
  }

  private async patchMeta(
    userId: string,
    sessionId: string,
    mutate: (meta: Record<string, unknown>) => void,
  ) {
    const metaPath = getSessionMetaPath(this.config, userId, sessionId);
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw) as Record<string, unknown>;
      mutate(meta);
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    } catch {
      // Ignore metadata update failures because DB is the source of truth.
    }
  }
}
