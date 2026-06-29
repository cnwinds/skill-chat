import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../config/env.js';
import { ensureUserDirectories } from '../core/storage/fs-utils.js';

const password = process.argv[2] ?? '12345678';
const username = process.argv[3] ?? 'admin';

const projectRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const config = loadConfig(projectRoot);
const db = new Database(config.DB_PATH);

type UserRow = { id: string; username: string; role: string };

const users = db.prepare('SELECT id, username, role FROM users').all() as UserRow[];

const passwordHash = bcrypt.hashSync(password, 10);

const target =
  users.find((user) => user.username === username)
  ?? users.find((user) => user.role === 'admin');

if (target) {
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(passwordHash, target.id);
  console.log(`Reset password for "${target.username}" (${target.id}).`);
  db.close();
  process.exit(0);
}

const existingAdmin = db
  .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
  .get() as { id: string } | undefined;
if (existingAdmin) {
  console.error('Admin already exists under a different username.');
  db.close();
  process.exit(1);
}

const id = nanoid();
db.prepare('INSERT INTO users (id, username, password, role, status) VALUES (?, ?, ?, ?, ?)').run(
  id,
  username,
  passwordHash,
  'admin',
  'active',
);

await ensureUserDirectories(config, id);
console.log(`Created admin user "${username}" (${id}).`);

db.close();
