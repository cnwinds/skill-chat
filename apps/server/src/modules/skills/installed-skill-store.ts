import type { InstalledSkillRecord, SkillManifest } from '@qizhi/skill-spec';
import { installedSkillRecordSchema } from '@qizhi/skill-spec';
import type { AppDatabase } from '../../db/database.js';

type InstalledSkillRow = {
  id: string;
  version: string;
  manifest_json: string;
  install_path: string;
  source_market_url: string;
  status: 'installed' | 'disabled' | 'failed';
  installed_at: string;
  updated_at: string;
};

const toRecord = (row: InstalledSkillRow): InstalledSkillRecord => installedSkillRecordSchema.parse({
  id: row.id,
  version: row.version,
  manifest: JSON.parse(row.manifest_json) as SkillManifest,
  installPath: row.install_path,
  sourceMarketUrl: row.source_market_url,
  status: row.status,
  installedAt: row.installed_at,
  updatedAt: row.updated_at,
});

export class InstalledSkillStore {
  constructor(private readonly db: AppDatabase) {}

  listPackages(): InstalledSkillRecord[] {
    const rows = this.db.prepare(`
      SELECT id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
      FROM skill_packages
      ORDER BY updated_at DESC, id ASC
    `).all() as InstalledSkillRow[];
    return rows.map(toRecord);
  }

  listForUser(userId: string): InstalledSkillRecord[] {
    const rows = this.db.prepare(`
      SELECT
        p.id,
        p.version,
        p.manifest_json,
        p.install_path,
        p.source_market_url,
        u.status,
        u.installed_at,
        u.updated_at
      FROM user_installed_skills u
      JOIN skill_packages p ON p.id = u.id AND p.version = u.version
      WHERE u.user_id = ?
      ORDER BY u.updated_at DESC, p.id ASC
    `).all(userId) as InstalledSkillRow[];
    return rows.map(toRecord);
  }

  upsertPackage(input: {
    manifest: SkillManifest;
    installPath: string;
    sourceMarketUrl: string;
  }): InstalledSkillRecord {
    const now = new Date().toISOString();
    const params = {
      id: input.manifest.id,
      version: input.manifest.version,
      manifestJson: JSON.stringify(input.manifest),
      installPath: input.installPath,
      sourceMarketUrl: input.sourceMarketUrl,
      now,
    };

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO skill_packages (
          id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
        )
        VALUES (@id, @version, @manifestJson, @installPath, @sourceMarketUrl, 'installed', @now, @now)
        ON CONFLICT(id, version) DO UPDATE SET
          manifest_json = excluded.manifest_json,
          install_path = excluded.install_path,
          source_market_url = excluded.source_market_url,
          status = 'installed',
          updated_at = excluded.updated_at
      `).run(params);

      this.db.prepare(`
        INSERT INTO installed_skills (
          id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
        )
        VALUES (@id, @version, @manifestJson, @installPath, @sourceMarketUrl, 'installed', @now, @now)
        ON CONFLICT(id, version) DO UPDATE SET
          manifest_json = excluded.manifest_json,
          install_path = excluded.install_path,
          source_market_url = excluded.source_market_url,
          status = 'installed',
          updated_at = excluded.updated_at
      `).run(params);
    })();

    const record = this.getPackage(input.manifest.id, input.manifest.version);
    if (!record) {
      throw new Error('Skill package record was not persisted');
    }
    return record;
  }

  upsertUserInstalled(userId: string, id: string, version: string): InstalledSkillRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO user_installed_skills (
        user_id, id, version, status, installed_at, updated_at
      )
      VALUES (?, ?, ?, 'installed', ?, ?)
      ON CONFLICT(user_id, id, version) DO UPDATE SET
        status = 'installed',
        updated_at = excluded.updated_at
    `).run(userId, id, version, now, now);

    const record = this.getForUser(userId, id, version);
    if (!record) {
      throw new Error('User skill install record was not persisted');
    }
    return record;
  }

  removeUserInstalled(userId: string, id: string, version?: string): InstalledSkillRecord {
    const record = version
      ? this.getForUser(userId, id, version)
      : this.getLatestForUser(userId, id);
    if (!record) {
      throw new Error(`Skill is not installed for this user: ${id}`);
    }

    this.db.prepare(`
      DELETE FROM user_installed_skills
      WHERE user_id = ? AND id = ? AND version = ?
    `).run(userId, record.id, record.version);
    return record;
  }

  getPackage(id: string, version: string): InstalledSkillRecord | undefined {
    const row = this.db.prepare(`
      SELECT id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
      FROM skill_packages
      WHERE id = ? AND version = ?
    `).get(id, version) as InstalledSkillRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  getForUser(userId: string, id: string, version: string): InstalledSkillRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        p.id,
        p.version,
        p.manifest_json,
        p.install_path,
        p.source_market_url,
        u.status,
        u.installed_at,
        u.updated_at
      FROM user_installed_skills u
      JOIN skill_packages p ON p.id = u.id AND p.version = u.version
      WHERE u.user_id = ? AND u.id = ? AND u.version = ?
    `).get(userId, id, version) as InstalledSkillRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  getLatestForUser(userId: string, id: string): InstalledSkillRecord | undefined {
    const row = this.db.prepare(`
      SELECT
        p.id,
        p.version,
        p.manifest_json,
        p.install_path,
        p.source_market_url,
        u.status,
        u.installed_at,
        u.updated_at
      FROM user_installed_skills u
      JOIN skill_packages p ON p.id = u.id AND p.version = u.version
      WHERE u.user_id = ? AND u.id = ?
      ORDER BY u.updated_at DESC
      LIMIT 1
    `).get(userId, id) as InstalledSkillRow | undefined;
    return row ? toRecord(row) : undefined;
  }

  hasUserInstalled(userId: string, id: string, version?: string): boolean {
    if (version) {
      const row = this.db.prepare(`
        SELECT 1
        FROM user_installed_skills
        WHERE user_id = ? AND id = ? AND version = ? AND status = 'installed'
        LIMIT 1
      `).get(userId, id, version) as { 1: number } | undefined;
      return Boolean(row);
    }

    const row = this.db.prepare(`
      SELECT 1
      FROM user_installed_skills
      WHERE user_id = ? AND id = ? AND status = 'installed'
      LIMIT 1
    `).get(userId, id) as { 1: number } | undefined;
    return Boolean(row);
  }
}
