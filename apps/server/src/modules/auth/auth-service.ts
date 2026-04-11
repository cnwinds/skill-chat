import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import type { UserSummary } from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';
import type { AppConfig } from '../../config/env.js';
import { ensureUserDirectories } from '../../core/storage/fs-utils.js';

type UserRow = {
  id: string;
  username: string;
  password: string;
  role: 'admin' | 'member';
};

const toUserSummary = (row: UserRow): UserSummary => ({
  id: row.id,
  username: row.username,
  role: row.role,
});

export class AuthService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  async register(input: { username: string; password: string; inviteCode: string }): Promise<UserSummary> {
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
    if (existing) {
      throw new Error('用户名已存在');
    }

    const invite = this.db
      .prepare('SELECT code, used_by FROM invite_codes WHERE code = ?')
      .get(input.inviteCode) as { code: string; used_by: string | null } | undefined;

    if (!invite || invite.used_by) {
      throw new Error('邀请码无效或已使用');
    }

    const id = nanoid();
    const passwordHash = await bcrypt.hash(input.password, 10);

    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)')
        .run(id, input.username, passwordHash, 'member');

      this.db
        .prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?')
        .run(id, new Date().toISOString(), input.inviteCode);
    })();

    await ensureUserDirectories(this.config, id);

    return {
      id,
      username: input.username,
      role: 'member',
    };
  }

  async login(input: { username: string; password: string }): Promise<UserSummary> {
    const row = this.db
      .prepare('SELECT id, username, password, role FROM users WHERE username = ?')
      .get(input.username) as UserRow | undefined;

    if (!row) {
      throw new Error('用户名或密码错误');
    }

    const ok = await bcrypt.compare(input.password, row.password);
    if (!ok) {
      throw new Error('用户名或密码错误');
    }

    return toUserSummary(row);
  }

  getUserById(userId: string): UserSummary | null {
    const row = this.db
      .prepare('SELECT id, username, password, role FROM users WHERE id = ?')
      .get(userId) as UserRow | undefined;
    return row ? toUserSummary(row) : null;
  }

  createInviteCode(createdBy?: string | null) {
    const code = `INV-${nanoid(8).toUpperCase()}`;
    this.db
      .prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)')
      .run(code, createdBy ?? null);
    return code;
  }
}
