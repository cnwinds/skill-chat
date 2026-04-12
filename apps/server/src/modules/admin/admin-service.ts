import { nanoid } from 'nanoid';
import type { AdminUserSummary, InviteCodeSummary } from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';

type UserRow = {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status: 'active' | 'disabled';
  created_at: string;
};

type InviteRow = {
  code: string;
  created_by: string | null;
  used_by_username: string | null;
  used_at: string | null;
  created_at: string;
};

export class AdminService {
  constructor(private readonly db: AppDatabase) {}

  listUsers(): AdminUserSummary[] {
    const rows = this.db
      .prepare('SELECT id, username, role, status, created_at FROM users ORDER BY created_at ASC')
      .all() as UserRow[];

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
    }));
  }

  updateUser(
    targetUserId: string,
    patch: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' },
  ): AdminUserSummary {
    const current = this.db
      .prepare('SELECT id, username, role, status, created_at FROM users WHERE id = ?')
      .get(targetUserId) as UserRow | undefined;
    if (!current) {
      throw new Error('用户不存在');
    }

    const nextRole = patch.role ?? current.role;
    const nextStatus = patch.status ?? current.status;
    this.ensureAdminSafety(current, nextRole, nextStatus);

    this.db
      .prepare('UPDATE users SET role = ?, status = ? WHERE id = ?')
      .run(nextRole, nextStatus, targetUserId);

    return {
      id: current.id,
      username: current.username,
      role: nextRole,
      status: nextStatus,
      createdAt: current.created_at,
    };
  }

  listInviteCodes(): InviteCodeSummary[] {
    const rows = this.db
      .prepare(`
        SELECT
          invite_codes.code,
          invite_codes.created_by,
          used_user.username AS used_by_username,
          invite_codes.used_at,
          invite_codes.created_at
        FROM invite_codes
        LEFT JOIN users AS used_user ON used_user.id = invite_codes.used_by
        ORDER BY invite_codes.created_at DESC
      `)
      .all() as InviteRow[];
    return rows.map((row) => ({
      code: row.code,
      createdBy: row.created_by,
      usedBy: row.used_by_username,
      usedAt: row.used_at,
      createdAt: row.created_at,
    }));
  }

  createInviteCodes(count: number, createdBy: string) {
    const insert = this.db.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)');
    const codes = this.db.transaction(() => {
      const generated: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const code = `INV-${nanoid(8).toUpperCase()}`;
        insert.run(code, createdBy);
        generated.push(code);
      }
      return generated;
    })();

    return { codes };
  }

  deleteInviteCode(code: string) {
    const invite = this.db
      .prepare('SELECT code, used_by FROM invite_codes WHERE code = ?')
      .get(code) as { code: string; used_by: string | null } | undefined;
    if (!invite) {
      throw new Error('邀请码不存在');
    }
    if (invite.used_by) {
      throw new Error('已使用的邀请码不能删除');
    }
    this.db.prepare('DELETE FROM invite_codes WHERE code = ?').run(code);
  }

  private ensureAdminSafety(
    current: Pick<UserRow, 'id' | 'role' | 'status'>,
    nextRole: 'admin' | 'member',
    nextStatus: 'active' | 'disabled',
  ) {
    if (current.role !== 'admin') {
      return;
    }

    const removingAdminPrivilege = nextRole !== 'admin' || nextStatus !== 'active';
    if (!removingAdminPrivilege) {
      return;
    }

    const activeAdminCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND status = 'active'")
      .get() as { count: number };
    if (activeAdminCount.count <= 1) {
      throw new Error('至少需要保留一个启用中的管理员');
    }
  }
}
