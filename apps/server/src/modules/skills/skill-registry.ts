import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { parseSkillManifest } from '@qizhi/skill-spec';
import type { SkillManifest } from '@qizhi/skill-spec';
import type { SkillMetadata } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';

export interface RegisteredSkill extends SkillMetadata {
  directory: string;
  id?: string;
  version?: string;
  manifest?: SkillManifest;
  source?: 'legacy' | 'installed';
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
    await this.loadLegacyRoot();
    await this.loadInstalledRoot();
  }

  private async loadLegacyRoot() {
    const entries = await this.readRootEntries(this.config.SKILLS_ROOT);

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
          source: 'legacy',
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

  private async loadInstalledRoot() {
    const publishers = await this.readRootEntries(this.config.INSTALLED_SKILLS_ROOT);

    for (const publisher of publishers) {
      if (!publisher.isDirectory()) {
        continue;
      }
      const publisherDir = path.join(this.config.INSTALLED_SKILLS_ROOT, publisher.name);
      const skills = await this.readRootEntries(publisherDir);

      for (const skill of skills) {
        if (!skill.isDirectory()) {
          continue;
        }
        const skillDir = path.join(publisherDir, skill.name);
        const versions = await this.readRootEntries(skillDir);

        for (const version of versions) {
          if (!version.isDirectory()) {
            continue;
          }
          const versionDir = path.join(skillDir, version.name);
          await this.loadInstalledSkill(versionDir);
        }
      }
    }
  }

  private async loadInstalledSkill(skillDir: string) {
    const skillFile = path.join(skillDir, 'SKILL.md');
    const manifestFile = path.join(skillDir, 'skill.json');

    try {
      const [raw, manifestRaw] = await Promise.all([
        fs.readFile(skillFile, 'utf8'),
        fs.readFile(manifestFile, 'utf8'),
      ]);
      const manifest = parseSkillManifest(JSON.parse(manifestRaw));
      const parsed = matter(raw);
      const name = manifest.id;

      this.skillMap.set(name, {
        name,
        id: manifest.id,
        version: manifest.version,
        manifest,
        description: manifest.description,
        starterPrompts: [...manifest.starterPrompts],
        directory: skillDir,
        source: 'installed',
        rawMarkdown: raw.trim(),
        markdown: parsed.content.trim(),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      console.warn(`Skipping invalid installed skill at ${skillDir}:`, error);
    }
  }

  private async readRootEntries(root: string) {
    try {
      return await fs.readdir(root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
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
