import type { PlannerResult, RouterDecision, SessionFileContext, SkillMetadata, StoredEvent } from '@skillchat/shared';
import type { RegisteredSkill } from '../../modules/skills/skill-registry.js';

export interface ClassifyInput {
  message: string;
  skills: SkillMetadata[];
  files: SessionFileContext[];
  history: StoredEvent[];
}

export interface PlanInput {
  message: string;
  skill: RegisteredSkill;
  files: SessionFileContext[];
}

export interface AssistantToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface PlannedAssistantToolCall {
  tool: string;
  arguments: Record<string, unknown>;
}

export interface ToolPlanningInput {
  message: string;
  history: StoredEvent[];
  files: SessionFileContext[];
  tools: AssistantToolDefinition[];
  skill?: RegisteredSkill;
}

export interface ToolPlanningResult {
  toolCalls: PlannedAssistantToolCall[];
}

export interface ReplyInput {
  message: string;
  history: StoredEvent[];
  context?: string;
}

export interface SkillReplyInput {
  message: string;
  history: StoredEvent[];
  files: SessionFileContext[];
  skill: RegisteredSkill;
  context?: string;
}

export interface ChatModelClient {
  classify(input: ClassifyInput): Promise<RouterDecision>;
  plan(input: PlanInput): Promise<PlannerResult>;
  planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult>;
  replyStream(input: ReplyInput): AsyncIterable<string>;
  skillReplyStream(input: SkillReplyInput): AsyncIterable<string>;
}
