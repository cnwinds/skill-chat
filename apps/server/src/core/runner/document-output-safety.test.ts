import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');

describe('Official document skills', () => {
  it('remove the legacy run.py compatibility wrappers', async () => {
    await expect(fs.access(path.join(repoRoot, 'skills', 'docx', 'scripts', 'run.py'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(repoRoot, 'skills', 'pdf', 'scripts', 'run.py'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(repoRoot, 'skills', 'xlsx', 'scripts', 'run.py'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps SKILL.md content aligned to the official skills without local compatibility appendices', async () => {
    const docxSkill = await fs.readFile(path.join(repoRoot, 'skills', 'docx', 'SKILL.md'), 'utf8');
    const pdfSkill = await fs.readFile(path.join(repoRoot, 'skills', 'pdf', 'SKILL.md'), 'utf8');
    const xlsxSkill = await fs.readFile(path.join(repoRoot, 'skills', 'xlsx', 'SKILL.md'), 'utf8');

    for (const content of [docxSkill, pdfSkill, xlsxSkill]) {
      expect(content).not.toContain('SkillChat Compatibility');
      expect(content).not.toContain('scripts/run.py');
    }
  });
});
