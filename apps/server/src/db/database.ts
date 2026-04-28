import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AppConfig } from '../config/env.js';

const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT,
  active_skills TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT REFERENCES sessions(id),
  display_name TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER NOT NULL,
  bucket TEXT NOT NULL CHECK(bucket IN ('uploads', 'outputs', 'shared')),
  source TEXT NOT NULL CHECK(source IN ('upload', 'generated', 'shared')),
  visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN ('visible', 'hidden')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS installed_skills (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  install_path TEXT NOT NULL,
  source_market_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('installed', 'disabled', 'failed')),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS skill_packages (
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  install_path TEXT NOT NULL,
  source_market_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('installed', 'disabled', 'failed')),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, version)
);

CREATE TABLE IF NOT EXISTS user_installed_skills (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('installed', 'disabled')),
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id, version),
  FOREIGN KEY (id, version) REFERENCES skill_packages(id, version) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
  ON sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires
  ON auth_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_files_user_created
  ON files(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_session_created
  ON files(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_installed_skills_status
  ON installed_skills(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_skill_packages_status
  ON skill_packages(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_installed_skills_user_status
  ON user_installed_skills(user_id, status, updated_at DESC);
`;

export type AppDatabase = Database.Database;

export const createDatabase = (config: AppConfig): AppDatabase => {
  fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
  const db = new Database(config.DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
};

export const migrateDatabase = (db: AppDatabase) => {
  db.exec(schemaSql);
  const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === 'status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled'))");
  }
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === 'active_skills')) {
    db.exec("ALTER TABLE sessions ADD COLUMN active_skills TEXT NOT NULL DEFAULT '[]'");
  }
  const fileColumns = db.prepare('PRAGMA table_info(files)').all() as Array<{ name: string }>;
  const hasFileVisibility = fileColumns.some((column) => column.name === 'visibility');
  if (!hasFileVisibility) {
    db.exec("ALTER TABLE files ADD COLUMN visibility TEXT NOT NULL DEFAULT 'visible' CHECK(visibility IN ('visible', 'hidden'))");
    db.exec(`
      UPDATE files
      SET visibility = 'hidden'
      WHERE source = 'generated'
        AND (
          lower(display_name) IN (
            '[content_types].xml',
            'app.xml',
            'comments.xml',
            'core.xml',
            'document.xml',
            'endnotes.xml',
            'fonttable.xml',
            'footnotes.xml',
            'numbering.xml',
            'presentation.xml',
            'settings.xml',
            'sharedstrings.xml',
            'styles.xml',
            'theme1.xml',
            'websettings.xml',
            'workbook.xml'
          )
          OR lower(display_name) LIKE '%.rels'
          OR lower(display_name) LIKE '%.tmp'
          OR lower(display_name) LIKE '%.temp'
          OR lower(display_name) LIKE '%.bak'
          OR lower(display_name) LIKE '%.map'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/tmp/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/temp/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/scratch/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/intermediate/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/intermediates/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/parts/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/_rels/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/word/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/xl/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/ppt/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/docprops/%'
          OR lower(replace(relative_path, char(92), '/')) LIKE '%/outputs/customxml/%'
        )
    `);
  }
  db.exec(`
    INSERT OR IGNORE INTO skill_packages (
      id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
    )
    SELECT id, version, manifest_json, install_path, source_market_url, status, installed_at, updated_at
    FROM installed_skills
  `);
};
