export const APP_NAME = 'SkillChat';

export const DEFAULT_SESSION_TITLE = '新会话';

export const SSE_EVENT_NAMES = [
  'text_delta',
  'reasoning_delta',
  'token_count',
  'thinking',
  'tool_start',
  'tool_progress',
  'tool_result',
  'file_ready',
  'turn_started',
  'turn_status',
  'assistant_message_committed',
  'user_message_committed',
  'turn_completed',
  'done',
  'error',
] as const;

export const FILE_BUCKETS = ['uploads', 'outputs', 'shared'] as const;

export const FILE_SOURCES = ['upload', 'generated', 'shared'] as const;

export const MESSAGE_KINDS = [
  'message',
  'thinking',
  'tool_call',
  'tool_progress',
  'tool_result',
  'image',
  'file',
  'error',
] as const;
