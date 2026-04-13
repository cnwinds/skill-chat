# SkillChat 聊天控制向 Codex 对齐 —— 详细设计改造文档

**版本**: v1.0  
**日期**: 2026-04-14  
**状态**: Proposed  
**前置文档**:

- `docs/Codex_Alignment_Refactor_Table.md` — 总体对齐改造表
- `docs/SkillChat_Codex_Refactor_Plan.md` — 全局重构方案
- `docs/Context_Management_Design.md` — 上下文管理设计

---

## 0. 文档目的

本文档聚焦 **聊天控制链路**（从用户消息到模型采样、工具调用、上下文管理、流式输出的端到端主循环），将 SkillChat 当前实现与 Codex `codex-rs/core` 逐模块对比，给出具体改造设计，使 SkillChat 在保留自身产品约束的前提下，获得 Codex 级别的控制面能力。

本文不覆盖前端 UI、搜索 pipeline 重构、tool handler 拆分等已由其他设计文档定义的内容。

---

## 1. 当前架构与 Codex 架构 —— 控制面全景对比

### 1.1 分层映射

```
┌─────────────────────────────────┐    ┌──────────────────────────────────────┐
│       SkillChat (TypeScript)    │    │       Codex (Rust / codex-rs)         │
├─────────────────────────────────┤    ├──────────────────────────────────────┤
│ ChatService                     │ ←→ │ submission_loop + handlers           │
│   └─ SessionTurnRuntime         │ ←→ │   └─ Session + ActiveTurn + TaskKind │
│        └─ executeTurn()         │ ←→ │        └─ RegularTask.run()          │
│             └─ OpenAIHarness    │ ←→ │             └─ run_turn()            │
│                  .run()         │    │                  inner loop           │
│                  ├─ runRound()  │ ←→ │                  ├─ run_sampling_req  │
│                  ├─ toolCalls   │ ←→ │                  ├─ ToolCallRuntime   │
│                  ├─ compact     │ ←→ │                  ├─ compact / remote  │
│                  └─ stream      │ ←→ │                  └─ SSE / WebSocket   │
├─────────────────────────────────┤    ├──────────────────────────────────────┤
│ SessionContextStore             │ ←→ │ Session.state.history                │
│ openai-harness-context          │ ←→ │ History + context_updates            │
│ tool-catalog + tool-service     │ ←→ │ ToolRouter + built_tools()           │
│ openai-harness-prompt           │ ←→ │ Prompt + base_instructions           │
│ StreamHub (SSE)                 │ ←→ │ EventMsg + send_event()              │
└─────────────────────────────────┘    └──────────────────────────────────────┘
```

### 1.2 核心差异矩阵

| 维度 | SkillChat 当前 | Codex | 差距评估 | 改造优先级 |
|---|---|---|---|---|
| **Op 分发** | `ChatService.dispatchMessage()` 只处理用户消息 | `submission_loop` 分发 30+ 种 `Op`（UserTurn / Compact / Review / ExecApproval / Undo / Hooks 等） | 中 — 当前只需扩展少数 Op | P2 |
| **Turn 类型** | `regular / compact / review / maintenance` 由字符串匹配推断 | `TaskKind` 枚举 + 独立 Task trait 实现 | 中 — 类型推断可以保留，但执行路径需解耦 | P1 |
| **Turn 生命周期** | `SessionTurnRuntime` 管理 phase/canSteer/round/interrupt | `Session.active_turn` + `CancellationToken` + `TurnContext` | 小 — 两边已基本等价 | — |
| **Steer（中途引导）** | 已实现，支持 `pendingInputs` drain | Codex 的 `steer_input` + `pending_input` + hooks 检查 | 小 — 两边等价 | — |
| **采样主循环** | `OpenAIHarness.run()` 单层 while 循环 | `run_turn()` 外层 + `run_sampling_request()` 内层 + retry/fallback | 大 — 缺少重试、传输降级、服务端模型警告 | P0 |
| **流式事件解析** | 手动解析 `response.output_text.delta` / `response.output_item.done` | `process_responses_event()` 处理 15+ 种事件（reasoning summary/delta/section break 等） | 大 — 缺 reasoning 事件和 plan mode | P1 |
| **工具调用运行时** | 在 harness 内串行/并行执行 tool calls | 独立 `ToolCallRuntime` + `FuturesOrdered` 异步并行 + 审批门 | 大 — 缺审批流和异步并行池 | P1 |
| **工具注册** | `buildAssistantToolCatalog()` 静态拼装 | `built_tools()` + `ToolRouter` 动态构建（MCP/skills/connectors/dynamic） | 中 — 已有 tool-catalog 雏形 | P2 |
| **上下文压缩** | pre-turn auto + manual + mid-turn continuation compact | inline compact + remote compact + pre-sampling compact + model-switch compact | 中 — 缺 remote compact 和 model-switch compact | P2 |
| **上下文注入** | summary 作为首条 assistant message 拼入 | `InitialContextInjection` 枚举控制注入位置（DoNotInject / BeforeLastUserMessage） | 中 — 缺精细注入位置控制 | P1 |
| **重试与降级** | `streamWithRetry` 最多 5 次，无传输降级 | provider-specific retry budget + WebSocket→HTTPS 降级 | 大 | P0 |
| **Hooks** | 无 | session_start / user_prompt_submit / stop / after_agent hooks | 中 — 当前不需要全部，但 stop hook 有价值 | P3 |
| **审批流** | 无 | exec_approval / patch_approval / granular policy | 大 — 当前业务不强需 | P3 |
| **Plan Mode** | 无 | `ModeKind::Plan` + `PlanModeStreamState` | 中 | P3 |
| **Diff 跟踪** | 无 | `TurnDiffTracker` + `TurnDiff` 事件 | 小 — 当前业务不强需 | P4 |
| **Ghost Snapshot** | 无 | `GhostSnapshotTask` | 小 | P4 |
| **Token 使用追踪** | 不追踪 | `TokenCountEvent` + `RateLimits` + `update_token_usage_info` | 大 — 对成本控制和 auto-compact 精度有影响 | P1 |

---

## 2. 改造原则

1. **Codex 能力分批引入，不一次性移植全部**  
   优先解决"采样主循环健壮性"和"工具调用运行时"两个最影响稳定性的差距。

2. **保留 SkillChat 的产品约束**  
   - 会话 skill allowlist
   - 文件 uploads/outputs/shared 产品语义
   - 用户级隔离与 JWT 鉴权
   - 中文提示与用户体验

3. **TypeScript 原生实现，不引入 Rust**  
   Codex 的 Rust 实现提供参考架构，但所有改造在 TypeScript 中完成。

4. **渐进式迁移，不断式替换**  
   每个改造阶段都必须保持现有测试绿色通过。

---

## 3. 改造详细设计

### 3.1 采样主循环重构（P0）

#### 3.1.1 当前问题

`OpenAIHarness.run()` 是单层 while 循环，将"采样请求→事件解析→工具执行→continuation 拼接→compaction"全部混在一起。Codex 将其拆为三层：

1. **外层 turn loop** (`run_turn`)：管理 pending input drain、auto compact 触发、stop hooks
2. **中层 sampling request** (`run_sampling_request`)：构建 prompt、调用模型、解析流式事件、收集 tool calls
3. **内层 stream loop** (`try_run_sampling_request`)：SSE 解析、retry、传输降级

#### 3.1.2 目标拆分

将 `OpenAIHarness.run()` 拆为：

```
run(args)                        // 外层：turn-level 循环
  ├─ runSamplingRequest(args)    // 中层：一次采样请求
  │    ├─ buildPrompt()          // 构建 Prompt 输入
  │    ├─ streamWithRetry()      // 内层：流式请求 + 重试
  │    └─ collectSamplingResult()// 解析结果
  ├─ executeToolCalls(result)    // 工具执行（独立运行时）
  ├─ maybeCompact()              // 按需压缩
  └─ drainPendingInputs()        // 消费中途引导
```

#### 3.1.3 重试与传输降级

当前 `streamWithRetry` 只做简单重试。改造为：

```typescript
type RetryConfig = {
  maxRetries: number;          // 默认 5
  baseDelayMs: number;         // 默认 1000
  backoffMultiplier: number;   // 默认 2
  respectServerDelay: boolean; // 读取 429 的 Retry-After
};
```

新增降级逻辑：

- 当 WebSocket 连接可用但连续失败超过 `maxRetries` 时，自动降级到 HTTPS SSE
- 降级时发送 `stream_error` 事件通知前端
- 日志记录降级原因

#### 3.1.4 采样结果结构

引入明确的采样结果类型，取代当前散落的局部变量：

```typescript
type SamplingRequestResult = {
  textDeltas: string[];
  completedItems: ResponsesInputItem[];
  localToolCalls: ParsedLocalToolCall[];
  needsFollowUp: boolean;
  tokenUsage?: TokenUsage;
};

type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};
```

#### 3.1.5 涉及文件

| 文件 | 改动 |
|---|---|
| `openai-harness.ts` | 拆分 `run()` 为三层；新增 `SamplingRequestResult` 类型 |
| `openai-harness.ts` | `streamWithRetry` 增加 backoff、server delay、降级逻辑 |
| `config/env.ts` | 新增 `STREAM_MAX_RETRIES`、`STREAM_BACKOFF_BASE_MS` 配置 |

---

### 3.2 工具调用运行时独立化（P1）

#### 3.2.1 当前问题

`OpenAIHarness.executeLocalToolCalls()` 和 `executeSingleLocalToolCall()` 直接在 harness 内部串行/并行执行工具。Codex 将工具执行抽象为独立的 `ToolCallRuntime`，它：

- 持有工具路由器引用
- 管理异步并行池（`FuturesOrdered`）
- 支持审批门控
- 统一处理工具结果回写

#### 3.2.2 新增 `ToolCallRuntime`

```typescript
export class ToolCallRuntime {
  constructor(
    private readonly toolCatalog: AssistantToolDefinition[],
    private readonly toolService: AssistantToolService,
    private readonly runnerManager: RunnerManager,
    private readonly callbacks: ToolRuntimeCallbacks,
  ) {}

  async executeAll(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    toolCalls: ParsedLocalToolCall[];
    signal?: AbortSignal;
  }): Promise<ResponsesInputItem[]> {
    // 按工具定义的 supportsParallelToolCalls 分组
    // 并行组用 Promise.all 执行
    // 串行组按顺序执行
    // 统一回调 onToolCall / onToolProgress / onToolResult / onArtifact
  }
}
```

#### 3.2.3 工具执行结果标准化

引入统一的工具输出结构，替代当前散落的 `createToolOutputPayload`：

```typescript
type ToolExecutionOutcome = {
  callId: string;
  tool: string;
  status: 'success' | 'failed';
  result?: ExecutedAssistantToolResult;
  error?: string;
  durationMs: number;
};
```

#### 3.2.4 涉及文件

| 文件 | 改动 |
|---|---|
| 新增 `modules/tools/tool-call-runtime.ts` | `ToolCallRuntime` 类 |
| `openai-harness.ts` | 删除 `executeLocalToolCalls` / `executeSingleLocalToolCall`，改为调用 `ToolCallRuntime` |
| `modules/tools/tool-catalog.ts` | 新增 `ToolRuntimeCallbacks` 类型 |

---

### 3.3 上下文注入位置控制（P1）

#### 3.3.1 当前问题

SkillChat 的 compaction summary 始终作为第一条 assistant message 拼入历史。Codex 区分两种注入策略：

- `DoNotInject`：pre-turn/manual compact 后不注入 initial context，等下一个 regular turn 完整注入
- `BeforeLastUserMessage`：mid-turn compact 后将 initial context 注入到最后一条用户消息之前

#### 3.3.2 改造设计

在 `openai-harness-context.ts` 引入注入策略枚举：

```typescript
type ContextInjectionStrategy =
  | 'prepend'              // 当前行为：summary 放在历史头部
  | 'before_last_user'     // mid-turn：summary + context 插到最后一条用户消息前
  | 'none';                // 由下一个 regular turn 重新注入

type CompactionScope =
  | 'pre_turn'             // 进入采样前的自动压缩
  | 'mid_turn'             // 同一轮续跑时的压缩
  | 'manual';              // 用户 /compact 触发
```

修改 `buildResponsesHistoryInput` 使其接受 `injectionStrategy` 参数：

```typescript
export const buildResponsesHistoryInput = (
  args: BuildResponsesHistoryInputArgs & {
    injectionStrategy?: ContextInjectionStrategy;
  },
): BuildResponsesHistoryInputResult => {
  // 根据 injectionStrategy 决定 summary 的插入位置
};
```

#### 3.3.3 涉及文件

| 文件 | 改动 |
|---|---|
| `openai-harness-context.ts` | 新增 `ContextInjectionStrategy` / `CompactionScope`，修改 `buildResponsesHistoryInput` |
| `openai-harness.ts` | `maybeCompactContinuationInput` 使用 `before_last_user` 策略 |
| `chat-service.ts` | `maybeAutoCompactHistory` 使用 `prepend` 策略 |

---

### 3.4 Token 使用追踪（P1）

#### 3.4.1 当前问题

SkillChat 完全不追踪 token 使用量。Codex 在每次 `response.completed` 事件中读取 `usage`，累计到 session 级别，用于：

- auto-compact 精确触发
- 前端 token count 展示
- rate limit 预警

#### 3.4.2 改造设计

新增 session 级 token 追踪：

```typescript
type SessionTokenUsage = {
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  lastUpdatedAt: string;
};
```

在 `OpenAIHarness.runRound()` 中解析 `response.completed` 事件的 usage 字段：

```typescript
if (event.event === 'response.completed' && dataRecord) {
  const usage = dataRecord.usage;
  if (isJsonRecord(usage)) {
    tokenUsage = {
      inputTokens: Number(usage.input_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? 0),
      totalTokens: Number(usage.total_tokens ?? 0),
    };
  }
}
```

将 token usage 向上传递，供 auto-compact 决策使用：

- 当 `totalTokens >= autoCompactLimit` 且有 follow-up 时，触发 mid-turn compact
- 向前端发送 `token_count` SSE 事件（可选，Phase 2）

#### 3.4.3 涉及文件

| 文件 | 改动 |
|---|---|
| `openai-harness.ts` | `runRound` 返回 `tokenUsage`；`run` 累计追踪 |
| `chat-service.ts` | 可选：存储 session 级 usage 快照 |
| `session-context-store.ts` | 可选：扩展 state 包含 usage |

---

### 3.5 流式事件解析增强（P1）

#### 3.5.1 当前问题

SkillChat 只处理两种流式事件：

- `response.output_text.delta` → 文本 delta
- `response.output_item.done` → function_call 收集

Codex 处理 15+ 种事件，包括：

| 事件 | 用途 |
|---|---|
| `response.created` | 标记响应开始 |
| `response.output_item.added` | 流式 item 开始（assistant message / function_call） |
| `response.output_item.done` | 流式 item 完成 |
| `response.output_text.delta` | 文本增量 |
| `response.reasoning_summary_text.delta` | reasoning summary 增量 |
| `response.reasoning_text.delta` | reasoning 原始内容增量 |
| `response.reasoning_summary_part.added` | reasoning section break |
| `response.completed` | 响应完成 + token usage |
| `response.failed` | 响应失败 |
| `response.incomplete` | 响应不完整 |

#### 3.5.2 改造设计

扩展 `runRound` 的事件处理分支：

```typescript
// 新增处理的事件类型
const EVENT_HANDLERS: Record<string, EventHandler> = {
  'response.created': handleResponseCreated,
  'response.output_item.added': handleOutputItemAdded,
  'response.output_item.done': handleOutputItemDone,
  'response.output_text.delta': handleOutputTextDelta,
  'response.reasoning_summary_text.delta': handleReasoningSummaryDelta,
  'response.completed': handleCompleted,
  'response.failed': handleFailed,
  'response.incomplete': handleIncomplete,
};
```

对于 reasoning 事件，向前端发送新的 SSE 事件类型：

```typescript
// 新增 SSE 事件
type ReasoningDeltaSSEvent = {
  event: 'reasoning_delta';
  data: {
    content: string;
    summaryIndex?: number;
  };
};
```

#### 3.5.3 涉及文件

| 文件 | 改动 |
|---|---|
| `openai-harness.ts` | 扩展 `runRound` 事件分支 |
| `core/llm/openai-responses.ts` | 确保底层 SSE 解析器转发所有事件类型 |
| `packages/shared/src/types.ts` | 新增 `reasoning_delta` SSE 事件类型 |

---

### 3.6 Turn 执行路径解耦（P1）

#### 3.6.1 当前问题

`ChatService.executeTurn()` 通过 `if (execution.kind === 'compact')` 等硬编码分支来区分不同 turn 类型的执行路径。Codex 使用独立的 `SessionTask` trait：

```rust
trait SessionTask {
    fn kind(&self) -> TaskKind;
    async fn run(self, session, ctx, input, token) -> Option<String>;
}
```

每种 turn 类型（`RegularTask` / `CompactTask` / `ReviewTask` / `UserShellCommandTask`）独立实现。

#### 3.6.2 改造设计

引入 `TurnTask` 接口：

```typescript
interface TurnTask {
  kind: TurnKind;
  execute(args: TurnTaskExecutionArgs): Promise<void>;
}

type TurnTaskExecutionArgs = {
  sessionId: string;
  userId: string;
  execution: TurnExecutionContext;
  input: RuntimeInput;
  history: StoredEvent[];
  contextState: SessionContextState;
};
```

实现具体 task：

```typescript
class RegularTurnTask implements TurnTask {
  kind = 'regular' as const;
  async execute(args: TurnTaskExecutionArgs) {
    // 1. maybeAutoCompact
    // 2. executeTurnRound (可能多轮)
    // 3. drainPendingInputs
  }
}

class CompactTurnTask implements TurnTask {
  kind = 'compact' as const;
  async execute(args: TurnTaskExecutionArgs) {
    // 1. compactContext
    // 2. save context state
    // 3. reply
  }
}
```

`ChatService.executeTurn()` 简化为：

```typescript
private async executeTurn(sessionId: string, execution: TurnExecutionContext) {
  const task = this.resolveTurnTask(execution.kind);
  await task.execute({
    sessionId,
    userId: execution.user.id,
    execution,
    input: execution.initialInput,
    history: await this.messageStore.readEvents(execution.user.id, sessionId),
    contextState: await this.sessionContextStore.load(execution.user.id, sessionId),
  });
}

private resolveTurnTask(kind: TurnKind): TurnTask {
  switch (kind) {
    case 'regular': return new RegularTurnTask(this.openAIHarness, this.sessionContextStore, ...);
    case 'compact': return new CompactTurnTask(this.openAIHarness, this.sessionContextStore, ...);
    default: return new RegularTurnTask(...);
  }
}
```

#### 3.6.3 涉及文件

| 文件 | 改动 |
|---|---|
| 新增 `core/turn/turn-task.ts` | `TurnTask` 接口定义 |
| 新增 `core/turn/regular-turn-task.ts` | `RegularTurnTask` 实现 |
| 新增 `core/turn/compact-turn-task.ts` | `CompactTurnTask` 实现 |
| `chat-service.ts` | `executeTurn` 简化为任务分发 |

---

### 3.7 Prompt 构建对齐（P2）

#### 3.7.1 当前与 Codex 的差异

| 维度 | SkillChat | Codex |
|---|---|---|
| 基础指令 | 硬编码在 `openai-harness-prompt.ts` | `base_instructions` 从模板加载 + 动态拼接 |
| Skill 注入 | 列表 + 使用说明 | Skill 作为 `ResponseItem` 注入到历史 |
| 文件上下文 | `formatFilesSection` 写入 instructions | 通过 `context_updates` 机制注入 |
| 工具描述 | 在 `tool-catalog.ts` 中定义 | 由 `ToolRouter.model_visible_specs()` 动态生成 |
| Personality | 无 | 独立 personality 配置 |

#### 3.7.2 改造设计

**Phase 1**：将 `buildOpenAIHarnessInstructions` 改为模板化：

```typescript
const INSTRUCTION_TEMPLATE = `
## Role
{role_description}

## Working Style
{working_style}

## Runtime Context
当前日期：{today}
工作区根目录：{cwd}

{files_section}

{skills_section}
`;
```

**Phase 2**：将 Skill 上下文和文件上下文从 instructions 迁移到 input items：

```typescript
// 不再写入 instructions，而是作为 developer message 注入到 input
const contextItems: ResponsesMessageInput[] = [
  { role: 'developer', content: skillsSection },
  { role: 'developer', content: filesSection },
];
```

这与 Codex 的 `record_context_updates_and_set_reference_context_item` 对齐。

#### 3.7.3 涉及文件

| 文件 | 改动 |
|---|---|
| `openai-harness-prompt.ts` | 模板化指令构建 |
| `openai-harness.ts` | Phase 2 时将 skill/file context 改为 input items |

---

### 3.8 Session 配置动态更新（P2）

#### 3.8.1 当前问题

SkillChat 的 `AppConfig` 是进程级静态配置。Codex 支持 turn-level 配置覆盖：

```rust
Op::UserTurn {
    cwd,
    approval_policy,
    sandbox_policy,
    model,
    effort,
    summary,
    service_tier,
    collaboration_mode,
    personality,
    ...
}
```

每个 turn 可以独立指定模型、reasoning effort、sandbox 策略等。

#### 3.8.2 改造设计

引入 `TurnConfig`，允许 turn-level 配置覆盖：

```typescript
type TurnConfig = {
  model?: string;
  reasoningEffort?: string;
  maxOutputTokens?: number;
  webSearchMode?: 'disabled' | 'cached' | 'live';
};
```

在 `MessageDispatchRequest` 中新增可选 `turnConfig` 字段：

```typescript
type MessageDispatchRequest = {
  content: string;
  dispatch: string;
  turnId?: string;
  kind?: TurnKind;
  turnConfig?: TurnConfig;  // 新增
};
```

`OpenAIHarness.run()` 接收 `turnConfig` 并合并到本轮采样参数。

#### 3.8.3 涉及文件

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types.ts` | 新增 `TurnConfig` |
| `openai-harness.ts` | `run()` 接收并使用 `turnConfig` |
| `chat-service.ts` | 透传 `turnConfig` |

---

### 3.9 错误分类与恢复（P2）

#### 3.9.1 当前问题

SkillChat 的错误处理只区分 `Error` 和 `AbortError`。Codex 有丰富的错误分类：

```rust
enum CodexErr {
    ContextWindowExceeded,
    UsageLimitReached(UsageLimitInfo),
    Stream(String, Option<Duration>),
    Interrupted,
    TurnAborted,
    InvalidImageRequest,
    ...
}
```

每种错误有独立的恢复策略：

- `ContextWindowExceeded` → 尝试 compact 后重试
- `UsageLimitReached` → 更新 rate limits，通知用户
- `Stream` → 重试 + 可能降级传输

#### 3.9.2 改造设计

引入错误分类枚举：

```typescript
type HarnessErrorKind =
  | 'context_window_exceeded'
  | 'usage_limit_reached'
  | 'stream_disconnected'
  | 'turn_aborted'
  | 'tool_execution_failed'
  | 'unknown';

class HarnessError extends Error {
  constructor(
    readonly kind: HarnessErrorKind,
    message: string,
    readonly retryable: boolean = false,
    readonly httpStatus?: number,
    readonly serverDelay?: number,
  ) {
    super(message);
  }
}
```

在采样主循环中根据错误类型执行恢复：

```typescript
switch (error.kind) {
  case 'context_window_exceeded':
    // 尝试 compact，然后重试本轮
    break;
  case 'usage_limit_reached':
    // 发送 rate limit 事件，终止本轮
    break;
  case 'stream_disconnected':
    // backoff 重试
    break;
}
```

#### 3.9.3 涉及文件

| 文件 | 改动 |
|---|---|
| 新增 `core/llm/harness-error.ts` | `HarnessError` 类 |
| `openai-harness.ts` | 采样循环使用 `HarnessError` 分类处理 |
| `core/llm/openai-responses.ts` | 解析 API 错误为 `HarnessError` |

---

### 3.10 Stop Hook 预留（P3）

#### 3.10.1 Codex 的 Stop Hook

当模型完成输出、不再有 tool calls 时，Codex 会运行 `stop hook`：

```rust
let stop_outcome = sess.hooks().run_stop(stop_request).await;
if stop_outcome.should_block {
    // 注入 hook prompt，继续下一轮采样
}
if stop_outcome.should_stop {
    break;
}
```

这使得外部脚本可以在 agent 决定停止时进行检查（例如：代码质量检查、测试运行），如果检查不通过，注入 continuation prompt 让 agent 继续。

#### 3.10.2 改造设计

在 `RegularTurnTask` 的 `needsFollowUp === false` 分支预留 hook 点：

```typescript
// 当模型不再需要 follow-up 时
if (!result.needsFollowUp) {
  const stopDecision = await this.evaluateStopCondition({
    sessionId,
    turnId,
    lastAssistantMessage,
  });

  if (stopDecision.shouldContinue) {
    // 注入 continuation prompt，继续循环
    currentInput = { content: stopDecision.continuationPrompt, ... };
    continue;
  }

  break;
}
```

当前阶段 `evaluateStopCondition` 默认返回 `{ shouldContinue: false }`，为后续接入外部 hook 脚本预留接口。

---

## 4. 新增配置项

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `STREAM_MAX_RETRIES` | number | 5 | 单次采样请求最大重试次数 |
| `STREAM_BACKOFF_BASE_MS` | number | 1000 | 重试退避基准延迟 |
| `STREAM_BACKOFF_MULTIPLIER` | number | 2 | 退避倍率 |
| `ENABLE_TOKEN_TRACKING` | boolean | true | 是否追踪 token 使用量 |
| `ENABLE_REASONING_EVENTS` | boolean | false | 是否向前端转发 reasoning delta 事件 |

---

## 5. 新增/修改文件清单

### 5.1 新增文件

| 文件路径 | 说明 |
|---|---|
| `apps/server/src/core/turn/turn-task.ts` | `TurnTask` 接口和基础类型定义 |
| `apps/server/src/core/turn/regular-turn-task.ts` | Regular turn 执行逻辑 |
| `apps/server/src/core/turn/compact-turn-task.ts` | Compact turn 执行逻辑 |
| `apps/server/src/modules/tools/tool-call-runtime.ts` | 独立的工具调用运行时 |
| `apps/server/src/core/llm/harness-error.ts` | 结构化错误分类 |
| `apps/server/src/core/llm/token-tracker.ts` | Token 使用追踪 |

### 5.2 修改文件

| 文件路径 | 改动要点 |
|---|---|
| `apps/server/src/modules/chat/openai-harness.ts` | 拆分 `run()` 为三层；事件解析增强；删除内嵌工具执行 |
| `apps/server/src/modules/chat/openai-harness-context.ts` | 新增 `ContextInjectionStrategy`；修改 history builder |
| `apps/server/src/modules/chat/openai-harness-prompt.ts` | 模板化指令构建 |
| `apps/server/src/modules/chat/chat-service.ts` | `executeTurn` 简化为任务分发 |
| `apps/server/src/modules/chat/session-context-store.ts` | 可选：扩展 state 包含 token usage |
| `apps/server/src/modules/tools/tool-catalog.ts` | 新增 `ToolRuntimeCallbacks` |
| `apps/server/src/config/env.ts` | 新增配置项 |
| `apps/server/src/core/llm/openai-responses.ts` | 确保转发所有 Responses API 事件类型 |
| `packages/shared/src/types.ts` | 新增 `TurnConfig`、`reasoning_delta` 事件、`token_count` 事件 |

---

## 6. 执行阶段与顺序

### Phase 0：基线保障（0.5 天）

- 确认现有全部测试通过
- 为 `openai-harness.ts` 补充关键路径的快照测试

### Phase 1：采样主循环重构（2 天）

1. 新增 `HarnessError` 分类
2. 拆分 `run()` 为三层
3. 增强 `streamWithRetry`（backoff、server delay）
4. 新增 `SamplingRequestResult` 类型
5. 补充重试与降级测试

### Phase 2：工具调用运行时独立化（1.5 天）

1. 新增 `ToolCallRuntime`
2. 从 `OpenAIHarness` 中提取工具执行逻辑
3. 统一 `ToolExecutionOutcome`
4. 补充并行执行测试

### Phase 3：流式事件增强 + Token 追踪（1 天）

1. 扩展 `runRound` 事件分支
2. 解析 `response.completed` 中的 usage
3. 新增 `TokenUsage` 追踪
4. 可选：新增 `reasoning_delta` SSE 事件

### Phase 4：上下文注入策略 + Turn 解耦（1.5 天）

1. 新增 `ContextInjectionStrategy`
2. 修改 `buildResponsesHistoryInput` 支持策略参数
3. 新增 `TurnTask` 接口和具体实现
4. `ChatService.executeTurn` 简化为任务分发

### Phase 5：Prompt 模板化 + Session 配置（1 天）

1. 指令构建改为模板化
2. 新增 `TurnConfig` 支持
3. 补充配置项

### Phase 6：收尾与全量测试（1 天）

1. 全量回归测试
2. 更新设计文档
3. 移除废弃代码

**预估总工期：8.5 天**

---

## 7. 测试策略

### 7.1 单元测试

| 模块 | 测试重点 |
|---|---|
| `HarnessError` | 错误分类正确性、retryable 判定 |
| `ToolCallRuntime` | 串行/并行分组、超时处理、部分失败 |
| `buildResponsesHistoryInput` | 各注入策略下的 summary 位置 |
| `TokenUsage` 追踪 | 累计准确性、usage 解析 |
| `TurnTask` 分发 | kind 映射正确性 |

### 7.2 集成测试

| 场景 | 验证点 |
|---|---|
| 正常对话 | 三层循环正常运行，文本流式输出 |
| 工具调用 | ToolCallRuntime 正确执行并回传结果 |
| 长会话 auto compact | token 超阈值时自动压缩，后续轮次正常 |
| API 重试 | 模拟 5xx，验证重试和 backoff |
| 中断 | `AbortSignal` 正确传播到工具执行层 |
| mid-turn compact | 多轮工具调用后触发续跑压缩 |

### 7.3 回归断言

- `openai-harness.test.ts` 现有用例全部通过
- `chat-service.test.ts` 现有用例全部通过
- `openai-harness-context.test.ts` 现有用例全部通过
- `openai-harness-prompt.test.ts` 现有用例全部通过

---

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 三层循环拆分引入状态传递 bug | 对话中断或死循环 | 逐层拆分，每层完成后立即跑全量测试 |
| ToolCallRuntime 的异步并行引入竞态 | 工具结果丢失或乱序 | 使用有序收集（类似 Codex 的 FuturesOrdered） |
| Token 使用量在不同 provider 间不一致 | auto-compact 触发时机偏差 | 保留近似估算作为兜底，优先使用 API 返回的真实值 |
| 事件解析增强导致兼容性问题 | 未知事件类型导致异常 | 未知事件类型默认跳过（与 Codex 一致） |
| TurnTask 拆分影响现有 recovery 逻辑 | 进程重启后 turn 恢复失败 | 保持 `SessionTurnRuntime` 的 persistence 机制不变 |

---

## 9. 明确保留项

以下内容属于 SkillChat 产品特性，本次改造不修改：

- 会话级 skill allowlist 机制
- 文件 uploads / outputs / shared 产品语义
- JWT 鉴权和用户隔离
- `SessionTurnRuntime` 的 turn 生命周期管理（phase / canSteer / round / interrupt）
- `StreamHub` 的 SSE 推送机制
- 前端 `useSessionStream` hook

---

## 10. 明确不做项

以下 Codex 能力在当前阶段不引入：

- 完整审批流（exec_approval / patch_approval）
- Plan Mode（`ModeKind::Plan`）
- Ghost Snapshot
- Diff 跟踪（`TurnDiffTracker`）
- MCP 全协议接入
- Realtime / WebSocket 会话
- 多 Agent 协作（inter-agent communication）
- Undo / Rollback

---

## 11. 验收标准

当以下条件全部满足时，视为本次改造达标：

1. 采样主循环拆为三层（turn loop / sampling request / stream loop），各层职责清晰
2. 工具执行由独立 `ToolCallRuntime` 管理，支持串行/并行分组
3. API 重试支持 exponential backoff 和 server delay 尊重
4. 流式事件解析覆盖 `response.completed`（含 token usage）和错误事件
5. Token 使用量被追踪，auto-compact 可使用真实 usage 值
6. 上下文注入支持 `prepend` / `before_last_user` / `none` 三种策略
7. Turn 执行路径通过 `TurnTask` 接口解耦
8. 所有现有测试通过，新增模块有完整单元测试
9. 错误分类覆盖 context_window_exceeded / usage_limit_reached / stream_disconnected

---

## 12. 与现有文档的关系

| 文档 | 定位 | 与本文档关系 |
|---|---|---|
| `Codex_Alignment_Refactor_Table.md` | 总体对齐改造清单 | 本文档是其中"聊天控制"维度的详细展开 |
| `SkillChat_Codex_Refactor_Plan.md` | 全局重构方案（工具/事件/UI/搜索） | 本文档聚焦控制面，不覆盖 UI 和搜索 pipeline |
| `Context_Management_Design.md` | 上下文管理设计 | 本文档的 3.3/3.4 节是其 Phase 2 的具体实施方案 |
| `SkillChat_Design_Dev.md` | MVP 系统设计 | 本文档是 MVP 之上的架构升级 |
