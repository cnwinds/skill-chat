import type {
  ImageConfig,
  NativeToolsPolicy,
  SystemSettings,
  SystemStatus,
  WebSearchConfig,
  WebSearchMode,
} from '@skillchat/shared';
import type { AppDatabase } from '../../db/database.js';
import type { AppConfig } from '../../config/env.js';

type SettingRow = {
  key: string;
  value: string;
};

const SYSTEM_SETTING_KEYS = {
  registrationRequiresInviteCode: 'registration_requires_invite_code',
  enableAssistantTools: 'enable_assistant_tools',
  openaiBaseUrl: 'openai_base_url',
  openaiApiKey: 'openai_api_key',
  openaiModel: 'openai_model',
  openaiReasoningEffort: 'openai_reasoning_effort',
  llmMaxOutputTokens: 'llm_max_output_tokens',
  toolMaxOutputTokens: 'tool_max_output_tokens',
  webSearchMode: 'web_search_mode',
  webSearchProviders: 'web_search_providers',
  openaiNativeWebSearch: 'openai_native_web_search',
  tavilyApiKey: 'tavily_api_key',
  serperApiKey: 'serper_api_key',
  braveSearchApiKey: 'brave_search_api_key',
  openaiNativeImageGeneration: 'openai_native_image_generation',
  imageProviders: 'image_providers',
  openaiImageApiKey: 'openai_image_api_key',
  openaiImageBaseUrl: 'openai_image_base_url',
  openaiImageModel: 'openai_image_model',
  zhipuImageApiKey: 'zhipu_image_api_key',
  zhipuImageBaseUrl: 'zhipu_image_base_url',
  zhipuImageModel: 'zhipu_image_model',
  dashscopeImageApiKey: 'dashscope_image_api_key',
  dashscopeImageBaseUrl: 'dashscope_image_base_url',
  dashscopeImageModel: 'dashscope_image_model',
} as const;

const LEGACY_SYSTEM_SETTING_KEYS = [
  'default_session_active_skills',
  'openai_model_router',
  'openai_model_planner',
  'openai_model_reply',
  'openai_reasoning_effort_reply',
  'web_origin',
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

const parseNativeToolsPolicy = (value: string | undefined, fallback: NativeToolsPolicy): NativeToolsPolicy => {
  if (value === 'auto' || value === 'on' || value === 'off') {
    return value;
  }
  return fallback;
};

const parseWebSearchMode = (value: string | undefined, fallback: WebSearchMode): WebSearchMode => {
  if (value === 'live' || value === 'cached' || value === 'disabled') {
    return value;
  }
  return fallback;
};

const parseString = (value: string | undefined, fallback: string) =>
  typeof value === 'string' ? value : fallback;

const buildWebSearchConfig = (map: Map<string, string>, config: AppConfig): WebSearchConfig => ({
  mode: parseWebSearchMode(map.get(SYSTEM_SETTING_KEYS.webSearchMode), config.WEB_SEARCH_MODE),
  openaiNative: parseNativeToolsPolicy(
    map.get(SYSTEM_SETTING_KEYS.openaiNativeWebSearch),
    config.OPENAI_NATIVE_WEB_SEARCH,
  ),
  providers: parseString(map.get(SYSTEM_SETTING_KEYS.webSearchProviders), config.WEB_SEARCH_PROVIDERS),
  tavilyApiKey: parseString(map.get(SYSTEM_SETTING_KEYS.tavilyApiKey), config.TAVILY_API_KEY),
  serperApiKey: parseString(map.get(SYSTEM_SETTING_KEYS.serperApiKey), config.SERPER_API_KEY),
  braveSearchApiKey: parseString(map.get(SYSTEM_SETTING_KEYS.braveSearchApiKey), config.BRAVE_SEARCH_API_KEY),
});

const buildImageConfig = (map: Map<string, string>, config: AppConfig): ImageConfig => ({
  openaiNative: parseNativeToolsPolicy(
    map.get(SYSTEM_SETTING_KEYS.openaiNativeImageGeneration),
    config.OPENAI_NATIVE_IMAGE_GENERATION,
  ),
  providers: parseString(map.get(SYSTEM_SETTING_KEYS.imageProviders), config.IMAGE_PROVIDERS),
  openaiImageApiKey: parseString(map.get(SYSTEM_SETTING_KEYS.openaiImageApiKey), config.OPENAI_IMAGE_API_KEY),
  openaiImageBaseUrl: parseString(map.get(SYSTEM_SETTING_KEYS.openaiImageBaseUrl), config.OPENAI_IMAGE_BASE_URL),
  openaiImageModel: parseString(map.get(SYSTEM_SETTING_KEYS.openaiImageModel), config.OPENAI_IMAGE_MODEL),
  zhipuImageApiKey: parseString(map.get(SYSTEM_SETTING_KEYS.zhipuImageApiKey), config.ZHIPU_IMAGE_API_KEY),
  zhipuImageBaseUrl: parseString(map.get(SYSTEM_SETTING_KEYS.zhipuImageBaseUrl), config.ZHIPU_IMAGE_BASE_URL),
  zhipuImageModel: parseString(map.get(SYSTEM_SETTING_KEYS.zhipuImageModel), config.ZHIPU_IMAGE_MODEL),
  dashscopeImageApiKey: parseString(
    map.get(SYSTEM_SETTING_KEYS.dashscopeImageApiKey),
    config.DASHSCOPE_IMAGE_API_KEY,
  ),
  dashscopeImageBaseUrl: parseString(
    map.get(SYSTEM_SETTING_KEYS.dashscopeImageBaseUrl),
    config.DASHSCOPE_IMAGE_BASE_URL,
  ),
  dashscopeImageModel: parseString(
    map.get(SYSTEM_SETTING_KEYS.dashscopeImageModel),
    config.DASHSCOPE_IMAGE_MODEL,
  ),
});

export class SystemSettingsService {
  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
  ) {}

  initialize() {
    const current = this.getSettings();
    this.persistDefaults(current);
    this.cleanupObsoleteSettings();
    this.applyToRuntimeConfig(this.getSettings());
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
      webSearchConfig: buildWebSearchConfig(map, this.config),
      imageConfig: buildImageConfig(map, this.config),
    };
  }

  updateSettings(
    patch: Partial<Omit<SystemSettings, 'modelConfig' | 'webSearchConfig' | 'imageConfig'>> & {
      modelConfig?: Partial<SystemSettings['modelConfig']>;
      webSearchConfig?: Partial<WebSearchConfig>;
      imageConfig?: Partial<ImageConfig>;
    },
    updatedBy: string,
  ) {
    const current = this.getSettings();
    const next: SystemSettings = {
      registrationRequiresInviteCode: patch.registrationRequiresInviteCode ?? current.registrationRequiresInviteCode,
      enableAssistantTools: patch.enableAssistantTools ?? current.enableAssistantTools,
      modelConfig: {
        ...current.modelConfig,
        ...(patch.modelConfig ?? {}),
      },
      webSearchConfig: {
        ...current.webSearchConfig,
        ...(patch.webSearchConfig ?? {}),
      },
      imageConfig: {
        ...current.imageConfig,
        ...(patch.imageConfig ?? {}),
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
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, next.modelConfig.openaiBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, next.modelConfig.openaiApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModel, next.modelConfig.openaiModel, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffort, next.modelConfig.openaiReasoningEffort, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.llmMaxOutputTokens, String(next.modelConfig.llmMaxOutputTokens), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.toolMaxOutputTokens, String(next.modelConfig.toolMaxOutputTokens), now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.webSearchMode, next.webSearchConfig.mode, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.webSearchProviders, next.webSearchConfig.providers, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiNativeWebSearch, next.webSearchConfig.openaiNative, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.tavilyApiKey, next.webSearchConfig.tavilyApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.serperApiKey, next.webSearchConfig.serperApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.braveSearchApiKey, next.webSearchConfig.braveSearchApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiNativeImageGeneration, next.imageConfig.openaiNative, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.imageProviders, next.imageConfig.providers, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageApiKey, next.imageConfig.openaiImageApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageBaseUrl, next.imageConfig.openaiImageBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageModel, next.imageConfig.openaiImageModel, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageApiKey, next.imageConfig.zhipuImageApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageBaseUrl, next.imageConfig.zhipuImageBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageModel, next.imageConfig.zhipuImageModel, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageApiKey, next.imageConfig.dashscopeImageApiKey, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageBaseUrl, next.imageConfig.dashscopeImageBaseUrl, now, updatedBy);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageModel, next.imageConfig.dashscopeImageModel, now, updatedBy);
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
      upsert.run(SYSTEM_SETTING_KEYS.openaiBaseUrl, settings.modelConfig.openaiBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.openaiApiKey, settings.modelConfig.openaiApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.openaiModel, settings.modelConfig.openaiModel);
      upsert.run(SYSTEM_SETTING_KEYS.openaiReasoningEffort, settings.modelConfig.openaiReasoningEffort);
      upsert.run(SYSTEM_SETTING_KEYS.llmMaxOutputTokens, String(settings.modelConfig.llmMaxOutputTokens));
      upsert.run(SYSTEM_SETTING_KEYS.toolMaxOutputTokens, String(settings.modelConfig.toolMaxOutputTokens));
      upsert.run(SYSTEM_SETTING_KEYS.webSearchMode, settings.webSearchConfig.mode);
      upsert.run(SYSTEM_SETTING_KEYS.webSearchProviders, settings.webSearchConfig.providers);
      upsert.run(SYSTEM_SETTING_KEYS.openaiNativeWebSearch, settings.webSearchConfig.openaiNative);
      upsert.run(SYSTEM_SETTING_KEYS.tavilyApiKey, settings.webSearchConfig.tavilyApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.serperApiKey, settings.webSearchConfig.serperApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.braveSearchApiKey, settings.webSearchConfig.braveSearchApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.openaiNativeImageGeneration, settings.imageConfig.openaiNative);
      upsert.run(SYSTEM_SETTING_KEYS.imageProviders, settings.imageConfig.providers);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageApiKey, settings.imageConfig.openaiImageApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageBaseUrl, settings.imageConfig.openaiImageBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.openaiImageModel, settings.imageConfig.openaiImageModel);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageApiKey, settings.imageConfig.zhipuImageApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageBaseUrl, settings.imageConfig.zhipuImageBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.zhipuImageModel, settings.imageConfig.zhipuImageModel);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageApiKey, settings.imageConfig.dashscopeImageApiKey);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageBaseUrl, settings.imageConfig.dashscopeImageBaseUrl);
      upsert.run(SYSTEM_SETTING_KEYS.dashscopeImageModel, settings.imageConfig.dashscopeImageModel);
    })();
  }

  private applyToRuntimeConfig(settings: SystemSettings) {
    this.config.ENABLE_ASSISTANT_TOOLS = settings.enableAssistantTools;
    this.config.OPENAI_BASE_URL = settings.modelConfig.openaiBaseUrl;
    this.config.OPENAI_API_KEY = settings.modelConfig.openaiApiKey;
    this.config.OPENAI_MODEL = settings.modelConfig.openaiModel;
    this.config.OPENAI_REASONING_EFFORT = settings.modelConfig.openaiReasoningEffort;
    this.config.LLM_MAX_OUTPUT_TOKENS = settings.modelConfig.llmMaxOutputTokens;
    this.config.TOOL_MAX_OUTPUT_TOKENS = settings.modelConfig.toolMaxOutputTokens;
    this.config.WEB_SEARCH_MODE = settings.webSearchConfig.mode;
    this.config.WEB_SEARCH_PROVIDERS = settings.webSearchConfig.providers;
    this.config.OPENAI_NATIVE_WEB_SEARCH = settings.webSearchConfig.openaiNative;
    this.config.TAVILY_API_KEY = settings.webSearchConfig.tavilyApiKey;
    this.config.SERPER_API_KEY = settings.webSearchConfig.serperApiKey;
    this.config.BRAVE_SEARCH_API_KEY = settings.webSearchConfig.braveSearchApiKey;
    this.config.OPENAI_NATIVE_IMAGE_GENERATION = settings.imageConfig.openaiNative;
    this.config.IMAGE_PROVIDERS = settings.imageConfig.providers;
    this.config.OPENAI_IMAGE_API_KEY = settings.imageConfig.openaiImageApiKey;
    this.config.OPENAI_IMAGE_BASE_URL = settings.imageConfig.openaiImageBaseUrl;
    this.config.OPENAI_IMAGE_MODEL = settings.imageConfig.openaiImageModel;
    this.config.ZHIPU_IMAGE_API_KEY = settings.imageConfig.zhipuImageApiKey;
    this.config.ZHIPU_IMAGE_BASE_URL = settings.imageConfig.zhipuImageBaseUrl;
    this.config.ZHIPU_IMAGE_MODEL = settings.imageConfig.zhipuImageModel;
    this.config.DASHSCOPE_IMAGE_API_KEY = settings.imageConfig.dashscopeImageApiKey;
    this.config.DASHSCOPE_IMAGE_BASE_URL = settings.imageConfig.dashscopeImageBaseUrl;
    this.config.DASHSCOPE_IMAGE_MODEL = settings.imageConfig.dashscopeImageModel;
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
