import type { SystemSettings, SystemStatus } from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';
import type { AppConfig } from '../../config/env.js';

type SettingRow = {
  key: string;
  value: string;
};

const SYSTEM_SETTING_KEYS = {
  registrationRequiresInviteCode: 'registration_requires_invite_code',
  defaultSessionActiveSkills: 'default_session_active_skills',
  enableAssistantTools: 'enable_assistant_tools',
  webOrigin: 'web_origin',
  openaiBaseUrl: 'openai_base_url',
  openaiApiKey: 'openai_api_key',
  openaiModelRouter: 'openai_model_router',
  openaiModelPlanner: 'openai_model_planner',
  openaiModelReply: 'openai_model_reply',
  openaiReasoningEffortReply: 'openai_reasoning_effort_reply',
  anthropicBaseUrl: 'anthropic_base_url',
  anthropicApiKey: 'anthropic_api_key',
  llmMaxOutputTokens: 'llm_max_output_tokens',
  toolMaxOutputTokens: 'tool_max_output_tokens',
} as const;

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

const parseStringArray = (value: string | undefined, fallback: string[]) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed;
    }
  } catch {
    return fallback;
  }

  return fallback;
};

export class SystemSettingsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  initialize() {
    const current = this.getSettings();
    this.persistDefaults(current);
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
      defaultSessionActiveSkills: parseStringArray(
        map.get(SYSTEM_SETTING_KEYS.defaultSessionActiveSkills),
        this.config.DEFAULT_SESSION_ACTIVE_SKILLS,
      ),
      enableAssistantTools: parseBoolean(
        map.get(SYSTEM_SETTING_KEYS.enableAssistantTools),
        this.config.ENABLE_ASSISTANT_TOOLS,
      ),
      webOrigin: map.get(SYSTEM_SETTING_KEYS.webOrigin) ?? this.config.WEB_ORIGIN,
      modelConfig: {
        openaiBaseUrl: map.get(SYSTEM_SETTING_KEYS.openaiBaseUrl) ?? this.config.OPENAI_BASE_URL,
        openaiApiKey: map.get(SYSTEM_SETTING_KEYS.openaiApiKey) ?? this.config.OPENAI_API_KEY,
        openaiModelRouter: map.get(SYSTEM_SETTING_KEYS.openaiModelRouter) ?? this.config.OPENAI_MODEL_ROUTER,
        openaiModelPlanner: map.get(SYSTEM_SETTING_KEYS.openaiModelPlanner) ?? this.config.OPENAI_MODEL_PLANNER,
        openaiModelReply: map.get(SYSTEM_SETTING_KEYS.openaiModelReply) ?? this.config.OPENAI_MODEL_REPLY,
        openaiReasoningEffortReply:
          (map.get(SYSTEM_SETTING_KEYS.openaiReasoningEffortReply) as SystemSettings['modelConfig']['openaiReasoningEffortReply'] | undefined)
          ?? this.config.OPENAI_REASONING_EFFORT_REPLY,
        anthropicBaseUrl: map.get(SYSTEM_SETTING_KEYS.anthropicBaseUrl) ?? this.config.ANTHROPIC_BASE_URL,
        anthropicApiKey: map.get(SYSTEM_SETTING_KEYS.anthropicApiKey) ?? (this.config.ANTHROPIC_AUTH_TOKEN || this.config.ANTHROPIC_API_KEY),
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
      defaultSessionActiveSkills: patch.defaultSessionActiveSkills ?? current.defaultSessionActiveSkills,
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
      upsert.run(SYSTEM_SETTING_KEYS.defaultSessionActiveSkills, JSON.stringify(next.defaultSessionActiveSkills), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.enableAssistantTools, String(next.enableAssistantTools), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.webOrigin, next.webOrigin, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, next.modelConfig.openaiBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, next.modelConfig.openaiApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelRouter, next.modelConfig.openaiModelRouter, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelPlanner, next.modelConfig.openaiModelPlanner, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelReply, next.modelConfig.openaiModelReply, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffortReply, next.modelConfig.openaiReasoningEffortReply, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.anthropicBaseUrl, next.modelConfig.anthropicBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.anthropicApiKey, next.modelConfig.anthropicApiKey, now, updatedBy);
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
      upsert.run(SYSTEM_SETTING_KEYS.defaultSessionActiveSkills, JSON.stringify(settings.defaultSessionActiveSkills));
      upsert.run(SYSTEM_SETTING_KEYS.enableAssistantTools, String(settings.enableAssistantTools));
      upsert.run(SYSTEM_SETTING_KEYS.webOrigin, settings.webOrigin);
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, settings.modelConfig.openaiBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, settings.modelConfig.openaiApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelRouter, settings.modelConfig.openaiModelRouter);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelPlanner, settings.modelConfig.openaiModelPlanner);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModelReply, settings.modelConfig.openaiModelReply);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffortReply, settings.modelConfig.openaiReasoningEffortReply);
      upsert.run(SYSTEM_SETTING_KEYS.anthropicBaseUrl, settings.modelConfig.anthropicBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.anthropicApiKey, settings.modelConfig.anthropicApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.llmMaxOutputTokens, String(settings.modelConfig.llmMaxOutputTokens));
      upsert.run(SYSTEM_SETTING_KEYS.toolMaxOutputTokens, String(settings.modelConfig.toolMaxOutputTokens));
    })();
  }

  private applyToRuntimeConfig(settings: SystemSettings) {
    this.config.ENABLE_ASSISTANT_TOOLS = settings.enableAssistantTools;
    this.config.WEB_ORIGIN = settings.webOrigin;
    this.config.DEFAULT_SESSION_ACTIVE_SKILLS = settings.defaultSessionActiveSkills;
    this.config.OPENAI_BASE_URL = settings.modelConfig.openaiBaseUrl;
    this.config.OPENAI_API_KEY = settings.modelConfig.openaiApiKey;
    this.config.OPENAI_MODEL_ROUTER = settings.modelConfig.openaiModelRouter;
    this.config.OPENAI_MODEL_PLANNER = settings.modelConfig.openaiModelPlanner;
    this.config.OPENAI_MODEL_REPLY = settings.modelConfig.openaiModelReply;
    this.config.OPENAI_REASONING_EFFORT_REPLY = settings.modelConfig.openaiReasoningEffortReply;
    this.config.ANTHROPIC_BASE_URL = settings.modelConfig.anthropicBaseUrl;
    this.config.ANTHROPIC_API_KEY = settings.modelConfig.anthropicApiKey;
    this.config.ANTHROPIC_AUTH_TOKEN = settings.modelConfig.anthropicApiKey;
    this.config.LLM_MAX_OUTPUT_TOKENS = settings.modelConfig.llmMaxOutputTokens;
    this.config.TOOL_MAX_OUTPUT_TOKENS = settings.modelConfig.toolMaxOutputTokens;
  }
}
