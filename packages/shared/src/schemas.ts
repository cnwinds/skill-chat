import { z } from 'zod';
import { FILE_BUCKETS, FILE_SOURCES, FILE_VISIBILITIES, MESSAGE_KINDS, SSE_EVENT_NAMES } from './constants.js';

export const registerSchema = z.object({
  username: z.string()
    .trim()
    .min(3, '用户名至少需要 3 个字符')
    .max(32, '用户名不能超过 32 个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名只能包含字母、数字、下划线或短横线'),
  password: z.string()
    .min(8, '密码至少需要 8 个字符')
    .max(128, '密码不能超过 128 个字符'),
  inviteCode: z.string()
    .trim()
    .min(4, '请输入有效的邀请码')
    .max(64, '邀请码长度不合法'),
});

export const registerRequestSchema = z.object({
  username: z.string()
    .trim()
    .min(3, '用户名至少需要 3 个字符')
    .max(32, '用户名不能超过 32 个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名只能包含字母、数字、下划线或短横线'),
  password: z.string()
    .min(8, '密码至少需要 8 个字符')
    .max(128, '密码不能超过 128 个字符'),
  inviteCode: z.string()
    .trim()
    .min(4, '请输入有效的邀请码')
    .max(64, '邀请码长度不合法')
    .optional(),
});

export const bootstrapAdminSchema = z.object({
  username: z.string()
    .trim()
    .min(3, '用户名至少需要 3 个字符')
    .max(32, '用户名不能超过 32 个字符')
    .regex(/^[a-zA-Z0-9_-]+$/, '用户名只能包含字母、数字、下划线或短横线'),
  password: z.string()
    .min(8, '密码至少需要 8 个字符')
    .max(128, '密码不能超过 128 个字符'),
});

export const loginSchema = z.object({
  username: z.string()
    .trim()
    .min(3, '请输入正确的用户名')
    .max(32, '请输入正确的用户名'),
  password: z.string()
    .min(8, '密码至少需要 8 个字符')
    .max(128, '密码不能超过 128 个字符'),
});

export const adminUserUpdateSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).refine((value) => typeof value.role !== 'undefined' || typeof value.status !== 'undefined', {
  message: '至少需要更新一个字段',
});

export const adminInviteCreateSchema = z.object({
  count: z.coerce.number().int().min(1, '至少创建 1 个邀请码').max(100, '单次最多创建 100 个邀请码').default(1),
});

export const systemSettingsPatchSchema = z.object({
  registrationRequiresInviteCode: z.boolean().optional(),
  enableAssistantTools: z.boolean().optional(),
  modelConfig: z.object({
    openaiBaseUrl: z.string().url().optional(),
    openaiApiKey: z.string().optional(),
    openaiModel: z.string().min(1).optional(),
    openaiReasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    llmMaxOutputTokens: z.number().int().positive().optional(),
    toolMaxOutputTokens: z.number().int().positive().optional(),
  }).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: '至少需要更新一个字段',
});

export const userPreferenceSettingsSchema = z.object({
  themeMode: z.enum(['light', 'dark']),
});

export const createSessionSchema = z.object({
  title: z.string()
    .trim()
    .min(1, '会话标题不能为空')
    .max(80, '会话标题不能超过 80 个字符')
    .optional(),
  activeSkills: z.array(z.string().trim().min(1, 'skill 名称不能为空'))
    .max(16, '单个会话最多激活 16 个 skill')
    .optional(),
});

export const updateSessionSchema = z.object({
  title: z.string()
    .trim()
    .min(1, '会话标题不能为空')
    .max(80, '会话标题不能超过 80 个字符')
    .optional(),
  activeSkills: z.array(z.string().trim().min(1, 'skill 名称不能为空'))
    .max(16, '单个会话最多激活 16 个 skill')
    .optional(),
}).refine((value) => typeof value.title !== 'undefined' || typeof value.activeSkills !== 'undefined', {
  message: '至少需要更新一个字段',
});

export const createMessageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, '消息内容不能为空')
    .max(20_000, '消息内容过长，请精简后再发送'),
  attachmentIds: z.array(z.string().trim().min(1, 'attachmentId 不能为空'))
    .max(16, '单条消息最多附带 16 个附件')
    .optional(),
  dispatch: z.enum(['auto', 'new_turn', 'steer', 'queue_next']).optional(),
  turnId: z.string().trim().min(1, 'turnId 不能为空').optional(),
  kind: z.enum(['regular', 'review', 'compact', 'maintenance']).optional(),
  turnConfig: z.object({
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    webSearchMode: z.enum(['disabled', 'cached', 'live']).optional(),
  }).optional(),
});

export const steerMessageSchema = z.object({
  content: z.string()
    .trim()
    .min(1, '消息内容不能为空')
    .max(20_000, '消息内容过长，请精简后再发送'),
});

export const turnParamsSchema = z.object({
  turnId: z.string().trim().min(1, 'turnId 不能为空'),
});

export const fileBucketSchema = z.enum(FILE_BUCKETS);
export const fileSourceSchema = z.enum(FILE_SOURCES);
export const fileVisibilitySchema = z.enum(FILE_VISIBILITIES);
export const messageKindSchema = z.enum(MESSAGE_KINDS);
export const sseEventSchema = z.enum(SSE_EVENT_NAMES);
export const turnKindSchema = z.enum(['regular', 'review', 'compact', 'maintenance']);
export const turnStatusSchema = z.enum(['running', 'interrupting', 'completed', 'failed', 'interrupted']);
export const turnPhaseSchema = z.enum([
  'sampling',
  'tool_call',
  'waiting_tool_result',
  'streaming_assistant',
  'finalizing',
  'non_steerable',
]);
export const runtimeInputPreviewSchema = z.object({
  inputId: z.string().trim().min(1),
  content: z.string(),
  createdAt: z.string(),
});
export const sessionRuntimeRecoverySchema = z.object({
  recoveredAt: z.string(),
  previousTurnId: z.string().trim().min(1),
  previousTurnKind: turnKindSchema,
  reason: z.literal('process_restarted'),
});
export const sessionRuntimeSnapshotSchema = z.object({
  sessionId: z.string().trim().min(1),
  activeTurn: z.object({
    turnId: z.string().trim().min(1),
    kind: turnKindSchema,
    status: turnStatusSchema,
    phase: turnPhaseSchema,
    phaseStartedAt: z.string(),
    canSteer: z.boolean(),
    startedAt: z.string(),
    round: z.number().int().nonnegative(),
  }).nullable(),
  followUpQueue: z.array(runtimeInputPreviewSchema),
  recovery: sessionRuntimeRecoverySchema.nullable(),
});
