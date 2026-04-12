import type { PlannerResult, RouterDecision } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { createModelClient } from './create-model-client.js';
import type {
  ChatModelClient,
  ClassifyInput,
  PlanInput,
  ReplyInput,
  SkillReplyInput,
  ToolPlanningInput,
  ToolPlanningResult,
} from './model-client.js';

export class DynamicModelClient implements ChatModelClient {
  constructor(private readonly config: AppConfig) {}

  private resolveClient(): ChatModelClient {
    return createModelClient(this.config);
  }

  classify(input: ClassifyInput): Promise<RouterDecision> {
    return this.resolveClient().classify(input);
  }

  plan(input: PlanInput): Promise<PlannerResult> {
    return this.resolveClient().plan(input);
  }

  planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult> {
    return this.resolveClient().planToolUse(input);
  }

  replyStream(input: ReplyInput): AsyncIterable<string> {
    return this.resolveClient().replyStream(input);
  }

  skillReplyStream(input: SkillReplyInput): AsyncIterable<string> {
    return this.resolveClient().skillReplyStream(input);
  }
}
