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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by TEXT REFERENCES users(id),
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
  ON sessions(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_user_created
  ON files(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_files_session_created
  ON files(session_id, created_at DESC);
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
  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === 'active_skills')) {
    db.exec("ALTER TABLE sessions ADD COLUMN active_skills TEXT NOT NULL DEFAULT '[]'");
  }
};
