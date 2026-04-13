# SkillChat 上下文管理详细设计

**日期**: 2026-04-13  
**状态**: Draft / Phase 1 已完成，Phase 2 部分实施中

## 1. 背景

当前 SkillChat 的上下文管理存在几个结构性问题：

1. 会话历史进入模型前，仍然依赖固定硬编码：
   - 最近 16 条 `message`
   - 单条消息截断到 12k 字符
   - 文件预览只展示 8 个
2. 历史重放只保留 `message` 事件，之前轮次的工具结果、产物信息、关键文件读取结果不会稳定进入下一轮上下文。
3. 系统虽然已有 `compact` 这种 turn 类型，但没有真正实现“上下文压缩”能力，`/compact` 只是普通用户输入。
4. regular turn 在长会话中不会自动收缩上下文，最终只能靠粗暴裁剪历史。

这与 codex 的思路不一致。codex 的核心做法不是“固定条数截断”，而是：

- 让上下文管理成为独立能力
- 用 token 预算而不是消息条数决定保留范围
- 用 compaction summary 作为新的历史基线
- regular turn 和 manual compact 共用一套 compaction 机制

## 2. 设计目标

本次改造目标：

1. 删除固定 `16 / 12k / 8` 这类历史裁剪硬编码。
2. 引入独立的 `history builder`，按预算构建模型可见输入。
3. 为会话增加 `context state`，保存最近一次 compaction 摘要和它对应的历史基线。
4. 支持两种 compaction：
   - 手动 `/compact`
   - regular turn 的 pre-turn auto compact
5. compaction 不污染用户消息流，不把内部摘要直接展示成聊天消息。
6. 在保持单模型架构的前提下，用当前主模型完成 compaction。

## 3. 非目标

本阶段**仍不做**：

1. provider 精确 tokenizer 计数
   - 先使用近似 token 估算，避免引入重型依赖
2. 多份 compaction 链的复杂回放
   - 先只保留“最新一份 compaction baseline”
3. mid-turn compaction 的持久化基线写回
   - 当前只在同一轮 harness continuation 内生效，不写入 `session-context.json`
4. 改造前端专门展示 context compaction item
   - 本阶段只在普通事件流中给出 thinking/status 提示

## 4. 与 Codex 的逐项对齐

| 维度 | Codex 思路 | SkillChat 本次设计 |
|---|---|---|
| 历史输入 | 由 context manager 统一管理 | 新增独立 `history builder` |
| 历史裁剪 | 预算驱动，不看固定条数 | 预算驱动，去掉固定 16 条 |
| 压缩触发 | manual compact + auto compact | `/compact` + pre-turn auto compact |
| 压缩结果 | 形成新的 summary baseline | 写入 `session-context.json` |
| 旧历史处理 | 原始历史保留，但后续 prompt 基于 compacted baseline 构造 | 原始 `messages.jsonl` 保留，builder 只读取 baseline 之后的 delta |
| 与 UI 的关系 | compaction 是内部执行能力 | compaction 不污染用户消息列表 |

## 5. 核心结构

### 5.1 Session Context State

新增会话级上下文状态文件：

```json
{
  "version": 1,
  "latestCompaction": {
    "summary": "...",
    "createdAt": "2026-04-13T12:00:00.000Z",
    "baselineCreatedAt": "2026-04-13T11:58:00.000Z",
    "trigger": "manual"
  }
}
```

说明：

- `summary`
  - 模型生成的压缩摘要
- `baselineCreatedAt`
  - 这份摘要已经覆盖到哪个历史时间点
- `trigger`
  - `manual | auto`

为什么不用改写 `messages.jsonl`：

1. 用户可见历史应该完整保留
2. compaction 是内部执行状态，不应伪装成普通 assistant message
3. 这样回滚风险小，不破坏现有前端消息面板

### 5.2 History Builder

新增 history builder，替代当前 `toResponsesHarnessInput` 的固定裁剪逻辑。

输入：

- 全量 `StoredEvent[]`
- 当前用户消息
- 会话 `context state`
- 预算参数

输出：

- 传给 Responses API 的 `input` 数组

构建原则：

1. 如果存在 `latestCompaction`
   - 先注入一条 compaction summary
   - 再只拼接 `baselineCreatedAt` 之后的历史 delta
2. 如果不存在 `latestCompaction`
   - 从全量历史回溯构建
3. 历史按“模型真正需要的上下文价值”排序保留，而不是按事件类型机械保留

保留规则：

1. `message`
   - user / assistant 文本对话保留
2. `tool_result`
   - 转成压缩后的 assistant context message
   - 优先使用 `message` 和 `content/context` 的摘要，而不是原样塞大段正文
3. `file`
   - 转成简短 artifact 记录，例如“已生成 xxx.pdf”
4. `tool_call` / `tool_progress` / `thinking`
   - 默认不进入跨轮历史
   - 它们更适合 UI，不适合占模型上下文

### 5.3 预算模型

本阶段采用“近似 token 预算”：

- 估算方式：基于 UTF-8 byte length 做粗略 token 估算
- 目标不是精确 tokenizer 复刻，而是替代当前完全静态的消息条数裁剪

建议预算：

1. `context window`
   - 优先使用配置值
   - 未配置时使用保守默认值
2. `response reserve`
   - 至少预留 `LLM_MAX_OUTPUT_TOKENS`
3. `context budget`
   - `context_window - response_reserve - safety_margin`
4. `auto compact threshold`
   - 默认低于 `context budget`
   - regular turn 在超过阈值时，先 compact，再进入正常 sampling

### 5.4 Manual `/compact`

当 turn kind 为 `compact` 时，不走普通 harness reply 采样，而是执行：

1. 读取当前会话历史
2. 排除当前 `/compact` 指令本身
3. 构造 compact prompt
4. 用同一个主模型生成摘要
5. 写入 `session-context.json`
6. 回复一条简短 assistant 文本，说明上下文已压缩，后续将基于摘要继续

### 5.5 Pre-turn Auto Compact

当 regular turn 开始时：

1. 先读取历史和 context state
2. 估算若直接进入采样，输入会占用多少预算
3. 如果达到 auto compact 阈值：
   - 先以“当前输入之前的历史”为范围执行 compact
   - 保存新的 summary baseline
   - 再重新构建历史，进入正常 harness sampling

注意：

- 当前用户输入**不应该**被压进刚生成的 summary 里
- 否则会丢失“当前轮新问题”的明确边界

### 5.6 Mid-turn Continuation Compact

当同一轮 harness 已经执行了工具，继续 follow-up 时上下文再次膨胀：

1. 先把本轮已流出的 assistant 文本补回 continuation input
2. 把 `function_call` / `function_call_output` / 当前轮用户输入统一转成可压缩的文本视图
3. 若估算 token 超过 auto compact 阈值：
   - 触发一次 mid-turn compaction
   - continuation input 收缩为“当前轮用户输入 + compaction summary”
4. 然后在同一轮里继续 sampling，而不是等下一轮 regular turn 再压

注意：

- mid-turn compaction 目前是 harness 内部的即时能力
- 它解决“长工具链继续调用时爆上下文”的问题
- 它暂时**不**写入 `session-context.json`
  - 避免把尚未完成的本轮 assistant 输出错误固化成长期 baseline

## 6. 已落地范围

当前已实现：

1. 新增 `session context state` 存储
2. 新增 budget-driven history builder
3. regular turn 改为读取全量历史，不再固定 `limit: 50`
4. manual `/compact` 真正执行 compaction
5. regular turn 接入 pre-turn auto compact
6. prompt 中文件预览从固定数量改为预算驱动
7. harness 在 tool loop 内支持 mid-turn continuation compaction
8. 本轮已流给用户的 assistant 文本会回灌到后续 follow-up input，不再在工具轮之间丢失
9. harness tool loop 改为动态 continuation，请求数 / 工具调用总量 / 压缩次数分别独立熔断，不再由固定 8 轮主导

## 7. Phase 2 预留

后续继续做：

1. mid-turn compaction 的持久化策略与 baseline 语义
2. 更精细的 tool output 截断策略
3. provider 级 token usage 回写后，用真实 token 使用量替代近似估算

## 8. 风险与权衡

### 风险 1：近似 token 估算不精确

权衡：

- 先解决“完全静态裁剪”的结构问题
- 后续再接 provider 真实 token usage

### 风险 2：summary 质量不稳定

权衡：

- 本阶段只保留最新 summary baseline
- regular turn 仍会叠加 baseline 之后的真实 delta
- 减少“摘要一错，全会话都错”的影响面

### 风险 3：compaction 把当前用户问题吞进去

规避：

- pre-turn auto compact 时，显式排除当前 turn 输入

## 9. 实施顺序

1. 加 `session context state` 和路径
2. 实现 `history builder`
3. 接到 `OpenAIHarness.run`
4. 加 `compactContext()` 能力
5. 接到 `ChatService.executeTurn`
6. 补单测、集成测试、全量回归
