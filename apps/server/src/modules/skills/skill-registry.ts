import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { SkillMetadata } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';

export interface RegisteredSkill extends SkillMetadata {
  directory: string;
  rawMarkdown?: string;
  markdown: string;
}

const toMetadata = (
  filename: string,
  frontmatter: Record<string, unknown>,
): SkillMetadata => {
  return {
    name: String(frontmatter.name ?? filename),
    description: String(frontmatter.description ?? ''),
    starterPrompts: Array.isArray(frontmatter.starter_prompts)
      ? frontmatter.starter_prompts
        .map((item) => String(item).trim())
        .filter(Boolean)
      : [],
  };
};

export class SkillRegistry {
  private readonly skillMap = new Map<string, RegisteredSkill>();

  constructor(private readonly config: AppConfig) {}

  async load() {
    this.skillMap.clear();
    const entries = await fs.readdir(this.config.SKILLS_ROOT, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = path.join(this.config.SKILLS_ROOT, entry.name);
      const skillFile = path.join(skillDir, 'SKILL.md');

      try {
        const raw = await fs.readFile(skillFile, 'utf8');
        const parsed = matter(raw);
        const metadata = toMetadata(entry.name, parsed.data);

        this.skillMap.set(metadata.name, {
          ...metadata,
          directory: skillDir,
          rawMarkdown: raw.trim(),
          markdown: parsed.content.trim(),
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          continue;
        }
        console.warn(`Skipping invalid skill at ${skillFile}:`, error);
        continue;
      }
    }
  }

  list(): SkillMetadata[] {
    return Array.from(this.skillMap.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      starterPrompts: [...(skill.starterPrompts ?? [])],
    }));
  }

  listRegistered(): RegisteredSkill[] {
    return Array.from(this.skillMap.values());
  }

  get(name: string): RegisteredSkill {
    const skill = this.skillMap.get(name);
    if (!skill) {
      throw new Error(`Unknown skill: ${name}`);
    }
    return skill;
  }
}
