import { describe, expect, it } from 'vitest';
import { RuleBasedModelClient } from './rule-based-client.js';

describe('RuleBasedModelClient', () => {
  const client = new RuleBasedModelClient();

  it('routes PDF-style requests to the pdf skill', async () => {
    const result = await client.classify({
      message: '帮我生成一份本周销售报告 PDF',
      history: [],
      files: [],
      skills: [],
    });

    expect(result.mode).toBe('skill');
    expect(result.selectedSkills).toEqual(['pdf']);
  });

  it('returns a friendly plain-text reply for greeting messages', async () => {
    const chunks: string[] = [];
    for await (const chunk of client.replyStream({
      message: '你好',
      history: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('你好');
  });

  it('does not echo raw tool context in fallback replies', async () => {
    const chunks: string[] = [];
    const context = [
      '以下内容仅供内部参考，用于形成结论。',
      '搜索关键词组合：',
      '1. 计算机专业 就业 最新',
      '搜索命中结果（去重后 1 条）：',
      '1. Example News',
      '结果页分析:',
      '正文：原始网页内容不应该直接出现在回复里。',
    ].join('\n');

    for await (const chunk of client.replyStream({
      message: '计算机专业就业怎么样',
      history: [],
      context,
    })) {
      chunks.push(chunk);
    }

    const reply = chunks.join('');
    expect(reply).not.toContain('搜索关键词组合');
    expect(reply).not.toContain('原始网页内容不应该直接出现在回复里');
    expect(reply).toContain('不再直接铺原始网页内容');
  });

  it('routes and replies for zhangxuefeng perspective requests', async () => {
    const decision = await client.classify({
      message: '用张雪峰的视角帮我分析金融专业',
      history: [],
      files: [],
      skills: [],
    });

    expect(decision.selectedSkills).toEqual(['zhangxuefeng-perspective']);

    const chunks: string[] = [];
    for await (const chunk of client.skillReplyStream({
      message: '用张雪峰的视角帮我分析金融专业',
      history: [],
      files: [],
      skill: {
        name: 'zhangxuefeng-perspective',
        description: 'test',
        entrypoint: '',
        runtime: 'chat',
        timeoutSec: 120,
        references: [],
        directory: '',
        markdown: '',
        referencesContent: [],
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('我跟你说');
  });
});
