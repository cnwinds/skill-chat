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
  status: 'active' | 'disabled';
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
    return this.registerMember(input);
  }

  async registerMember(input: { username: string; password: string; inviteCode?: string | null }, options?: {
    requireInviteCode?: boolean;
  }): Promise<UserSummary> {
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
    if (existing) {
      throw new Error('用户名已存在');
    }

    const requireInviteCode = options?.requireInviteCode ?? true;
    let invite: { code: string; used_by: string | null } | undefined;
    if (requireInviteCode) {
      if (!input.inviteCode) {
        throw new Error('当前注册需要邀请码');
      }
      invite = this.db
        .prepare('SELECT code, used_by FROM invite_codes WHERE code = ?')
        .get(input.inviteCode) as { code: string; used_by: string | null } | undefined;

      if (!invite || invite.used_by) {
        throw new Error('邀请码无效或已使用');
      }
    }

    const id = nanoid();
    const passwordHash = await bcrypt.hash(input.password, 10);

    this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)')
        .run(id, input.username, passwordHash, 'member');

      if (invite && input.inviteCode) {
        this.db
          .prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ?')
          .run(id, new Date().toISOString(), input.inviteCode);
      }
    })();

    await ensureUserDirectories(this.config, id);

    return {
      id,
      username: input.username,
      role: 'member',
      status: 'active',
    };
  }

  async bootstrapAdmin(input: { username: string; password: string }): Promise<UserSummary> {
    const existingAdmin = this.db
      .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
      .get() as { id: string } | undefined;
    if (existingAdmin) {
      throw new Error('系统已存在管理员，不能重复初始化');
    }

    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(input.username);
    if (existing) {
      throw new Error('用户名已存在');
    }

    const id = nanoid();
    const passwordHash = await bcrypt.hash(input.password, 10);
    this.db
      .prepare('INSERT INTO users (id, username, password, role, status) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.username, passwordHash, 'admin', 'active');

    await ensureUserDirectories(this.config, id);

    return {
      id,
      username: input.username,
      role: 'admin',
      status: 'active',
    };
  }

  async login(input: { username: string; password: string }): Promise<UserSummary> {
    const row = this.db
      .prepare('SELECT id, username, password, role, status FROM users WHERE username = ?')
      .get(input.username) as UserRow | undefined;

    if (!row) {
      throw new Error('用户名或密码错误');
    }

    if (row.status === 'disabled') {
      throw new Error('用户已被禁用');
    }

    const ok = await bcrypt.compare(input.password, row.password);
    if (!ok) {
      throw new Error('用户名或密码错误');
    }

    return toUserSummary(row);
  }

  getUserById(userId: string): UserSummary | null {
    const row = this.db
      .prepare('SELECT id, username, password, role, status FROM users WHERE id = ?')
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
