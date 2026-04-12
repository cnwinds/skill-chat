import type { SystemSettings, SystemStatus } from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';
import type { AppConfig } from '../../config/env.js';

type SettingRow = {
  key: string;
  value: string;
};

const SYSTEM_SETTING_KEYS = {
  registrationRequiresInviteCode: 'registration_requires_invite_code',
  enableAssistantTools: 'enable_assistant_tools',
  webOrigin: 'web_origin',
  openaiBaseUrl: 'openai_base_url',
  openaiApiKey: 'openai_api_key',
  openaiModel: 'openai_model',
  openaiReasoningEffort: 'openai_reasoning_effort',
  llmMaxOutputTokens: 'llm_max_output_tokens',
  toolMaxOutputTokens: 'tool_max_output_tokens',
} as const;

const LEGACY_SYSTEM_SETTING_KEYS = [
  'default_session_active_skills',
  'openai_model_router',
  'openai_model_planner',
  'openai_model_reply',
  'openai_reasoning_effort_reply',
  'anthropic_base_url',
  'anthropic_api_key',
  'anthropic_model_router',
  'anthropic_model_planner',
  'anthropic_model_reply',
  'anthropic_model',
] as const;

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  return value === 'true';
};

const parseNumber = (value: string | undefined, fallback: number) => {
  if (typeof value !== 'string') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export class SystemSettingsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  initialize() {
    const current = this.getSettings();
    this.persistDefaults(current);
    this.cleanupObsoleteSettings();
    this.applyToRuntimeConfig(current);
  }

  getStatus(): SystemStatus {
    const adminCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'")
      .get() as { count: number };
    const settings = this.getSettings();

    return {
      initialized: adminCount.count > 0,
      hasAdmin: adminCount.count > 0,
      registrationRequiresInviteCode: settings.registrationRequiresInviteCode,
    };
  }

  getSettings(): SystemSettings {
    const rows = this.db.prepare('SELECT key, value FROM system_settings').all() as SettingRow[];
    const map = new Map(rows.map((row) => [row.key, row.value]));

    return {
      registrationRequiresInviteCode: parseBoolean(
        map.get(SYSTEM_SETTING_KEYS.registrationRequiresInviteCode),
        true,
      ),
      enableAssistantTools: parseBoolean(
        map.get(SYSTEM_SETTING_KEYS.enableAssistantTools),
        this.config.ENABLE_ASSISTANT_TOOLS,
      ),
      webOrigin: map.get(SYSTEM_SETTING_KEYS.webOrigin) ?? this.config.WEB_ORIGIN,
      modelConfig: {
        openaiBaseUrl: map.get(SYSTEM_SETTING_KEYS.openaiBaseUrl) ?? this.config.OPENAI_BASE_URL,
        openaiApiKey: map.get(SYSTEM_SETTING_KEYS.openaiApiKey) ?? this.config.OPENAI_API_KEY,
        openaiModel:
          map.get(SYSTEM_SETTING_KEYS.openaiModel)
          ?? map.get('openai_model_reply')
          ?? map.get('openai_model_planner')
          ?? this.config.OPENAI_MODEL,
        openaiReasoningEffort:
          (map.get(SYSTEM_SETTING_KEYS.openaiReasoningEffort) as SystemSettings['modelConfig']['openaiReasoningEffort'] | undefined)
          ?? (map.get('openai_reasoning_effort_reply') as SystemSettings['modelConfig']['openaiReasoningEffort'] | undefined)
          ?? this.config.OPENAI_REASONING_EFFORT,
        llmMaxOutputTokens: parseNumber(
          map.get(SYSTEM_SETTING_KEYS.llmMaxOutputTokens),
          this.config.LLM_MAX_OUTPUT_TOKENS,
        ),
        toolMaxOutputTokens: parseNumber(
          map.get(SYSTEM_SETTING_KEYS.toolMaxOutputTokens),
          this.config.TOOL_MAX_OUTPUT_TOKENS,
        ),
      },
    };
  }

  updateSettings(
    patch: Partial<Omit<SystemSettings, 'modelConfig'>> & {
      modelConfig?: Partial<SystemSettings['modelConfig']>;
    },
    updatedBy: string,
  ) {
    const current = this.getSettings();
    const next: SystemSettings = {
      registrationRequiresInviteCode: patch.registrationRequiresInviteCode ?? current.registrationRequiresInviteCode,
      enableAssistantTools: patch.enableAssistantTools ?? current.enableAssistantTools,
      webOrigin: patch.webOrigin ?? current.webOrigin,
      modelConfig: {
        ...current.modelConfig,
        ...(patch.modelConfig ?? {}),
      },
    };

    const now = new Date().toISOString();
    const upsert = this.db.prepare(`
      INSERT INTO system_settings (key, value, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by
    `);

    this.db.transaction(() => {
      upsert.run(SYSTEM_SETTING_KEYS.registrationRequiresInviteCode, String(next.registrationRequiresInviteCode), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.enableAssistantTools, String(next.enableAssistantTools), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.webOrigin, next.webOrigin, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, next.modelConfig.openaiBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, next.modelConfig.openaiApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModel, next.modelConfig.openaiModel, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffort, next.modelConfig.openaiReasoningEffort, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.llmMaxOutputTokens, String(next.modelConfig.llmMaxOutputTokens), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.toolMaxOutputTokens, String(next.modelConfig.toolMaxOutputTokens), now, updatedBy);
    })();

    this.applyToRuntimeConfig(next);
    return next;
  }

  private persistDefaults(settings: SystemSettings) {
    const upsert = this.db.prepare(`
      INSERT INTO system_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `);

    this.db.transaction(() => {
      upsert.run(SYSTEM_SETTING_KEYS.registrationRequiresInviteCode, String(settings.registrationRequiresInviteCode));
      upsert.run(SYSTEM_SETTING_KEYS.enableAssistantTools, String(settings.enableAssistantTools));
      upsert.run(SYSTEM_SETTING_KEYS.webOrigin, settings.webOrigin);
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, settings.modelConfig.openaiBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, settings.modelConfig.openaiApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModel, settings.modelConfig.openaiModel);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffort, settings.modelConfig.openaiReasoningEffort);
      upsert.run(SYSTEM_SETTING_KEYS.llmMaxOutputTokens, String(settings.modelConfig.llmMaxOutputTokens));
      upsert.run(SYSTEM_SETTING_KEYS.toolMaxOutputTokens, String(settings.modelConfig.toolMaxOutputTokens));
    })();
  }

  private applyToRuntimeConfig(settings: SystemSettings) {
    this.config.ENABLE_ASSISTANT_TOOLS = settings.enableAssistantTools;
    this.config.WEB_ORIGIN = settings.webOrigin;
    this.config.OPENAI_BASE_URL = settings.modelConfig.openaiBaseUrl;
    this.config.OPENAI_API_KEY = settings.modelConfig.openaiApiKey;
    this.config.OPENAI_MODEL = settings.modelConfig.openaiModel;
    this.config.OPENAI_REASONING_EFFORT = settings.modelConfig.openaiReasoningEffort;
    this.config.LLM_MAX_OUTPUT_TOKENS = settings.modelConfig.llmMaxOutputTokens;
    this.config.TOOL_MAX_OUTPUT_TOKENS = settings.modelConfig.toolMaxOutputTokens;
  }

  private cleanupObsoleteSettings() {
    const remove = this.db.prepare('DELETE FROM system_settings WHERE key = ?');
    this.db.transaction(() => {
      for (const key of LEGACY_SYSTEM_SETTING_KEYS) {
        remove.run(key);
      }
    })();
  }
}
