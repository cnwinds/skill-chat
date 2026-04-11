import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat-service.js';
import type { ExecutedAssistantToolResult } from '../tools/assistant-tool-service.js';

const createDeferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve,
    reject,
  };
};

const flushAsync = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createToolResult = (tool: string, content: string): ExecutedAssistantToolResult => ({
  tool,
  arguments: {},
  summary: `${tool} done`,
  content,
});

describe('ChatService assistant tool orchestration', () => {
  it('runs consecutive web tools in parallel while preserving context order', async () => {
    const searchDeferred = createDeferred<ExecutedAssistantToolResult>();
    const fetchDeferred = createDeferred<ExecutedAssistantToolResult>();
    let capturedReplyInput: { context?: string } | undefined;
    const execute = vi.fn(({ call }: { call: { tool: string } }) => {
      if (call.tool === 'web_search') {
        return searchDeferred.promise;
      }
      return fetchDeferred.promise;
    });
    const replyStream = vi.fn(async function* (input: { context?: string }) {
      capturedReplyInput = input;
      yield '完成';
    });

    const service = new ChatService(
      {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'chat',
          needClarification: false,
          selectedSkills: [],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({
          toolCalls: [
            { tool: 'web_search', arguments: { query: '金融专业就业' } },
            { tool: 'web_fetch', arguments: { url: 'https://openai.com' } },
          ],
        }),
        replyStream,
        skillReplyStream: vi.fn(),
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn(),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    const task = service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '搜索并访问网页',
    );

    await flushAsync();
    expect(execute).toHaveBeenCalledTimes(2);

    fetchDeferred.resolve(createToolResult('web_fetch', 'fetch content'));
    searchDeferred.resolve(createToolResult('web_search', 'search content'));
    await task;

    expect(capturedReplyInput?.context).toContain('工具 1: web_search');
    expect(capturedReplyInput?.context).toContain('search content');
    expect(capturedReplyInput?.context).toContain('工具 2: web_fetch');
    expect(capturedReplyInput?.context).toContain('fetch content');
  });

  it('keeps non-web tools serial to avoid mixing local file operations', async () => {
    const readDeferred = createDeferred<ExecutedAssistantToolResult>();
    const searchDeferred = createDeferred<ExecutedAssistantToolResult>();
    const execute = vi.fn(({ call }: { call: { tool: string } }) => {
      if (call.tool === 'read_file') {
        return readDeferred.promise;
      }
      return searchDeferred.promise;
    });

    const service = new ChatService(
      {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'chat',
          needClarification: false,
          selectedSkills: [],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({
          toolCalls: [
            { tool: 'read_file', arguments: { fileId: 'f1' } },
            { tool: 'web_search', arguments: { query: '金融专业就业' } },
          ],
        }),
        replyStream: async function* () {
          yield '完成';
        },
        skillReplyStream: vi.fn(),
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn(),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    const task = service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '先读文件再搜索',
    );

    await flushAsync();
    expect(execute).toHaveBeenCalledTimes(1);

    readDeferred.resolve(createToolResult('read_file', 'file content'));
    await flushAsync();
    expect(execute).toHaveBeenCalledTimes(2);

    searchDeferred.resolve(createToolResult('web_search', 'search content'));
    await task;
  });

  it('emits debug tool cards when loading skill and reference files', async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const service = new ChatService(
      {
        appendEvent,
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'skill',
          needClarification: false,
          selectedSkills: ['zhangxuefeng-perspective'],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({ toolCalls: [] }),
        replyStream: vi.fn(),
        skillReplyStream: async function* () {
          yield '完成';
        },
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          name: 'zhangxuefeng-perspective',
          description: 'desc',
          entrypoint: '',
          runtime: 'chat',
          timeoutSec: 120,
          references: ['jobs.md'],
          directory: '/tmp/skills/zhangxuefeng-perspective',
          markdown: '# skill markdown',
          referencesContent: [
            {
              name: 'jobs.md',
              content: 'reference body',
            },
          ],
        }),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(false),
        list: vi.fn().mockReturnValue([]),
        execute: vi.fn(),
      } as never,
      true,
    );

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '用张雪峰视角回答',
    );

    const toolCallEvents = appendEvent.mock.calls
      .map((call) => call[2])
      .filter((event) => event?.kind === 'tool_call');
    const toolResultEvents = appendEvent.mock.calls
      .map((call) => call[2])
      .filter((event) => event?.kind === 'tool_result');

    expect(toolCallEvents.some((event) => event.skill === 'read_skill_file')).toBe(true);
    expect(toolCallEvents.some((event) => event.skill === 'read_reference_file')).toBe(true);
    expect(toolResultEvents.some((event) => event.skill === 'read_skill_file' && event.content?.includes('# skill markdown'))).toBe(true);
    expect(toolResultEvents.some((event) => event.skill === 'read_reference_file' && event.content?.includes('reference body'))).toBe(true);
  });

  it('passes the active skill into assistant tool execution for skill resource tools', async () => {
    const execute = vi.fn().mockResolvedValue(createToolResult('read_skill_resource_slice', 'skill content'));

    const service = new ChatService(
      {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'skill',
          needClarification: false,
          selectedSkills: ['zhangxuefeng-perspective'],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({
          toolCalls: [
            { tool: 'read_skill_resource_slice', arguments: { resource: 'jobs.md' } },
          ],
        }),
        replyStream: vi.fn(),
        skillReplyStream: async function* () {
          yield '完成';
        },
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          name: 'zhangxuefeng-perspective',
          description: 'desc',
          entrypoint: '',
          runtime: 'chat',
          timeoutSec: 120,
          references: ['jobs.md'],
          directory: '/tmp/skills/zhangxuefeng-perspective',
          markdown: '# skill markdown',
          referencesContent: [
            {
              name: 'jobs.md',
              content: 'reference body',
            },
          ],
        }),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '读取一下这个 skill 的参考文件',
    );

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      sessionId: 's1',
      call: expect.objectContaining({
        tool: 'read_skill_resource_slice',
      }),
      skill: expect.objectContaining({
        name: 'zhangxuefeng-perspective',
      }),
    }));
  });

  it('forces web_search for zhangxuefeng fact questions when the planner omits it', async () => {
    const execute = vi.fn().mockResolvedValue(createToolResult('web_search', 'search content'));
    let capturedSkillReplyInput: { context?: string } | undefined;

    const service = new ChatService(
      {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'skill',
          needClarification: false,
          selectedSkills: ['zhangxuefeng-perspective'],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({ toolCalls: [] }),
        replyStream: vi.fn(),
        skillReplyStream: async function* (input: { context?: string }) {
          capturedSkillReplyInput = input;
          yield '完成';
        },
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          name: 'zhangxuefeng-perspective',
          description: 'desc',
          entrypoint: '',
          runtime: 'chat',
          timeoutSec: 120,
          references: [],
          directory: '/tmp/skills/zhangxuefeng-perspective',
          markdown: '# skill markdown',
          referencesContent: [],
        }),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '帮我分析人工智能专业就业前景',
    );

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      call: expect.objectContaining({
        tool: 'web_search',
        arguments: expect.objectContaining({
          query: '帮我分析人工智能专业就业前景',
        }),
      }),
    }));
    expect(capturedSkillReplyInput?.context).toContain('工具 1: web_search');
  });

  it('does not force web_search for abstract zhangxuefeng framework questions', async () => {
    const execute = vi.fn();

    const service = new ChatService(
      {
        appendEvent: vi.fn().mockResolvedValue(undefined),
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'skill',
          needClarification: false,
          selectedSkills: ['zhangxuefeng-perspective'],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({ toolCalls: [] }),
        replyStream: vi.fn(),
        skillReplyStream: async function* () {
          yield '完成';
        },
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          name: 'zhangxuefeng-perspective',
          description: 'desc',
          entrypoint: '',
          runtime: 'chat',
          timeoutSec: 120,
          references: [],
          directory: '/tmp/skills/zhangxuefeng-perspective',
          markdown: '# skill markdown',
          referencesContent: [],
        }),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '用张雪峰的视角聊聊普通家庭怎么平衡理想和现实',
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it('publishes file events when an assistant tool writes an artifact', async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      tool: 'write_artifact_file',
      arguments: { fileName: 'report.md' },
      summary: '已写入产物 report.md',
      content: 'artifact content',
      artifacts: [
        {
          id: 'file_1',
          userId: 'u1',
          sessionId: 's1',
          displayName: 'report.md',
          relativePath: 'sessions/s1/outputs/report.md',
          mimeType: 'text/markdown',
          size: 128,
          bucket: 'outputs',
          source: 'generated',
          createdAt: new Date().toISOString(),
          downloadUrl: '/api/files/file_1/download',
        },
      ],
    });

    const service = new ChatService(
      {
        appendEvent,
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish,
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'chat',
          needClarification: false,
          selectedSkills: [],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({
          toolCalls: [
            { tool: 'write_artifact_file', arguments: { fileName: 'report.md', content: '# Report' } },
          ],
        }),
        replyStream: async function* () {
          yield '完成';
        },
        skillReplyStream: vi.fn(),
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn(),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(true),
        list: vi.fn().mockReturnValue([]),
        execute,
      } as never,
      true,
    );

    await service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '把结果保存成文件',
    );

    const fileEvents = appendEvent.mock.calls
      .map((call) => call[2])
      .filter((event) => event?.kind === 'file');

    expect(fileEvents).toHaveLength(1);
    expect(fileEvents[0]?.file.displayName).toBe('report.md');
    expect(publish).toHaveBeenCalledWith('s1', expect.objectContaining({
      event: 'file_ready',
    }));
  });

  it('allows reply failures to be caught and persisted without crashing queue cleanup', async () => {
    const appendEvent = vi.fn().mockResolvedValue(undefined);

    const service = new ChatService(
      {
        appendEvent,
        readEvents: vi.fn().mockResolvedValue([]),
      } as never,
      {
        publish: vi.fn(),
      } as never,
      {
        classify: vi.fn().mockResolvedValue({
          mode: 'skill',
          needClarification: false,
          selectedSkills: ['zhangxuefeng-perspective'],
          reason: 'test',
        }),
        plan: vi.fn(),
        planToolUse: vi.fn().mockResolvedValue({
          toolCalls: [],
        }),
        replyStream: vi.fn(),
        skillReplyStream: async function* () {
          throw new Error('reply timeout');
        },
      } as never,
      {
        list: vi.fn().mockReturnValue([]),
        get: vi.fn().mockReturnValue({
          name: 'zhangxuefeng-perspective',
          description: 'desc',
          entrypoint: '',
          runtime: 'chat',
          timeoutSec: 120,
          references: [],
          directory: '/tmp/skills/zhangxuefeng-perspective',
          markdown: '# skill markdown',
          referencesContent: [],
        }),
      } as never,
      {
        getFileContext: vi.fn().mockReturnValue([]),
        list: vi.fn().mockReturnValue([]),
      } as never,
      {} as never,
      {
        requireOwned: vi.fn().mockReturnValue({
          id: 's1',
          title: '新会话',
          createdAt: '',
          updatedAt: '',
          lastMessageAt: null,
        }),
        renameFromMessage: vi.fn().mockResolvedValue(undefined),
        touch: vi.fn().mockResolvedValue(undefined),
      } as never,
      {
        shouldConsiderTools: vi.fn().mockReturnValue(false),
        list: vi.fn().mockReturnValue([]),
        execute: vi.fn(),
      } as never,
      true,
    );

    await expect(service.processMessage(
      { id: 'u1', username: 'tester', role: 'member' },
      's1',
      '用张雪峰的视角帮我分析一下人工智能专业',
    )).rejects.toThrow('reply timeout');

    await service.handleFailure('u1', 's1', new Error('reply timeout'));

    expect(appendEvent).toHaveBeenCalledWith(
      'u1',
      's1',
      expect.objectContaining({
        kind: 'error',
        message: 'reply timeout',
      }),
    );
  });
});
