import type { FILE_BUCKETS, FILE_SOURCES, MESSAGE_KINDS, SSE_EVENT_NAMES } from './constants.js';

export type FileBucket = (typeof FILE_BUCKETS)[number];
export type FileSource = (typeof FILE_SOURCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type SSEEventName = (typeof SSE_EVENT_NAMES)[number];

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageDispatchMode = 'auto' | 'new_turn' | 'steer' | 'queue_next';
export type MessageDispatchResult = 'turn_started' | 'steer_accepted' | 'queued';
export type TurnKind = 'regular' | 'review' | 'compact' | 'maintenance';
export type TurnStatus = 'running' | 'interrupting' | 'completed' | 'failed' | 'interrupted';
export type TurnPhase =
  | 'sampling'
  | 'tool_call'
  | 'waiting_tool_result'
  | 'streaming_assistant'
  | 'finalizing'
  | 'non_steerable';

export interface UserSummary {
  id: string;
  username: string;
  role: 'admin' | 'member';
  status?: 'active' | 'disabled';
}

export interface AuthResponse {
  user: UserSummary;
  token: string;
}

export interface SystemStatus {
  initialized: boolean;
  hasAdmin: boolean;
  registrationRequiresInviteCode: boolean;
}

export interface SystemSettings {
  registrationRequiresInviteCode: boolean;
  enableAssistantTools: boolean;
  webOrigin: string;
  modelConfig: {
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    openaiReasoningEffort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
    llmMaxOutputTokens: number;
    toolMaxOutputTokens: number;
  };
}

export interface UserPreferenceSettings {
  themeMode: 'light' | 'dark';
}

export interface AdminUserSummary extends UserSummary {
  status: 'active' | 'disabled';
  createdAt: string;
}

export interface InviteCodeSummary {
  code: string;
  createdBy: string | null;
  usedBy: string | null;
  usedAt: string | null;
  createdAt: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  activeSkills: string[];
}

export interface SkillMetadata {
  name: string;
  description: string;
  starterPrompts?: string[];
}

export interface FileRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  displayName: string;
  relativePath: string;
  mimeType: string | null;
  size: number;
  bucket: FileBucket;
  source: FileSource;
  createdAt: string;
  downloadUrl?: string;
}

export interface StoredEventBase {
  id: string;
  sessionId: string;
  kind: MessageKind;
  createdAt: string;
}

export interface TokenUsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AssistantMessageMeta {
  turnId?: string;
  durationMs?: number;
  tokenUsage?: TokenUsageStats;
  reasoningSummary?: string;
}

export interface TextMessageEvent extends StoredEventBase {
  kind: 'message';
  role: MessageRole;
  type: 'text';
  content: string;
  meta?: AssistantMessageMeta;
}

export interface ThinkingEvent extends StoredEventBase {
  kind: 'thinking';
  content: string;
}

export interface ToolCallEvent extends StoredEventBase {
  kind: 'tool_call';
  callId?: string;
  skill: string;
  arguments: Record<string, unknown>;
  hidden?: boolean;
  meta?: Record<string, unknown>;
}

export interface ToolProgressEvent extends StoredEventBase {
  kind: 'tool_progress';
  callId?: string;
  skill: string;
  message: string;
  percent?: number;
  status?: string;
  hidden?: boolean;
  meta?: Record<string, unknown>;
}

export interface ToolResultEvent extends StoredEventBase {
  kind: 'tool_result';
  callId?: string;
  skill: string;
  message: string;
  content?: string;
  hidden?: boolean;
  meta?: Record<string, unknown>;
}

export interface FileEvent extends StoredEventBase {
  kind: 'file';
  file: FileRecord;
}

export interface ErrorEvent extends StoredEventBase {
  kind: 'error';
  message: string;
}

export type StoredEvent =
  | TextMessageEvent
  | ThinkingEvent
  | ToolCallEvent
  | ToolProgressEvent
  | ToolResultEvent
  | FileEvent
  | ErrorEvent;

export interface SSEvent<T = unknown> {
  id: string;
  event: SSEEventName;
  data: T;
}

export interface SessionFileContext {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  bucket: FileBucket;
  relativePath: string;
}

export interface RuntimeInputPreview {
  inputId: string;
  content: string;
  createdAt: string;
}

export interface ActiveTurnRuntime {
  turnId: string;
  kind: TurnKind;
  status: TurnStatus;
  phase: TurnPhase;
  phaseStartedAt: string;
  canSteer: boolean;
  startedAt: string;
  round: number;
}

export interface SessionRuntimeRecovery {
  recoveredAt: string;
  previousTurnId: string;
  previousTurnKind: TurnKind;
  reason: 'process_restarted';
}

export interface SessionRuntimeSnapshot {
  sessionId: string;
  activeTurn: ActiveTurnRuntime | null;
  followUpQueue: RuntimeInputPreview[];
  recovery: SessionRuntimeRecovery | null;
}

export interface TurnConfig {
  model?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  maxOutputTokens?: number;
  webSearchMode?: 'disabled' | 'cached' | 'live';
}

export interface MessageDispatchRequest {
  content: string;
  dispatch?: MessageDispatchMode;
  turnId?: string;
  kind?: TurnKind;
  turnConfig?: TurnConfig;
}

export interface MessageDispatchResponse {
  accepted: boolean;
  dispatch: MessageDispatchResult;
  messageId: string;
  runId: string;
  turnId?: string;
  inputId: string;
  runtime: SessionRuntimeSnapshot;
}

export interface TurnInterruptResponse {
  accepted: boolean;
  turnId: string;
  runtime: SessionRuntimeSnapshot;
}

export interface FollowUpQueueMutationResponse {
  accepted: boolean;
  inputId: string;
  runtime: SessionRuntimeSnapshot;
}

export interface TurnLifecyclePayload {
  turnId: string;
  kind: TurnKind;
  status: TurnStatus;
  phase: TurnPhase;
  phaseStartedAt: string;
  canSteer: boolean;
  startedAt?: string;
  round: number;
  followUpQueueCount: number;
}

export interface UserMessageCommittedPayload {
  turnId: string;
  inputId: string;
  content: string;
  createdAt: string;
  consumedInputIds?: string[];
}

export interface ReasoningDeltaPayload {
  content: string;
  summaryIndex?: number;
}

export interface TokenCountPayload {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;
  cumulativeTotalTokens?: number;
}

export interface TurnCompletedPayload {
  turnId: string;
  kind: TurnKind;
  status: TurnStatus;
}
