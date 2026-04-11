# SkillChat Codex 化重构完整方案

**版本**: v1.0  
**日期**: 2026-04-10  
**状态**: Proposed  
**关联文档**:

- `docs/SkillChat_Design_Dev.md`
- `docs/SkillChat_TODO.md`
- `docs/Codex_Harness_Engineering_Analysis.md`
- `docs/Codex_Tools_Deep_Analysis.md`

---

## 1. 这份方案解决什么问题

当前 SkillChat 已经具备基本的聊天、Skill 执行、文件上传和工具调用能力，但它的代理层仍然是 MVP 级实现：

- 工具只是“给模型几把工具，然后把结果塞回上下文”
- 后端主流程把“路由、工具规划、工具执行、SSE 推送、Skill 执行、最终回复”混在一个服务里
- 前端展示的是“工具调用结果卡片”，不是“探索过程 / 行动轨迹”
- 文件工具还是“列文件 / 读文件全文截断”模型，缺少 Codex 式的渐进式披露
- Web 搜索虽然能工作，但还不是 Codex 那种分层 harness：查询生成、检索、抓取、证据压缩、最终综合之间的边界还不清晰
- 提示词仍然停留在“让模型尽量别乱来”，没有把工作方式工程化

用户要求的目标不是继续打补丁，而是系统性地重写成一套更接近 Codex harness engineering 的架构。因此本方案定义：

1. 当前系统的诊断结论
2. 目标架构与设计原则
3. 工具体系、事件模型、提示词策略
4. 后端与前端的重构切分
5. 搜索、文件访问、Skill 参考资料读取的标准流程
6. 测试、迁移、验收和风险控制

这不是“新增功能清单”，而是一份可以直接指导下一阶段开发的重构蓝图。

---

## 2. 当前系统诊断

## 2.1 当前代码结构的主要问题

结合现有实现：

- `apps/server/src/modules/chat/chat-service.ts`
- `apps/server/src/modules/tools/assistant-tool-service.ts`
- `apps/server/src/core/llm/openai-client.ts`
- `apps/web/src/lib/timeline.ts`
- `apps/web/src/components/MessageItem.tsx`
- `packages/shared/src/types.ts`

可以确认当前系统存在以下结构性问题。

### 问题 A：`ChatService` 过载

`ChatService` 现在同时负责：

- 会话排队
- 会话标题改名
- 消息落库
- `thinking` 推送
- LLM 路由判断
- 工具规划
- assistant tool 执行
- Skill runtime 执行
- 文件产出回写
- SSE 事件广播
- 最终回复流式输出

这会导致三个直接后果：

- 很难单独验证工具编排是否正确
- 很难切换不同的工具执行策略
- 任何一个环节变化都会波及整个聊天主流程

### 问题 B：`AssistantToolService` 是“工具大杂烩”

当前 `assistant-tool-service.ts` 同时承担：

- 工具目录定义
- 工具启发式是否触发
- 查询改写
- Bing / DuckDuckGo 搜索抓取
- 搜索结果页 fetch
- 文件列表
- 文件读取
- URL 安全校验
- 工具结果上下文整理

这不是可扩展的工具层，而是“一个工具系统的全部逻辑塞进一个 service”。

直接后果是：

- 新增一个工具会进一步膨胀该文件
- 很难为单个工具建立独立测试与独立事件
- 无法形成 Codex 式的工具分类和统一编排

### 问题 C：事件模型太粗

当前共享事件只有：

- `message`
- `thinking`
- `tool_call`
- `tool_progress`
- `tool_result`
- `file`
- `error`

这套模型只能描述“工具开始了 / 工具有进度 / 工具结束了”，无法描述：

- 本次动作属于 `search`、`fetch`、`read`、`skill_run` 还是 `plan`
- 一个动作由哪几个底层工具组成
- 并行调用之间的聚合关系
- 搜索命中的结果列表
- 文件读取的是哪一段、哪几行、哪种模式
- 最终答复引用了哪些内部证据

因此前端即使想做 Codex 风格的时间线，也没有足够的数据。

### 问题 D：前端显示的是“结果卡片”，不是“探索轨迹”

`timeline.ts` 现在做的是把 `tool_call -> tool_progress -> tool_result` 合并为一个 `tool_trace`。

这是正确方向，但还不够，原因是：

- 合并维度还是“工具调用”
- 展示中心还是“结果内容”
- 不是“搜索了什么 / 读了哪些文件 / 为什么继续 fetch / 最后提炼了哪些证据”
- 无法做渐进式披露

Codex 的重点不是展示每个底层返回值，而是展示高层行动语义。

### 问题 E：文件访问还不是渐进式披露

当前文件能力基本是：

- `list_files`
- `read_file`

其中 `read_file` 本质上还是“按文件读一个截断版全文”。

这与 Codex 的路径不同。Codex 的精髓是：

- 先列范围
- 再搜索
- 再切片
- 必要时再扩展

如果我们继续维持 `read_file(maxChars)` 模式，后续即便模型更强，也很容易：

- 一次把大量内容塞入上下文
- 读错文件时付出高 token 成本
- 无法稳定展示“我看了哪里”

### 问题 F：搜索能力可用，但还不是严格分层

当前搜索已经做了多查询组合、并行 provider 搜索、抓取结果页，这是对的。

但还缺三层工程化边界：

1. “搜索结果”与“结果页分析”没有拆成标准证据对象
2. “给模型的内部上下文”与“给前端调试看的展开内容”还没有统一协议
3. “provider-native web search”与“本地 fallback web search”没有形成双路径架构

### 问题 G：提示词没有把工作方式固定下来

当前 `openai-client.ts` 的提示词主要在描述：

- 你是工具规划器
- 哪些场景可以调工具
- 最多几个工具
- 回复时不要输出工具结果标签

这远远不够。Codex 的强点在于 prompt 明确规定：

- 先搜索还是先读取
- 读取时如何缩小范围
- 何时停止展开
- 如何使用并行
- 如何避免原样复述资料
- 如何把对用户可见的行动信息和内部推理分开

---

## 3. 目标与非目标

## 3.1 重构目标

本次重构目标不是“变得更复杂”，而是让系统具备以下能力。

### 目标 1：形成 Codex 风格的四层 harness

四层分别是：

1. `Prompt Policy Layer`
2. `Tool Spec / Capability Layer`
3. `Execution Orchestrator Layer`
4. `Timeline / History Presentation Layer`

### 目标 2：把“工具结果展示”升级为“行动轨迹展示”

前端应该显示：

- 搜索了哪些查询
- 抓取了哪些页面
- 读取了哪些文件 / 技能资料
- 是否并行执行
- 每一步拿到了什么摘要结果

而不是仅显示“调用某工具成功了”。

### 目标 3：文件与参考资料读取改为渐进式披露

对文件、Skill 文档、参考资料统一采用：

- list
- search
- slice
- block / expand

这种模型，不再鼓励全文读取。

### 目标 4：搜索流程标准化

Web 搜索必须具备：

- 查询组合生成
- provider 并行检索
- 结果去重与排序
- 结果页并行抓取
- 页面内容抽取
- 证据压缩
- 最终回答综合

### 目标 5：为并行工具调用建立正确的数据结构

系统要支持：

- 搜索查询并行
- 多 URL 并行 fetch
- 多文件候选并行搜索
- 前端按 action group 聚合展示

### 目标 6：建立完整测试体系

包括：

- 单工具测试
- 编排测试
- 事件聚合测试
- UI 折叠 / 展开测试
- E2E 回归测试

## 3.2 非目标

本方案当前不包括：

- 多 agent 协作
- 通用 shell 执行
- 任意本地目录读写
- MCP 全协议接入
- 完整复制 Codex 的 provider 协议层

原因很简单：当前 SkillChat 的业务核心仍然是“受控的教育咨询 / Skill 执行助手”，不是通用代码代理。

---

## 4. 设计原则

本次重构遵循以下原则。

### 原则 1：原子工具，小步探索

工具必须尽量原子化，每个工具只解决一类明确问题，例如：

- 列文件
- 搜索文件名
- 读取文件片段
- 搜索网页
- 抓取网页

不要继续扩大“超级工具”的职责。

### 原则 2：规划与执行分离

模型负责“决定下一步做什么”，系统负责：

- 安全校验
- 参数归一化
- 并发调度
- 结果压缩
- 事件发布

### 原则 3：对模型暴露的能力和对用户展示的历史分离

后端可以执行很多底层动作，但前端不应机械显示所有原始返回值。前端只显示用户调试真正关心的内容。

### 原则 4：证据对象先于最终回答

无论来自网页还是文件，最终都要先落成结构化 evidence，再进入回答综合。

### 原则 5：默认折叠，按需展开

所有工具轨迹默认一行压缩展示；展开后才显示：

- 参数
- 搜索结果列表
- 页面摘要
- 文件片段

### 原则 6：最终回答不回显原始工具资料

最终回答允许使用事实，但不能出现：

- “引用资料”
- “工具结果”
- “上下文如下”
- 大段网页 / 文件原文回贴

---

## 5. 目标架构

## 5.1 总体分层

目标架构如下：

```text
User Message
  -> Conversation Orchestrator
    -> Router / Planner Prompt
      -> Tool Catalog + Tool Orchestrator
        -> Web Tools / File Tools / Skill Resource Tools / Skill Runtime Tools
          -> Evidence Builder
            -> Reply Composer
              -> Timeline Publisher
                -> SSE / History Store / UI Timeline
```

## 5.2 关键模块

建议新增或重构为以下模块。

### A. `ConversationOrchestrator`

职责：

- 管理单会话执行队列
- 决定本轮走 direct reply、tool-assisted reply、skill runtime 还是 skill chat
- 协调 planner、tool orchestrator、reply composer

它会取代现在过度膨胀的 `ChatService` 主职责。

### B. `ToolCatalogService`

职责：

- 统一声明工具定义
- 提供按场景过滤后的工具集合
- 区分工具分类和工具能力元信息

例如：

- `kind: web-search`
- `kind: web-fetch`
- `kind: file-list`
- `kind: file-slice`
- `supportsParallel: true`
- `exposeToModel: true`
- `debuggable: true`

### C. `ToolOrchestrator`

职责：

- 参数校验
- 调用工具 handler
- 并行控制
- 超时控制
- 事件发布
- 结果标准化

它不关心“该不该调用”，只关心“如何可靠执行”。

### D. `EvidenceBuilder`

职责：

- 把搜索结果、页面摘录、文件片段、Skill 参考片段统一转换成 evidence
- 压缩成可放进模型上下文的最小信息
- 提供前端可调试展开内容

### E. `ReplyComposer`

职责：

- 接收用户问题、历史、skill 约束、evidence
- 组织最终回答
- 确保不把原始工具资料直接输出给用户

### F. `TimelineProjector`

职责：

- 将底层执行事件投影成 UI 所需的 timeline item
- 支持按 `callId` 和 `groupId` 聚合
- 输出默认折叠的一行摘要与展开详情

---

## 6. 工具体系重构方案

## 6.1 工具分类总表

建议把工具拆为五类。


| 分类                   | 目标       | 示例工具                                                                 |
| -------------------- | -------- | -------------------------------------------------------------------- |
| Discovery Tools      | 缩小目标范围   | `list_session_files`, `search_session_files`, `list_skill_resources` |
| Read Tools           | 渐进式获取内容  | `read_file_slice`, `read_file_block`, `read_skill_resource_slice`    |
| Web Tools            | 获取最新公开信息 | `web_search`, `web_fetch`                                            |
| Skill Runtime Tools  | 执行受控技能   | `run_skill`                                                          |
| Utility / Meta Tools | 编排和摘要    | `summarize_evidence`, `suggest_next_actions`                         |


当前阶段不需要把 `summarize_evidence` 暴露给模型作为真实工具，它可以先作为后端内部能力。

## 6.2 建议工具清单

### 6.2.1 文件与资料发现工具

#### `list_session_files`

用途：

- 列出会话和共享区的候选文件

建议参数：

- `bucket: 'uploads' | 'outputs' | 'shared' | 'all'`
- `offset`
- `limit`

返回：

- 文件基础信息列表
- 总数
- 是否还有更多

#### `search_session_files`

用途：

- 按文件名、扩展名、相对路径搜索候选文件

建议参数：

- `query`
- `bucket`
- `offset`
- `limit`

返回：

- 匹配文件列表
- 命中依据

#### `list_skill_resources`

用途：

- 列出当前 Skill 的 `SKILL.md` 与 references

适用场景：

- 角色型 Skill 需要先读规则
- 文档型 Skill 需要挑选参考资料

### 6.2.2 渐进式读取工具

#### `read_file_slice`

用途：

- 按字符范围或行范围读取一段文件

建议参数：

- `fileId`
- `startLine`
- `endLine`
- `maxChars`

返回：

- 片段内容
- 实际行号范围
- 是否截断

#### `read_file_block`

用途：

- 面向结构化文本读取一个更有语义的块

适用文件：

- Markdown
- JSON
- YAML
- 普通文本章节

建议参数：

- `fileId`
- `anchor`
- `before`
- `after`
- `mode: 'heading' | 'paragraph' | 'json-path' | 'auto'`

#### `read_skill_resource_slice`

用途：

- 读取 Skill 的 `SKILL.md` 或指定 reference 的片段

这是当前项目非常需要但还没有标准化的能力，因为用户明确要求“阅读 skill 文件、参考文件的工具卡片也要显示出来，方便调试”。

### 6.2.3 Web 工具

#### `web_search`

用途：

- 搜索公开网页，返回候选结果与结果页摘要

建议参数：

- `query`
- `intent`
- `maxQueries`
- `maxResults`
- `maxFetches`

说明：

- `intent` 用于告诉后端是“新闻 / 政策 / 学校 / 专业 / 招生 / 就业 / 薪资 / 综合”
- 后端据此决定查询组合模板

#### `web_fetch`

用途：

- 对一个明确 URL 做正文抽取

建议参数：

- `url`
- `maxChars`
- `prefer: 'article' | 'generic'`

### 6.2.4 Skill 执行工具

#### `run_skill`

用途：

- 运行受控 Skill

注意：

- 这类工具在事件层要单独作为 `skill_run`，不要混同于 `web_search`

## 6.3 工具暴露策略

并不是所有工具都应该始终暴露给模型。

建议按场景动态暴露：

- 普通对话：`web_search`, `web_fetch`, `list_session_files`, `search_session_files`, `read_file_slice`
- Skill 对话：在上面基础上增加 `list_skill_resources`, `read_skill_resource_slice`
- Skill 执行：模型不直接看到底层 runner 细节，只输出结构化 `run_skill`

## 6.4 工具元信息

每个工具定义应包含：

- `name`
- `category`
- `description`
- `inputSchema`
- `supportsParallel`
- `defaultCollapsed`
- `debugLevel`
- `exposeToModel`
- `visibleInTimeline`

这是后续统一执行和统一展示的基础。

---

## 7. Web 搜索能力设计

## 7.1 双路径策略

我们不能假设当前 OpenAI 兼容服务一定支持 Responses API 原生 `web_search`。因此必须采用双路径。

### 路径 A：Provider-native Web Search

适用条件：

- 上游模型服务明确支持 Responses API 原生搜索工具
- 返回工具事件或等价结构化结果

优势：

- 更接近 Codex 原生能力
- 搜索质量与抓取策略由 provider 承担

限制：

- 当前项目接入的 `http://101.132.237.21:8080/v1` 很可能只兼容 `/chat/completions`
- 不宜把后续能力建立在“上游未来也许支持”的假设上

### 路径 B：Local Search Harness

适用条件：

- provider 不支持原生搜索
- 需要可控的调试事件与结果展开

当前项目必须优先落这条路径。

## 7.2 本地搜索标准流程

建议固定为以下 pipeline：

1. Query Planner 生成 3 到 5 个查询组合
2. 针对每个查询并行访问多个 provider
3. 合并、去重、标准化搜索结果
4. 选 Top N URL 并行抓取
5. 抽取标题、摘要、正文关键片段
6. 形成 `webEvidence[]`
7. 将 `webEvidence[]` 压缩为内部上下文
8. 交给 Reply Composer 输出最终答案

## 7.3 查询组合策略

建议按“用户原问题 + 场景模板”生成查询，而不是只做字符串去噪。

例如问题：

`帮我选一个好一点的专业吧`

在“教育咨询 / 志愿填报”场景下，应生成类似：

- `{原问题}`
- `{原问题} 官方`
- `{专业选择} 就业 薪资 数据`
- `{专业选择} 张雪峰 观点`
- `{专业选择} 2026 录取 趋势`

这里的关键不是固定模板，而是：

- 查询意图要显式分类
- 多个查询要覆盖“官方信息、数据、观点、最新变化”

## 7.4 搜索结果事件设计

`web_search` 展开后必须能看到：

- 生成的查询组合
- 每个查询各返回多少条
- 去重后的结果列表
- 每条结果的标题、URL、搜索摘要
- 哪些结果页被继续 fetch
- fetch 成功 / 失败原因
- 页面抽取摘要

这直接回应了用户之前提出的调试需求。

## 7.5 搜索结果的数据结构

建议引入：

```ts
type WebSearchEvidence = {
  evidenceId: string;
  query: string;
  provider: string;
  title: string;
  url: string;
  finalUrl?: string;
  snippet?: string;
  excerpt?: string;
  publishedAt?: string;
  fetchStatus: 'not_fetched' | 'success' | 'failed';
  fetchError?: string;
  relevanceScore?: number;
};
```

最终模型上下文不应该直接塞原始调试文本，而应该塞压缩后的 evidence。

---

## 8. 文件与 Skill 资料的渐进式披露方案

## 8.1 为什么必须重做

当前 `read_file` 是按文件整体截断，这不利于：

- 定位具体信息
- 控制上下文体积
- 展示清晰的调试轨迹

Codex 的经验说明，正确方式不是一个万能读文件接口，而是“发现 + 定位 + 局部读取 + 必要时扩展”。

## 8.2 统一资源抽象

建议把以下对象都视为 `ReadableResource`：

- 会话上传文件
- 会话输出文件
- 用户共享文件
- Skill 的 `SKILL.md`
- Skill references

统一结构：

```ts
type ReadableResource = {
  resourceId: string;
  resourceType: 'session_file' | 'skill_doc' | 'skill_reference';
  displayName: string;
  mimeType?: string | null;
  locationHint: string;
  size?: number;
};
```

这样前端 timeline 与后端 read tool 可以共用一套展示协议。

## 8.3 推荐读取流程

对于“读取文件 / 读取 skill 资料”，标准流程为：

1. 列出候选资源
2. 通过文件名或 reference 名称缩小范围
3. 读取首段摘要或命中片段
4. 如不够，再扩展上下文块
5. 形成 `resourceEvidence[]`

## 8.4 Skill 资料的特殊处理

角色型 Skill 的 `SKILL.md` 不应该总被全文注入模型。

建议策略：

- 默认仅提供 metadata 和可读资源目录
- 只有模型决定“需要进一步阅读该 Skill 规则 / 参考资料”时，才调用 `read_skill_resource_slice`
- 历史时间线要明确标出“读取了哪个 Skill 的哪个资料”

## 8.5 推荐的调试展示

例如：

- `已读取 zhangxuefeng-skill / SKILL.md`
- `已读取 zhangxuefeng-skill / references/majors.md`
- `已读取上传文件 / 2026_专业数据.csv`

展开后再显示具体片段。

---

## 9. 事件模型重构方案

## 9.1 设计目标

新的事件模型要同时满足三类需求：

1. 后端执行可编排
2. 前端可聚合成紧凑 timeline
3. 调试信息可展开但默认不打扰用户

## 9.2 建议保留的高层事件

保留：

- `message`
- `file`
- `error`

替换 / 新增：

- `thinking` -> `status`
- `tool_call/tool_progress/tool_result` -> `action_start/action_update/action_finish`

## 9.3 建议新增共享类型

```ts
type ActionKind =
  | 'search'
  | 'fetch'
  | 'read'
  | 'skill_run'
  | 'plan'
  | 'synthesize';

type ActionSource =
  | 'assistant_tool'
  | 'skill_runtime'
  | 'provider_native';

type ActionEventBase = {
  id: string;
  sessionId: string;
  actionId: string;
  groupId?: string;
  actionKind: ActionKind;
  source: ActionSource;
  title: string;
  createdAt: string;
};

type ActionStartEvent = ActionEventBase & {
  kind: 'action_start';
  input?: Record<string, unknown>;
};

type ActionUpdateEvent = ActionEventBase & {
  kind: 'action_update';
  summary: string;
  progress?: number;
  debug?: Record<string, unknown>;
};

type ActionFinishEvent = ActionEventBase & {
  kind: 'action_finish';
  status: 'success' | 'failed';
  summary: string;
  output?: Record<string, unknown>;
  evidenceIds?: string[];
};
```

## 9.4 为什么要有 `groupId`

因为很多动作其实是一组并行调用：

- 一个 `web_search` 可能对应 4 个查询
- 每个查询又可能抓 2 个 provider
- 去重后再对 4 个 URL 并行 fetch

如果没有 `groupId`，前端很难把这组动作压成一个可理解的卡片。

建议：

- 顶层 `web_search` 持有一个 `groupId`
- 所有内部 provider 查询和 page fetch 归属于同一 `groupId`
- UI 默认只显示聚合视图

## 9.5 Debug 数据与用户数据分层

每个 action 需要同时保留：

- `summary`: 适合默认折叠一行展示
- `debug`: 适合展开调试
- `evidence`: 适合内部综合

这三者不能混为一谈。

---

## 10. 前端时间线与调试 UI 方案

## 10.1 UI 目标

前端需要从“消息 + 工具卡片”转为“对话时间线 + 可折叠行动轨迹”。

## 10.2 默认展示原则

默认状态：

- 等待中使用小气泡，而不是大块“正在分析需求”
- 每个 action 只占一行
- 一个并行动作组只显示一个卡片
- 优先展示动作摘要，不显示大段原始文本

例如：

- `搜索网页 · 4 个查询 · 抓取 3 个页面`
- `读取资料 · zhangxuefeng-skill / references/majors.md`
- `读取文件 · 2026_专业数据.csv · 112-168 行`
- `执行 Skill · pdf`

## 10.3 展开后的展示内容

展开后才显示：

- 输入参数
- 并行子任务列表
- 搜索结果列表
- 结果页摘要
- 文件片段
- 错误信息

## 10.4 气泡与输出框切换

根据用户要求，等待状态要采用：

- 在没有内容输出前，显示轻量等待气泡
- 一旦模型有正文 token 输出，就将其替换为标准 assistant 输出框

不再显示大号“正在分析需求”块。

## 10.5 时间线聚合规则

建议 `buildTimelineItems()` 升级为两阶段：

1. `normalizeActionEvents()`：按 `actionId/groupId` 收集原始事件
2. `projectTimelineItems()`：投影成 UI item

这样后续替换事件模型时，前端组件层不必感知底层复杂度。

## 10.6 会话标题生成

会话标题应改为：

- 首个用户问题的摘要
- 或使用轻量标题生成器生成 12 到 20 字摘要

不要只保留默认标题。

---

## 11. Prompt / Harness Strategy

## 11.1 总体策略

Prompt 不再只告诉模型“你能用哪些工具”，而是明确规定工作方式。

建议分成四类 prompt。

### A. Router Prompt

目标：

- 判断是否需要工具
- 判断是否需要 Skill 资料
- 判断是否需要 Skill runtime

要求：

- 不直接回答用户
- 只输出结构化决策

### B. Tool Planner Prompt

目标：

- 规划下一步要调用哪些工具

关键约束：

- 优先小步探索
- 有文件时先 list / search，不要直接盲读
- 需要最新信息时优先 search，再 fetch
- 能并行的查询要并行
- 最多允许有限步数

### C. Evidence Synthesizer Prompt

目标：

- 基于 evidence 组织最终答案

关键约束：

- 不输出“引用资料”“工具结果”“上下文”
- 不原样粘贴长段网页 / 文件内容
- 保留事实结论和必要出处感，但不要 debug 感

### D. Title Prompt

目标：

- 将首个问题压缩为会话标题

## 11.2 推荐行为约束

建议在 Tool Planner Prompt 里明确写入：

1. 有多个查询角度时，生成 3 到 5 个查询组合。
2. 搜索后只对最相关的少量页面继续抓取。
3. 对文件先列目录或搜索，再读取片段。
4. 如果已有足够证据，不要继续扩大读取范围。
5. 工具返回内容只用于内部分析，不要在最终回复中原样复述。

## 11.3 停止规则

为了避免无效工具调用，必须加入 stopping rules：

- 搜索结果已足够支持结论时停止继续 fetch
- 文件片段已命中核心内容时停止继续扩读
- 当新增工具调用不会显著提高答案质量时停止

---

## 12. 后端模块拆分方案

## 12.1 推荐目录

建议在 `apps/server/src/modules/tools/` 下重构为：

```text
tools/
├── catalog/
│   └── tool-catalog-service.ts
├── orchestrator/
│   ├── tool-orchestrator.ts
│   ├── tool-event-publisher.ts
│   └── evidence-builder.ts
├── web/
│   ├── web-search-tool.ts
│   ├── web-fetch-tool.ts
│   ├── search-provider.ts
│   └── html-extractor.ts
├── resources/
│   ├── resource-resolver.ts
│   ├── list-session-files-tool.ts
│   ├── search-session-files-tool.ts
│   ├── read-file-slice-tool.ts
│   ├── read-file-block-tool.ts
│   ├── list-skill-resources-tool.ts
│   └── read-skill-resource-slice-tool.ts
└── runtime/
    └── run-skill-tool.ts
```

## 12.2 `ChatService` 的重构方向

`ChatService` 最终应瘦身为：

- 接收入站消息
- 落库用户消息
- 调用 `ConversationOrchestrator`
- 转发流式输出

不要再直接持有大段工具细节。

## 12.3 `OpenAIModelClient` 的重构方向

建议新增：

- `router-client.ts`
- `tool-planner-client.ts`
- `reply-composer-client.ts`
- `title-generator-client.ts`

即使底层仍复用同一个 OpenAI 兼容接口，也要在代码结构上把职责拆开。

## 12.4 事件发布器

建议新增 `tool-event-publisher.ts`，统一负责：

- 生成 actionId / groupId
- 发送 SSE
- 写入 message store

避免每个工具自己散落地拼装事件。

---

## 13. 数据结构与存储调整

## 13.1 `StoredEvent` 扩展

建议新增：

- `action_start`
- `action_update`
- `action_finish`
- `status`

旧事件保留一段过渡期，通过 projector 向后兼容。

## 13.2 Evidence 存储

不建议把所有 evidence 只拼接成大字符串。

建议新增：

```ts
type EvidenceRecord = {
  id: string;
  sessionId: string;
  actionId: string;
  sourceType: 'web' | 'file' | 'skill_reference';
  title: string;
  locator: string;
  summary: string;
  contentSnippet?: string;
  createdAt: string;
};
```

第一阶段可以只存在内存和本轮上下文中；第二阶段再考虑是否持久化。

## 13.3 向后兼容策略

前端 timeline projector 先同时兼容：

- 旧 `tool_call/tool_progress/tool_result`
- 新 `action_*`

这样可以分阶段上线，不需要一次性切断。

---

## 14. 并行执行策略

## 14.1 并行原则

并行只用于独立、只读、互不依赖的动作。

适合并行：

- 多查询搜索
- 多 provider 搜索
- 多 URL fetch
- 多文件候选搜索

不适合并行：

- 依赖前一步结果的逐层推断
- Skill runtime 执行
- 共享会话目录有写入竞争的任务

## 14.2 并行单元

建议引入：

```ts
type ToolExecutionGroup = {
  groupId: string;
  strategy: 'parallel' | 'sequential';
  label: string;
  children: PlannedToolExecution[];
};
```

这样 planner 可以显式声明一组工具是否并行。

## 14.3 并行失败处理

对于搜索类动作：

- 允许部分失败
- 只要有足够成功结果即可继续

对于文件读取类动作：

- 允许某个候选文件读取失败
- 但要在调试展开中明确显示失败原因

---

## 15. 测试方案

## 15.1 后端单元测试

每个工具都要有独立测试：

- `web-search-tool.test.ts`
- `web-fetch-tool.test.ts`
- `search-session-files-tool.test.ts`
- `read-file-slice-tool.test.ts`
- `read-skill-resource-slice-tool.test.ts`

覆盖：

- 参数校验
- 安全限制
- 截断逻辑
- 并行结果合并
- 错误返回

## 15.2 编排测试

为 `ConversationOrchestrator` 增加集成测试，验证：

- 需要搜索的问题会触发搜索与抓取
- 有文件时会先 list / search，再 read
- 并行搜索事件能被正确聚合
- 最终回复不包含“引用资料”“工具结果”“上下文”

## 15.3 时间线测试

前端对 `buildTimelineItems()` 或其后继 projector 增加测试：

- 一个 action 默认压缩成一行
- 一个并行组只显示一个卡片
- `web_search` 展开后展示结果列表
- `read_file` / `read_skill_resource` 展开后显示片段

## 15.4 端到端测试

建议补三类 E2E 场景。

### 场景 A：教育咨询实时问题

输入：

- `帮我选一个好一点的专业吧`

验证：

- 触发多查询搜索
- 抓取多个结果页
- 最终回答不泄露工具原文

### 场景 B：读取 Skill 资料

输入：

- 激活 `zhangxuefeng-skill`
- 提问专业选择问题

验证：

- 时间线出现读取 `SKILL.md` 与 references 的卡片
- 默认折叠，展开可看片段

### 场景 C：文件分析

输入：

- 上传一个 CSV 或 Markdown
- 提问“总结这个文件的关键结论”

验证：

- 先列候选文件
- 再读取片段
- 最终回答不回贴原文

## 15.5 回归断言

必须加入明确回归测试，防止未来再次退化为：

- 只调用一次搜索
- 搜索不继续 fetch 页面
- 直接把工具上下文吐给用户
- 工具轨迹卡片过大

---

## 16. 分阶段实施计划

## 16.1 Phase 0：基线冻结

目标：

- 冻结当前可运行版本
- 补齐现状快照测试

输出：

- 当前 timeline 快照
- 当前搜索流程测试

## 16.2 Phase 1：共享契约升级

目标：

- 引入新的 `action_*` 事件结构
- 保持对旧事件兼容

输出：

- `packages/shared/src/types.ts` 更新
- timeline projector 双栈兼容

## 16.3 Phase 2：工具层拆分

目标：

- 拆分 `assistant-tool-service.ts`
- 引入 `ToolCatalogService`、`ToolOrchestrator`、独立 tool handlers

输出：

- 工具目录分层
- 独立单元测试

## 16.4 Phase 3：文件渐进式读取

目标：

- 上线 `search_session_files`
- 上线 `read_file_slice`
- 上线 `list_skill_resources`
- 上线 `read_skill_resource_slice`

输出：

- 文件 / Skill 资料工具轨迹可见

## 16.5 Phase 4：搜索链路重写

目标：

- 固化“查询生成 -> 搜索 -> fetch -> evidence”流程
- 并行结果聚合

输出：

- `web_search` 默认一行展示
- 展开可见结果列表与页面摘要

## 16.6 Phase 5：Prompt 与回答综合升级

目标：

- 重写 router / planner / composer prompt
- 加入 stopping rules

输出：

- 最终回答质量提升
- 不再回显工具资料

## 16.7 Phase 6：前端时间线重构

目标：

- 统一 action timeline UI
- 等待气泡与输出框切换

输出：

- 更接近 Codex 的调试体验

## 16.8 Phase 7：Provider-native 路径预留

目标：

- 为未来接入原生 Responses API 工具留扩展点

输出：

- provider-native 与 local fallback 的统一接口

---

## 17. 风险与对策

## 17.1 搜索 provider 的稳定性

风险：

- Bing / DuckDuckGo HTML 结构可能变化

对策：

- 把 provider parser 抽象化
- 为 parser 增加 fixture 测试
- 保留多 provider fallback

## 17.2 上下文膨胀

风险：

- 搜索摘要、页面摘要、文件片段过多时容易撑爆上下文

对策：

- 统一 evidence 压缩规则
- 对每轮搜索和读取设置 budget
- 只将 top evidence 放入最终综合

## 17.3 并行导致事件乱序

风险：

- 前端时间线顺序混乱

对策：

- 明确 `actionId/groupId`
- projector 以逻辑分组而非单纯时间顺序展示

## 17.4 旧前端兼容问题

风险：

- 新旧事件并存会增加前端复杂度

对策：

- 设置过渡期 projector
- 新组件先兼容双协议，再逐步删除旧协议

## 17.5 最终回答再次泄露原始资料

风险：

- 回复模型把 evidence 原文拼回给用户

对策：

- prompt 强约束
- 回归测试显式断言
- 必要时增加 post-process 检查

---

## 18. 验收标准

当以下条件全部满足时，视为本次重构达标。

### 架构层

- 工具层不再由单一 `assistant-tool-service.ts` 承担全部职责
- 聊天编排、工具执行、事件发布、回答综合完成解耦

### 能力层

- 搜索支持多查询组合、并行搜索、并行 fetch
- 文件与 Skill 资料支持渐进式读取
- 工具调用支持并行组

### UI 层

- 等待状态为轻量气泡
- 工具轨迹默认一行压缩显示
- `web_search` 展开可见搜索结果与页面摘要
- `read_file` / `read_skill_resource` 展开可见读取片段
- 每个并行动作组只占一个卡片

### 回答质量层

- 最终回答不出现“引用资料”“工具结果”“上下文”等 debug 词
- 不大段回贴网页 / 文件原文
- 面对需要最新信息的问题，确实使用搜索与页面抓取

### 测试层

- 单元测试、编排测试、前端时间线测试、E2E 核心场景全部通过

---

## 19. 建议执行顺序

建议严格按以下顺序开发，不要倒着做。

1. 先改共享事件契约和 timeline projector。
2. 再拆工具层，建立 catalog / orchestrator / handlers。
3. 然后补文件渐进式工具和 Skill 资料读取工具。
4. 再重写 web search pipeline。
5. 最后再改 prompt、前端 UI 和最终回答综合。

原因：

- 如果先改 UI，不改事件模型，前端只能继续补丁式适配
- 如果先改 prompt，不改工具层，模型仍然只能调用粗粒度工具
- 如果没有 evidence 和 action 分层，最终仍会回到“工具结果塞上下文”的旧模式

---

## 20. 本方案与现有文档的关系

`docs/SkillChat_Design_Dev.md` 解决的是 MVP 从 0 到 1 的系统设计。  
本方案解决的是在 MVP 可运行基础上，如何把代理层、工具层和调试体验升级到更接近 Codex harness engineering 的下一阶段架构。

二者不是冲突关系，而是阶段递进关系：

- `SkillChat_Design_Dev.md` 负责“系统先跑起来”
- `SkillChat_Codex_Refactor_Plan.md` 负责“系统从能用升级为可控、可解释、可扩展”

---

## 21. 下一步开发建议

如果按这份方案执行，下一轮开发应从以下工作开始：

1. 重构共享事件类型和前端 timeline projector
2. 将 `assistant-tool-service.ts` 拆分为 catalog + orchestrator + tool handlers
3. 落地 `search_session_files`、`read_file_slice`、`list_skill_resources`、`read_skill_resource_slice`
4. 重写 `web_search` 的 evidence 和 group event 流
5. 最后统一重写 prompt 和 Message timeline UI

这五步完成后，系统才真正具备继续向 Codex 风格演进的基础。