import { getProjectRoot, loadConfig } from '../config/env.js';
import { createDatabase, migrateDatabase } from '../db/database.js';
import { ensureBaseDirectories } from '../core/storage/fs-utils.js';
import { AuthService } from '../modules/auth/auth-service.js';

const main = async () => {
  const config = loadConfig(getProjectRoot());
  await ensureBaseDirectories(config);
  const db = createDatabase(config);
  migrateDatabase(db);

  const authService = new AuthService(db, config);
  const count = Number(process.argv[2] ?? '1');

  for (let index = 0; index < count; index += 1) {
    console.log(authService.createInviteCode());
  }

  db.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
