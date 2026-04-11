import type { AppConfig } from '../../config/env.js';
import type { ChatModelClient } from './model-client.js';
import { AnthropicModelClient } from './anthropic-client.js';
import { OpenAIModelClient } from './openai-client.js';
import { RuleBasedModelClient } from './rule-based-client.js';

export const createModelClient = (config: AppConfig): ChatModelClient => {
  if (config.OPENAI_API_KEY) {
    return new OpenAIModelClient(config);
  }

  if (config.ANTHROPIC_API_KEY || config.ANTHROPIC_AUTH_TOKEN) {
    return new AnthropicModelClient(config);
  }

  return new RuleBasedModelClient();
};
