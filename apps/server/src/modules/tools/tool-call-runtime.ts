import { z } from 'zod';
import path from 'node:path';
import type { SessionFileContext } from '@skillchat/shared';
import type { RunnerManager } from '../../core/runner/runner-manager.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';
import type { AssistantToolService, ExecutedAssistantToolResult } from './assistant-tool-service.js';
import {
  findAssistantToolDefinition,
  type AssistantToolDefinition,
  type ToolRuntimeCallbacks,
} from './tool-catalog.js';

type JsonRecord = Record<string, unknown>;
type ResponsesInputItem = JsonRecord;

export type ParsedLocalToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
  callId: string;
};

export type ToolExecutionOutcome = {
  callId: string;
  tool: string;
  status: 'success' | 'failed';
  result?: ExecutedAssistantToolResult;
  error?: string;
  durationMs: number;
};

const TOOL_OUTPUT_CHARS = 8_000;

const runWorkspaceScriptSchema = z.object({
  path: z.string().trim().min(1, 'path 不能为空'),
  args: z.array(z.coerce.string()).optional().default([]),
  cwdRoot: z.enum(['session', 'workspace']).optional().default('session'),
  cwdPath: z.string().trim().optional().default(''),
});

const truncate = (value: string, maxChars: number) => (
  value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
);

const createToolOutputPayload = (result: ExecutedAssistantToolResult) => JSON.stringify({
  summary: result.summary,
  content: truncate(result.context ?? result.content, TOOL_OUTPUT_CHARS),
  artifacts: (result.artifacts ?? []).map((file) => ({
    id: file.id,
    name: file.displayName,
    relativePath: file.relativePath,
    visibility: file.visibility ?? 'visible',
    ...(file.visibility === 'hidden' ? {} : { downloadUrl: file.downloadUrl }),
  })),
});

const normalizeWorkspaceToolPath = (value: string) =>
  value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const resolveEnabledSkillScriptPath = (scriptPath: string, availableSkills: RegisteredSkill[]) => {
  const normalized = normalizeWorkspaceToolPath(scriptPath);
  if (!normalized.startsWith('skills/')) {
    return scriptPath;
  }

  const matchedSkill = [...availableSkills]
    .sort((left, right) => right.name.length - left.name.length)
    .find((skill) => {
      const prefix = `skills/${skill.name}`;
      return normalized === prefix || normalized.startsWith(`${prefix}/`);
    });

  if (!matchedSkill) {
    throw new Error(`当前会话未启用 Skill 脚本路径：${normalized}`);
  }

  const prefix = `skills/${matchedSkill.name}`;
  const relativePath = normalized === prefix ? '' : normalized.slice(prefix.length + 1);
  if (!relativePath.startsWith('scripts/')) {
    throw new Error(`只能执行已启用 Skill 的 scripts/ 下脚本：${normalized}`);
  }

  if (
    matchedSkill.source === 'installed'
    && (
      !matchedSkill.manifest?.permissions.scripts
      || matchedSkill.manifest.runtime.type === 'none'
    )
  ) {
    throw new Error(`Skill does not allow script execution: ${matchedSkill.name}`);
  }

  if (matchedSkill.source === 'installed' && matchedSkill.manifest) {
    const allowedEntrypoints = new Set(
      matchedSkill.manifest.runtime.entrypoints.map((entrypoint) => normalizeWorkspaceToolPath(entrypoint.path)),
    );
    if (!allowedEntrypoints.has(relativePath)) {
      throw new Error(`Skill script is not declared as a runtime entrypoint: ${normalized}`);
    }
  }

  if (matchedSkill.source !== 'installed') {
    return scriptPath;
  }

  return path.join(matchedSkill.directory, relativePath);
};

export class ToolCallRuntime {
  constructor(
    private readonly toolCatalog: AssistantToolDefinition[],
    private readonly toolService: AssistantToolService,
    private readonly runnerManager: RunnerManager,
    private readonly callbacks: ToolRuntimeCallbacks = {},
  ) {}

  async executeAll(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    toolCalls: ParsedLocalToolCall[];
    signal?: AbortSignal;
  }): Promise<{
    outputs: ResponsesInputItem[];
    outcomes: ToolExecutionOutcome[];
  }> {
    const outputs: ResponsesInputItem[] = [];
    const outcomes: ToolExecutionOutcome[] = [];

    for (let index = 0; index < args.toolCalls.length;) {
      this.throwIfAborted(args.signal);
      const current = args.toolCalls[index]!;
      if (!this.shouldExecuteInParallel(current.tool)) {
        const result = await this.executeOne({
          ...args,
          call: current,
        });
        outputs.push(result.output);
        outcomes.push(result.outcome);
        index += 1;
        continue;
      }

      let batchEnd = index;
      while (batchEnd < args.toolCalls.length && this.shouldExecuteInParallel(args.toolCalls[batchEnd]!.tool)) {
        batchEnd += 1;
      }

      const batch = args.toolCalls.slice(index, batchEnd);
      const batchResults = await Promise.all(batch.map((call) => this.executeOne({
        ...args,
        call,
      })));

      outputs.push(...batchResults.map((item) => item.output));
      outcomes.push(...batchResults.map((item) => item.outcome));
      index = batchEnd;
    }

    return {
      outputs,
      outcomes,
    };
  }

  private shouldExecuteInParallel(tool: string) {
    return findAssistantToolDefinition(this.toolCatalog, tool)?.supportsParallelToolCalls ?? false;
  }

  private throwIfAborted(signal?: AbortSignal) {
    if (!signal?.aborted) {
      return;
    }

    throw signal.reason instanceof Error ? signal.reason : new DOMException('Turn interrupted', 'AbortError');
  }

  private async executeOne(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    call: ParsedLocalToolCall;
    signal?: AbortSignal;
  }) {
    const startedAt = Date.now();
    await this.callbacks.onToolCall?.({
      callId: args.call.callId,
      tool: args.call.tool,
      arguments: args.call.arguments,
    });
    await this.callbacks.onToolProgress?.({
      callId: args.call.callId,
      tool: args.call.tool,
      message: '开始调用工具',
      status: 'running',
    });

    try {
      const definition = findAssistantToolDefinition(this.toolCatalog, args.call.tool);
      let result: ExecutedAssistantToolResult;

      if (definition?.executionKind === 'runner' && args.call.tool === 'run_workspace_script') {
        const parsed = runWorkspaceScriptSchema.parse(args.call.arguments);
        const progressLines: string[] = [];
        const artifacts: ExecutedAssistantToolResult['artifacts'] = [];

        await this.runnerManager.execute({
          userId: args.userId,
          sessionId: args.sessionId,
          scriptPath: resolveEnabledSkillScriptPath(parsed.path, args.availableSkills),
          argv: parsed.args,
          cwdRoot: parsed.cwdRoot,
          cwdPath: parsed.cwdPath,
          signal: args.signal,
          onQueued: async () => {
            await this.callbacks.onToolProgress?.({
              callId: args.call.callId,
              tool: args.call.tool,
              message: '任务已排队',
              status: 'queued',
            });
          },
          onProgress: async (message, percent, status) => {
            progressLines.push(message);
            await this.callbacks.onToolProgress?.({
              callId: args.call.callId,
              tool: args.call.tool,
              message,
              percent,
              status,
            });
          },
          onArtifact: async (file) => {
            artifacts.push(file);
            await this.callbacks.onArtifact?.(file);
          },
        });

        result = {
          tool: args.call.tool,
          arguments: args.call.arguments,
          summary: artifacts.length > 0 ? '脚本执行完成，并生成了产物' : '脚本执行完成',
          content: progressLines.join('\n') || '脚本执行完成。',
          context: progressLines.join('\n') || '脚本执行完成。',
          artifacts,
        };
      } else {
        result = await this.toolService.execute({
          userId: args.userId,
          sessionId: args.sessionId,
          call: {
            tool: args.call.tool,
            arguments: args.call.arguments,
          },
          availableSkills: args.availableSkills,
        });
        for (const file of result.artifacts ?? []) {
          await this.callbacks.onArtifact?.(file);
        }
      }

      await this.callbacks.onToolResult?.({
        callId: args.call.callId,
        tool: args.call.tool,
        summary: result.summary,
        content: result.content,
      });

      return {
        output: {
          type: 'function_call_output',
          call_id: args.call.callId,
          output: createToolOutputPayload(result),
        } satisfies ResponsesInputItem,
        outcome: {
          callId: args.call.callId,
          tool: args.call.tool,
          status: 'success' as const,
          result,
          durationMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.callbacks.onToolResult?.({
        callId: args.call.callId,
        tool: args.call.tool,
        summary: `工具执行失败：${message}`,
        content: message,
      });

      return {
        output: {
          type: 'function_call_output',
          call_id: args.call.callId,
          output: JSON.stringify({
            error: message,
          }),
        } satisfies ResponsesInputItem,
        outcome: {
          callId: args.call.callId,
          tool: args.call.tool,
          status: 'failed' as const,
          error: message,
          durationMs: Date.now() - startedAt,
        },
      };
    }
  }
}
