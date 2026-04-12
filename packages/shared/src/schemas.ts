import { z } from 'zod';
import { FILE_BUCKETS, FILE_SOURCES, MESSAGE_KINDS, SSE_EVENT_NAMES } from './constants.js';

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
  defaultSessionActiveSkills: z.array(z.string().trim().min(1)).max(16).optional(),
  enableAssistantTools: z.boolean().optional(),
  webOrigin: z.string().url().optional(),
  modelConfig: z.object({
    openaiModelRouter: z.string().min(1).optional(),
    openaiModelPlanner: z.string().min(1).optional(),
    openaiModelReply: z.string().min(1).optional(),
    openaiReasoningEffortReply: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
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
});

export const fileBucketSchema = z.enum(FILE_BUCKETS);
export const fileSourceSchema = z.enum(FILE_SOURCES);
export const messageKindSchema = z.enum(MESSAGE_KINDS);
export const sseEventSchema = z.enum(SSE_EVENT_NAMES);
