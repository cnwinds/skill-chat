import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { AppConfig } from '../../config/env.js';
import type { AppDatabase } from '../../db/database.js';
import { parseDurationToSeconds } from './session-cookie.js';

type AuthSessionRow = {
  session_id: string;
  user_id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  expires_at: string;
  last_seen_at: string;
};

export type AuthenticatedSession = {
  sessionId: string;
  user: {
    id: string;
    username: string;
    role: 'admin' | 'member';
    status: 'active' | 'disabled';
  };
};

const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const resolveSessionTtlMs = (config: AppConfig) => {
  const ttlSeconds = parseDurationToSeconds(config.SESSION_EXPIRES_IN) ?? DEFAULT_SESSION_TTL_SECONDS;
  return Math.max(1, ttlSeconds) * 1000;
};

export class AuthSessionService {
  private readonly sessionTtlMs: number;

  constructor(
    private readonly db: AppDatabase,
    config: AppConfig,
  ) {
    this.sessionTtlMs = resolveSessionTtlMs(config);
  }

  createSession(userId: string) {
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + this.sessionTtlMs).toISOString();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);

    this.deleteExpiredSessions(nowIso);
    this.db
      .prepare(`
        INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(nanoid(), userId, tokenHash, expiresAt, nowIso, nowIso);

    return token;
  }

  getAuthenticatedSession(token: string): AuthenticatedSession | null {
    const now = new Date();
    const nowIso = now.toISOString();

    this.deleteExpiredSessions(nowIso);

    const row = this.db
      .prepare(`
        SELECT
          auth_sessions.id AS session_id,
          auth_sessions.expires_at,
          auth_sessions.last_seen_at,
          users.id AS user_id,
          users.username,
          users.role,
          users.status
        FROM auth_sessions
        INNER JOIN users ON users.id = auth_sessions.user_id
        WHERE auth_sessions.token_hash = ?
        LIMIT 1
      `)
      .get(hashToken(token)) as AuthSessionRow | undefined;

    if (!row) {
      return null;
    }

    if (row.expires_at <= nowIso) {
      this.revokeSessionById(row.session_id);
      return null;
    }

    const lastSeenMs = Date.parse(row.last_seen_at);
    if (!Number.isNaN(lastSeenMs) && now.getTime() - lastSeenMs >= SESSION_TOUCH_INTERVAL_MS) {
      this.db
        .prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?')
        .run(nowIso, row.session_id);
    }

    return {
      sessionId: row.session_id,
      user: {
        id: row.user_id,
        username: row.username,
        role: row.role,
        status: row.status,
      },
    };
  }

  revokeSessionToken(token: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  revokeUserSessions(userId: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
  }

  private revokeSessionById(sessionId: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(sessionId);
  }

  private deleteExpiredSessions(referenceTimeIso: string) {
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(referenceTimeIso);
  }
}
