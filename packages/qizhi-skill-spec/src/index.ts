import { z } from 'zod';

export const SKILL_SPEC_VERSION = '1.0';

export const skillIdSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9-]{1,63}\/[a-z0-9][a-z0-9-]{1,63}$/, 'skill id must be publisher/name');

export const skillNameSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'skill name must be a lowercase slug');

export const semverSchema = z.string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/, 'version must be semver');

export const skillKindSchema = z.enum(['instruction', 'runtime', 'hybrid']);

export const filesystemPermissionSchema = z.enum([
  'session:read',
  'uploads:read',
  'outputs:read',
  'outputs:write',
  'shared:read',
  'tmp:write',
]);

export const skillPermissionsSchema = z.object({
  filesystem: z.array(filesystemPermissionSchema).default([]),
  network: z.union([
    z.boolean(),
    z.object({
      allowedHosts: z.array(z.string().min(1)).default([]),
    }),
  ]).default(false),
  scripts: z.boolean().default(false),
  secrets: z.array(z.string().min(1)).default([]),
});

export const skillRuntimeEntrypointSchema = z.object({
  name: z.string().min(1).default('main'),
  path: z.string().min(1),
  description: z.string().optional(),
});

export const skillRuntimeSchema = z.object({
  type: z.enum(['none', 'python', 'node', 'shell']).default('none'),
  entrypoints: z.array(skillRuntimeEntrypointSchema).default([]),
});

export const skillAuthorSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  email: z.string().email().optional(),
});

export const skillCompatibilitySchema = z.object({
  skillchat: z.string().min(1).default('>=0.2.0'),
});

export const skillManifestSchema = z.object({
  skillSpecVersion: z.literal(SKILL_SPEC_VERSION).default(SKILL_SPEC_VERSION),
  id: skillIdSchema,
  name: skillNameSchema,
  displayName: z.string().min(1).max(80).optional(),
  version: semverSchema,
  kind: skillKindSchema,
  description: z.string().min(1).max(500),
  author: skillAuthorSchema,
  license: z.string().min(1).optional(),
  homepage: z.string().url().optional(),
  repository: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  categories: z.array(z.string().min(1).max(40)).max(10).default([]),
  compatibility: skillCompatibilitySchema.default({ skillchat: '>=0.2.0' }),
  permissions: skillPermissionsSchema.default({
    filesystem: [],
    network: false,
    scripts: false,
    secrets: [],
  }),
  runtime: skillRuntimeSchema.default({
    type: 'none',
    entrypoints: [],
  }),
  starterPrompts: z.array(z.string().min(1).max(300)).max(12).default([]),
  assets: z.object({
    icon: z.string().optional(),
    screenshots: z.array(z.string()).max(8).default([]),
  }).default({
    screenshots: [],
  }),
});

export const marketSkillSummarySchema = z.object({
  id: skillIdSchema,
  name: skillNameSchema,
  displayName: z.string().optional(),
  latestVersion: semverSchema,
  kind: skillKindSchema,
  description: z.string(),
  author: skillAuthorSchema,
  tags: z.array(z.string()).default([]),
  categories: z.array(z.string()).default([]),
  updatedAt: z.string(),
});

export const marketSkillVersionSchema = z.object({
  id: skillIdSchema,
  version: semverSchema,
  manifest: skillManifestSchema,
  packageUrl: z.string(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  publishedAt: z.string(),
});

export const marketSkillDetailSchema = marketSkillSummarySchema.extend({
  versions: z.array(marketSkillVersionSchema),
});

export const marketSkillListResponseSchema = z.object({
  skills: z.array(marketSkillSummarySchema),
});

export const marketSkillVersionsResponseSchema = z.object({
  versions: z.array(marketSkillVersionSchema),
});

export const installSkillRequestSchema = z.object({
  marketBaseUrl: z.string().url(),
  id: skillIdSchema,
  version: semverSchema.optional(),
});

export const installedSkillRecordSchema = z.object({
  id: skillIdSchema,
  version: semverSchema,
  manifest: skillManifestSchema,
  installPath: z.string(),
  sourceMarketUrl: z.string().url(),
  status: z.enum(['installed', 'disabled', 'failed']),
  installedAt: z.string(),
  updatedAt: z.string(),
});

export type SkillId = z.infer<typeof skillIdSchema>;
export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillKind = z.infer<typeof skillKindSchema>;
export type SkillPermissions = z.infer<typeof skillPermissionsSchema>;
export type MarketSkillSummary = z.infer<typeof marketSkillSummarySchema>;
export type MarketSkillVersion = z.infer<typeof marketSkillVersionSchema>;
export type MarketSkillDetail = z.infer<typeof marketSkillDetailSchema>;
export type MarketSkillListResponse = z.infer<typeof marketSkillListResponseSchema>;
export type MarketSkillVersionsResponse = z.infer<typeof marketSkillVersionsResponseSchema>;
export type InstallSkillRequest = z.infer<typeof installSkillRequestSchema>;
export type InstalledSkillRecord = z.infer<typeof installedSkillRecordSchema>;

export const parseSkillManifest = (input: unknown): SkillManifest =>
  skillManifestSchema.parse(input);

export const splitSkillId = (id: SkillId) => {
  const [publisher, name] = id.split('/') as [string, string];
  return { publisher, name };
};

export const formatSkillRef = (id: SkillId, version: string) => `${id}@${version}`;
