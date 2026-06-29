import { getProjectRoot, loadConfig } from '../config/env.js';
import { createDatabase, migrateDatabase } from '../db/database.js';
import { ensureBaseDirectories } from '@harnesskit/core';
import { toHarnessConfig } from '../adapters/harness-config.js';

const main = async () => {
  const config = loadConfig(getProjectRoot());
  await ensureBaseDirectories(toHarnessConfig(config));
  const db = createDatabase(config);
  migrateDatabase(db);
  db.close();
  console.log(`Database migrated at ${config.DB_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
