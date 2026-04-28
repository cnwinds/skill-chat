import { describe, expect, it } from 'vitest';
import { inferGeneratedFileVisibility } from './file-service.js';

describe('inferGeneratedFileVisibility', () => {
  it('hides common intermediate package parts', () => {
    expect(inferGeneratedFileVisibility({
      absolutePath: '/data/users/u1/sessions/s1/outputs/[Content_Types].xml',
    })).toBe('hidden');
    expect(inferGeneratedFileVisibility({
      absolutePath: '/data/users/u1/sessions/s1/outputs/word/document.xml',
    })).toBe('hidden');
    expect(inferGeneratedFileVisibility({
      absolutePath: '/data/users/u1/sessions/s1/outputs/document.xml.rels',
    })).toBe('hidden');
  });

  it('keeps ordinary deliverables visible by default', () => {
    expect(inferGeneratedFileVisibility({
      absolutePath: '/data/users/u1/sessions/s1/outputs/report.pdf',
    })).toBe('visible');
    expect(inferGeneratedFileVisibility({
      absolutePath: 'C:/Users/admin/AppData/Local/Temp/users/u1/sessions/s1/outputs/report.md',
    })).toBe('visible');
    expect(inferGeneratedFileVisibility({
      absolutePath: '/data/users/u1/sessions/s1/outputs/final.xml',
    })).toBe('visible');
  });
});
