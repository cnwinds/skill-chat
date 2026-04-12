import type { FILE_BUCKETS, FILE_SOURCES, MESSAGE_KINDS, SSE_EVENT_NAMES } from './constants.js';

export type FileBucket = (typeof FILE_BUCKETS)[number];
export type FileSource = (typeof FILE_SOURCES)[number];
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export type SSEEventName = (typeof SSE_EVENT_NAMES)[number];

export type MessageRole = 'user' | 'assistant' | 'system';

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
  defaultSessionActiveSkills: string[];
  enableAssistantTools: boolean;
  webOrigin: string;
  modelConfig: {
    openaiModelRouter: string;
    openaiModelPlanner: string;
    openaiModelReply: string;
    openaiReasoningEffortReply: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
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
  entrypoint: string;
  runtime: 'python' | 'node' | 'chat';
  timeoutSec: number;
  references: string[];
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

export interface TextMessageEvent extends StoredEventBase {
  kind: 'message';
  role: MessageRole;
  type: 'text';
  content: string;
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

export interface RouterDecision {
  mode: 'chat' | 'skill';
  needClarification: boolean;
  selectedSkills: string[];
  reason: string;
}

export interface ToolCall {
  skill: string;
  action: 'run';
  arguments: Record<string, unknown>;
}

export interface PlannerResult {
  assistantMessage: string;
  toolCalls: ToolCall[];
}

export interface SessionFileContext {
  id: string;
  name: string;
  mimeType: string | null;
  size: number;
  bucket: FileBucket;
  relativePath: string;
}
