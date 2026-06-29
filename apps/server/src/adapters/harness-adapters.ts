import type { SkillDescriptor } from '@skillchat/harness-core';
import type { SkillRegistryLike } from '@skillchat/harness-server';
import type { SkillRegistry } from '../modules/skills/skill-registry.js';

const toSkillDescriptor = (skill: ReturnType<SkillRegistry['get']>): SkillDescriptor => ({
  id: skill.id ?? skill.name,
  name: skill.name,
  description: skill.description,
  directory: skill.directory,
  source: skill.source ?? 'legacy',
  version: skill.version,
  manifest: skill.manifest as Record<string, unknown> | undefined,
});

export const toSkillRegistryLike = (registry: SkillRegistry): SkillRegistryLike => ({
  get: (name) => toSkillDescriptor(registry.get(name)),
});
