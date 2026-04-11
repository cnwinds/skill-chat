import { getProjectRoot, loadConfig } from '../config/env.js';
import { createDatabase, migrateDatabase } from '../db/database.js';
import { ensureBaseDirectories } from '../core/storage/fs-utils.js';

const main = async () => {
  const config = loadConfig(getProjectRoot());
  await ensureBaseDirectories(config);
  const db = createDatabase(config);
  migrateDatabase(db);
  db.close();
  console.log(`Database migrated at ${config.DB_PATH}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
