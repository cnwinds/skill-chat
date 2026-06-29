import { describe, expect, it } from 'vitest';
import { SSE_EVENT_NAMES } from '@harnesskit/protocol';
import { SSE_EVENT_NAMES as SkillChatSSE } from '@skillchat/shared';

describe('harness-kit protocol alignment', () => {
  it('SSE event names match between harness-kit and skill-chat shared', () => {
    expect([...SkillChatSSE]).toEqual([...SSE_EVENT_NAMES]);
  });
});
