import type { UserPreferenceSettings } from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';

type SettingRow = {
  key: string;
  value: string;
};

const DEFAULT_SETTINGS: UserPreferenceSettings = {
  themeMode: 'dark',
};

export class UserSettingsService {
  constructor(private readonly db: AppDatabase) {}

  get(userId: string): UserPreferenceSettings {
    const rows = this.db
      .prepare('SELECT key, value FROM user_settings WHERE user_id = ?')
      .all(userId) as SettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      themeMode: map.get('theme_mode') === 'light' ? 'light' : DEFAULT_SETTINGS.themeMode,
    };
  }

  update(userId: string, patch: Partial<UserPreferenceSettings>) {
    const current = this.get(userId);
    const next: UserPreferenceSettings = {
      themeMode: patch.themeMode ?? current.themeMode,
    };
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO user_settings (user_id, key, value, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(userId, 'theme_mode', next.themeMode, now);

    return next;
  }
}
