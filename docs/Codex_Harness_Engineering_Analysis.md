# Codex Harness Engineering 深度分析

## 1. 研究范围

本次分析对象是仓库 `codex/`，重点阅读了以下几类实现：

- 提示词与行为约束：
  - `codex/codex-rs/protocol/src/prompts/base_instructions/default.md`
  - `codex/codex-rs/core/gpt_5_codex_prompt.md`
  - `codex/codex-rs/core/gpt_5_1_prompt.md`
  - `codex/codex-rs/core/gpt_5_2_prompt.md`
  - `codex/codex-rs/core/templates/memories/read_path.md`
- 工具注册与规格：
  - `codex/codex-rs/tools/src/tool_registry_plan.rs`
  - `codex/codex-rs/tools/src/tool_spec.rs`
  - `codex/codex-rs/tools/src/local_tool.rs`
  - `codex/codex-rs/tools/src/mcp_resource_tool.rs`
- 工具执行编排：
  - `codex/codex-rs/core/src/tools/spec.rs`
  - `codex/codex-rs/core/src/tools/router.rs`
  - `codex/codex-rs/core/src/tools/parallel.rs`
  - `codex/codex-rs/core/src/tools/orchestrator.rs`
  - `codex/codex-rs/core/src/tools/handlers/unified_exec.rs`
  - `codex/codex-rs/core/src/tools/handlers/list_dir.rs`
  - `codex/codex-rs/core/src/tools/handlers/mcp_resource.rs`
  - `codex/codex-rs/core/src/tools/handlers/tool_search.rs`
- 文件读取与安全判定：
  - `codex/codex-rs/shell-command/src/parse_command.rs`
  - `codex/codex-rs/shell-command/src/command_safety/is_safe_command.rs`
  - `codex/codex-rs/core/src/tools/handlers/read_file_tests.rs`
- Web Search 事件与展示：
  - `codex/codex-rs/core/src/web_search.rs`
  - `codex/codex-rs/protocol/src/models.rs`
  - `codex/codex-rs/core/src/event_mapping.rs`
  - `codex/codex-rs/core/tests/suite/web_search.rs`
  - `codex/codex-rs/core/tests/suite/items.rs`
  - `codex/codex-rs/tui/src/history_cell.rs`
  - `codex/codex-rs/tui/src/snapshots/codex_tui__history_cell__tests__coalesces_reads_across_multiple_calls.snap`
  - `codex/codex-rs/tui/src/snapshots/codex_tui__history_cell__tests__coalesces_sequential_reads_within_one_call.snap`
  - `codex/codex-rs/tui/src/snapshots/codex_tui__history_cell__tests__web_search_history_cell_snapshot.snap`

本分析的目标不是“抄一个工具函数”，而是提炼 Codex 这套 harness engineering 的设计原则，判断哪些东西可以迁移到我们当前项目，哪些东西不能机械照搬。

## 2. 先给结论：Codex 的精髓不在某个工具，而在整套分层约束

Codex 的强点，不是“它有一个很聪明的 `read_file` 工具”或者“它有一个会抓网页的 `web_search` 函数”，而是：

1. 它把模型行为拆成了四层：
  - 提示词层：告诉模型该怎么探索、怎么小步读取、怎么沟通。
  - 工具层：只暴露少量、边界清晰、可组合的原子能力。
  - 编排层：负责安全、审批、并行、重试、沙箱和事件流。
  - 展示层：把工具调用重新压缩成对用户可理解的“探索轨迹”。
2. 它的“渐进式披露”主要不是后端强制切片，而是：
  - prompt 强约束
  - 安全读命令白名单
  - 小步 shell 读取习惯
  - `list_dir` 这类分页/限深工具
  - UI 对连续读取行为的折叠总结
3. 它的 `web_search` 不是自建爬虫，也不是“先搜索再自己 fetch 页面”的本地实现，而是直接把 OpenAI Responses API 的原生 `web_search` 工具暴露给模型。
4. 它把“能力暴露给模型”和“能力如何被用户看到”分开了：
  - 模型看到的是 tool spec、system prompt、AGENTS、memory prompt。
  - 用户看到的是被解释过、折叠过、去噪过的 history cell。

这意味着：如果我们想在当前项目里“参考 Codex 重写”，应该学习的是它的约束方式、工具颗粒度、事件模型和 UI 呈现方式，而不是只抄一个搜索实现。

## 3. Codex 的总体架构：它如何把模型变成一个可控代理

### 3.1 Prompt 先规定工作方式

在 `default.md` 和各个模型 prompt 中，Codex 不是简单说“你是一个助手”，而是详细规定：

- 搜索文本或文件优先用 `rg` / `rg --files`
- 不要用 Python 粗暴输出大段文件
- 编辑优先用 `apply_patch`
- 要发 preamble / user updates
- 复杂任务要用 `update_plan`
- 不要随便 `cd`，而是显式传 `workdir`
- 最终回答如何组织、如何引用文件路径、如何控制篇幅

也就是说，工具只是“能做什么”，prompt 负责“优先怎么做”。这是 Codex 的第一层 harness。

### 3.2 Tool spec 决定模型能看到什么能力

`tool_registry_plan.rs` 和 `tool_spec.rs` 做的事，是把环境、配置、模型能力、特性开关，转换成“本轮真正暴露给模型的工具集合”。

关键点有三个：

- 每个工具都不是默认暴露，而是按配置、平台、session 状态动态决定。
- 每个工具都有 `supports_parallel_tool_calls` 这种元信息，后续并行执行直接依赖这个标志。
- 有些工具是本地函数工具，有些是 provider 原生工具：
  - `exec_command` / `shell` / `list_dir` / `read_mcp_resource` 是本地可执行能力。
  - `web_search` 是 Responses API 原生工具。

这套分离非常关键。它避免了“所有能力都塞进一个 agent prompt 里”的混乱。

### 3.3 Router / Registry / Orchestrator 三段式执行

执行路径大致是：

1. `ToolRouter` 把模型输出的 item 解析成 `ToolCall`
2. `ToolRegistry` 根据工具名找到 handler
3. `ToolOrchestrator` 统一处理审批、沙箱、重试、网络策略
4. handler 真正执行工具
5. `ToolOutput` 转回模型可以消费的 `ResponseInputItem`

这套设计把“工具语义”和“系统治理”解耦了：

- handler 只管做事
- orchestrator 管安全和环境
- router 管协议映射
- context/output 管返回格式

这就是典型的 harness engineering：把不可控的大模型，包在一层强约束的执行框架里。

## 4. 文件读取为什么能做到“渐进式披露”

### 4.1 它其实没有把“读取文件”设计成一个巨型万能工具

这是最容易误判的一点。

Codex 并不是依赖一个“给 path 就返回全部内容”的后端 `read_file` 接口完成代码阅读。它真实依赖的是几种组合能力：

- `list_dir`：有限深、分页地看目录结构
- `shell` / `exec_command`：执行 `rg --files`、`rg -n`、`sed -n`、`cat`、`tail`、`nl`、`awk`
- `read_mcp_resource`：读取 MCP 资源，不是默认的本地仓库文件路径读取
- 项目文档注入：`AGENTS.md`
- memory quick pass：`MEMORY.md` / rollout summaries

换句话说，Codex 的“读文件”本质上是：

`先列目录 -> 再搜关键词 -> 再局部读片段 -> 必要时扩读相邻块 -> 仍不够再读更多`

这就是渐进式披露。

### 4.2 Prompt 明确鼓励先缩小范围再读

在 prompt 里有两个特别关键的行为指令：

- 搜索优先用 `rg` / `rg --files`
- 不要用 Python 输出大段文件

这两条直接改变模型行为：

- 它不会一上来 `cat` 全仓库文件
- 它会先定位相关文件，再读局部
- 它更倾向 `sed -n '120,180p' file.ts` 这种“带上下文的切片读取”

也就是说，渐进式披露的第一责任人不是后端，而是 prompt。

### 4.3 `list_dir` 不是炫技，而是给“先看轮廓”提供低成本工具

`list_dir.rs` 的设计非常符合渐进式披露：

- 强制 `dir_path` 是绝对路径
- 支持 `offset`
- 支持 `limit`
- 支持 `depth`
- 输出目录树切片，而不是整棵树

这让模型可以先获取一个可控大小的目录视图，而不是把整个代码树一次性塞进上下文。

如果迁移到我们的项目，这个思想比“做一个 read_file”更重要：先给模型目录切片能力，再给内容切片能力。

### 4.4 安全白名单把“读文件”与“写文件”自动分流

`is_safe_command.rs` 是 Codex 渐进式披露能成立的另一个关键基础设施。

它把一批典型只读命令识别为 known safe，例如：

- `cat`
- `grep`
- `head`
- `tail`
- `ls`
- `nl`
- `find` 的安全子集
- `rg` 的安全子集
- `git status/log/diff/show/branch --show-current` 等只读子集
- `sed -n 1,5p file.txt` 这种只读形式

对 harness 的意义是：

- 用户无需频繁批准“读一眼文件”的动作
- 模型更愿意采用“小步读取”策略
- 读取和修改的审批成本被人为拉开

如果没有这一层，模型会更倾向少调用工具，或者一次调用读很多内容，反而不利于渐进式披露。

### 4.5 UI 把多次读取压缩成“探索轨迹”

`parse_command.rs` 和 `history_cell.rs` 非常重要，因为它们决定用户看到的不是一堆原始 shell 命令，而是语义化行为：

- `ParsedCommand::Search`
- `ParsedCommand::Read`
- `ParsedCommand::ListFiles`

它可以把下面这类命令：

- `rg shimmer_spans`
- `cat shimmer.rs`
- `cat status_indicator_widget.rs`

压缩展示成：

- `Explored`
  - `Search shimmer_spans`
  - `Read shimmer.rs, status_indicator_widget.rs`

甚至可以把跨多个调用的连续读取继续折叠成一组。这一点在快照测试里体现得非常明显：

- `coalesces_reads_across_multiple_calls.snap`
- `coalesces_sequential_reads_within_one_call.snap`

这里的设计精髓是：

- 模型可以保持底层能力原子化
- 用户看到的是高层语义摘要
- “渐进式披露”的过程可见，但不噪音

这正是我们当前项目缺的部分之一。我们现在更多是在显示“工具调用结果”，而 Codex 是在显示“探索行为”。

### 4.6 `read_file_tests.rs` 说明了另一个方向：块级读取，而不是全文读取

虽然主流程里不是靠一个单独的 `read_file` 大工具，但相关测试暴露出 Codex 对“读取”的理想形态：

- 支持按行范围读取
- 支持偏移和 limit
- 支持非 UTF-8 容错
- 支持超长行截断
- 支持 indentation/block 模式
- 支持向上展开父级块
- 支持是否带 sibling block

这说明 Codex 的目标不是“拿到文件全文”，而是“拿到当前推理所需的最小结构单元”。

这一点对代码阅读尤其关键。真正有价值的不是 `read file`，而是 `read slice` 与 `read block`。

### 4.7 Memory prompt 其实是 Codex 对“渐进式披露”最明确的文字表达

`core/templates/memories/read_path.md` 直接写出了 quick pass 规则：

1. 先看 summary
2. 再 grep `MEMORY.md`
3. 只有命中时再开 1-2 个 rollout/skill 文件
4. 只有在需要精确信息时才继续深挖
5. 查不到就停止

它甚至给了查询预算：

- 理想上 4-6 步内完成
- 不要全量扫 rollout summaries

这个 prompt 体现了 Codex harness 的核心思想：

- 默认小步探索
- 默认先缩小范围
- 默认只打开最相关的 1-2 个对象
- 默认把“继续展开”当作有成本的动作

这个模式完全值得迁移到我们的项目。

## 5. Codex 的 `web_search` 到底是怎么实现的

### 5.1 它不是本地搜索服务，而是原生 provider tool

在 `tool_spec.rs` 里，`web_search` 是 `ToolSpec::WebSearch`，不是一个需要本地 handler 执行的 function tool。

这个工具携带的配置包括：

- `external_web_access`
- `filters.allowed_domains`
- `user_location`
- `search_context_size`
- `search_content_types`

也就是说，Codex 对 `web_search` 的核心工作不是“自己去搜”，而是把 provider 所需的能力描述正确地传进去。

### 5.2 `web_search` 的执行者是 Responses API，不是 Codex 本地后端

从当前仓库实现看，Codex 本地没有一个“搜索网页并 fetch 页面正文”的 handler。相反，它做的是：

- 向 Responses API 暴露 `type = "web_search"` 的原生工具
- 配置 cached/live 模式
- 配置 allowed domains / location / context size
- 接收 provider 返回的 `web_search_call` 事件
- 把这些事件映射到本地 history/UI

这就是为什么 `tool_registry_plan.rs` 里 `web_search` 只是作为 spec 被 push 进去，而没有注册对应本地 handler。

### 5.3 Provider 返回的不是单一结果，而是动作流

`protocol/src/models.rs` 定义了 `WebSearchAction`，至少包含：

- `Search`
- `OpenPage`
- `FindInPage`
- `Other`

这很重要。说明原生 `web_search` 并不是“搜一下给摘要”这么简单，而是 provider 内部可以继续执行：

- 发起搜索
- 打开某个结果页
- 在结果页内查找模式

这正是你前面要求的那套行为链：

- 多搜索
- 打开页面
- 在页面里继续找信息

只是 Codex 没有在本地自己做，而是让 provider 工具自己完成。

### 5.4 Codex harness 负责把搜索过程可视化

`core/src/web_search.rs` 和 `event_mapping.rs` 负责把 provider 的动作转成适合展示的 detail：

- 搜索动作显示 query 或 query 列表首项
- open page 显示 URL
- find in page 显示 pattern + URL

在 UI 快照里，最终可视化是类似：

- `Searched example search query with several generic words to exercise wrapping`

也就是说，Codex 展示的是“本次 web_search 正在做什么”，而不是把一大坨原始搜索结果页 HTML 直接暴露给用户。

### 5.5 Cached / Live 模式是 per-turn 决定的，不是固定配置

`codex.rs` 里会根据本轮 sandbox policy 解析 `web_search_mode`：

- `read_only` 更偏向 cached
- `danger_full_access` 更偏向 live

这个设计说明 Codex 把 web search 看成“受环境与权限影响的检索能力”，而不是一个永远同配置开启的功能。

### 5.6 结论：Codex 的 `web_search` 不能被我们当前实现直接照抄

这点必须说清楚：

- Codex 的 `web_search` 依赖的是 Responses API 原生工具协议。
- 我们当前项目使用的是 OpenAI 兼容的 chat/completions 风格调用，不一定具备同等的原生 `web_search` 能力。
- 所以我们不能简单说“参考 Codex，把本地 Bing + fetch 改一改就行”。

如果要真的“参考 Codex”，正确做法有两条路：

1. 切到支持原生 `web_search` 的 Responses API / provider
2. 在本地模拟出同样的动作状态机：
  - `search`
  - `open_page`
  - `find_in_page`
  - 结果摘要压缩
  - UI 行为卡片

## 6. Prompt 设计为什么比工具本身更重要

### 6.1 Codex 把“阅读习惯”写进了系统提示词

Codex prompt 中最值得参考的，不是某一段优美措辞，而是这些非常工程化的行为规则：

- 先用 `rg` / `rg --files`
- 不要用 Python 输出大段文件
- 使用 `apply_patch`
- 用 preamble 告知下一步动作
- 复杂任务维护 plan
- 大任务持续更新用户进度

这些规则直接塑造了模型的探索策略。也因此，Codex 的文件读取可以主要靠通用 shell 工具，而不需要大量定制 read API。

### 6.2 Tool description 也承担了 prompt 的一部分职责

例如：

- `shell` / `shell_command` 的 description 明确要求：
  - 传 `workdir`
  - 不要轻易 `cd`
- `list_mcp_resources` / `list_mcp_resource_templates` 的 description 明确写：
  - 能用 resource / template 就优先别去 web search
- `tool_search` 的 description 明确写：
  - 对 app / connector 的工具发现要优先用它，而不是直接 list MCP resources

这是一种很强的 harness engineering 思路：

- 不把所有决策都塞进 system prompt
- 让每个工具描述也携带自己的使用边界与优先级

### 6.3 `AGENTS.md` 是分层注入的“局部规则”

`project_doc.rs` 做了一件很聪明的事：

- 从 project root 到 cwd，一路收集 `AGENTS.md`
- 按层级拼接
- 更深层目录的文档自然拥有更强的局部约束力

这意味着 Codex 不只是“一个全局 prompt”，而是：

- 全局行为 prompt
- 项目级工作规范
- 子目录级局部规范

这使得 agent 可以在很通用的 harness 下，仍然适应具体仓库的工作方式。

## 7. Codex harness engineering 的真正精髓

我认为有七条。

### 7.1 用小而稳的原子工具，不用大而全的神工具

Codex 更偏向：

- `list_dir`
- `rg --files`
- `rg -n`
- `sed -n`
- `cat`
- `read_mcp_resource`
- `tool_search`

而不是一个万能 `read_everything_and_summarize`。

原因很直接：

- 可组合
- 可控
- 易审批
- 易展示
- 易测试

### 7.2 把“正确行为”前移到 prompt，不把后端做成行为补丁

Codex 不是靠后端硬拦截来逼模型逐步读文件，而是：

- prompt 先告诉模型应该怎么探索
- 工具层再提供适合这种探索方式的能力

这是比“后端拿到 query 以后自动拼一堆搜索词、抓一堆页面、再替模型总结”更高明的方式，因为它保留了 agent 的主动性。

### 7.3 原生能力优先，少重复造 provider 轮子

`web_search` 最典型。

Codex 没有本地重写一个伪 web search，而是：

- 如果 provider 支持原生 web_search，就直接暴露
- 本地只做事件和配置适配

这能保证：

- 能力随 provider 升级
- 行为链更接近模型训练分布
- 本地实现复杂度更低

### 7.4 安全系统要奖励“小步探索”

只读命令自动通过，写命令要审批，这会自然把 agent 推向：

- 先看
- 再搜
- 再局部读
- 最后才改

这不是附属功能，而是推动渐进式披露成立的关键激励机制。

### 7.5 UI 要展示“探索语义”，不要展示“原始噪声”

Codex 没有把所有 shell 原文直接堆给用户，而是把它们转译成：

- Search
- Read
- List files
- Searched ...

这使得用户能 debug agent 行为，同时不会被大量底层命令细节淹没。

### 7.6 并行能力是显式元数据，不是隐式猜测

每个工具是否支持并行，由 `supports_parallel_tool_calls` 决定。

优点：

- 编排器不需要猜
- 工具作者可以自己声明约束
- 并行与串行是工具层面的 contract

这一点在我们当前项目也非常值得引入。

### 7.7 测试覆盖的是“协议 + UI +策略”，不是只测函数返回值

Codex 的测试不仅测 handler 逻辑，还测：

- web_search tool 是否正确出现在请求体里
- cached/live 配置是否正确透传
- `web_search_call` 事件是否被发出
- UI snapshot 是否把读取行为正确折叠
- 并行工具调用是否真的并行执行

这说明它测的是整条 harness，而不是孤立函数。这也是工程成熟度的来源。

## 8. 对我们项目的直接启示

### 8.1 文件读取不要继续停留在一个 `read_file` 工具上

更接近 Codex 的做法应该是拆成几层：

1. `list_dir`
  - 绝对路径
  - `offset` / `limit` / `depth`
2. `search_files`
  - query
  - path
  - limit
  - 类似 `rg -n`
3. `read_file_slice`
  - path
  - startLine
  - lineCount
4. `read_file_block`
  - path
  - anchorLine
  - mode = indentation / parent / sibling
5. 可选的 `read_reference_resource`
  - 用于 skill / docs / reference 这类结构化参考材料

这比现在“`read_file` 一次读一大段”更接近 Codex 思路。

### 8.2 渐进式披露要靠 prompt 驱动，不要只靠后端兜底

应该把下面这类原则直接写进我们的系统提示词：

- 先列目录或搜索，再读取内容
- 优先读取最相关片段，不要一次输出整文件
- 如果一个片段不足以判断，再继续扩读相邻片段
- 当你只是定位文件时，优先 `search/list` 而不是 `read`
- 不要把原始文件内容整段复制到最终回复

这一步如果不做，后端加再多读文件工具也很难让模型稳定形成好习惯。

### 8.3 Web Search 如果想真正“参考 Codex”，应优先切协议而不是继续堆自建爬虫

最理想路径：

1. 切换到支持 Responses API 原生 `web_search` 的 provider
2. 在前端展示 action 级别的卡片：
  - `search`
  - `open_page`
  - `find_in_page`
3. 只把精简后的搜索上下文喂回模型
4. 调试详情放在展开卡片里

如果暂时做不到，就要本地模拟 Codex 的行为链，而不是只做一个单步 `web_search(query)`：

- 生成多组 query
- 执行 search
- 选择命中页
- fetch/open page
- 必要时在页内 find pattern
- 将每个阶段作为独立 action 展示

### 8.4 UI 层应该从“工具结果卡片”升级到“探索轨迹卡片”

可直接参考 Codex 的表达方式：

- Search X
- Read a.ts, b.ts
- List src/components
- Open page https://...
- Find “admission score” in https://...

也就是说，卡片的主标题应该是“动作语义”，而不是工具名。

### 8.5 需要区分“模型上下文”和“调试展示”

这是我们当前项目已经踩过的坑。

Codex 的设计启示是：

- 用户看到的调试详情，可以更完整
- 送回模型的上下文，必须更压缩、更结构化

否则会出现两类问题：

- 上下文过大，模型容易掉到 fallback 或低质量回复
- 模型把原始抓取内容、引用块、工具结果标签原样吐回最终回答

## 9. 不该机械照抄的地方

### 9.1 Codex 的 `web_search` 依赖 provider 原生能力

我们当前项目如果仍停留在 chat/completions 风格调用，就算表面上做出 `web_search` 名字，也不等价于 Codex。

### 9.2 Codex 的文件探索大量借助 shell 安全体系

Codex 有成熟的：

- safe command 识别
- sandbox policy
- approval policy
- command parser
- UI 折叠

如果只抄其中一个“读文件动作”而没有这些配套层，效果会很差。

### 9.3 Codex 的 UI 是为代理轨迹设计的

它的快照测试、history cell、event mapping 都围绕“可追溯工具轨迹”构建。我们现在的卡片系统如果不升级事件模型，只做样式微调，学不到它的核心。

## 10. 我建议我们接下来怎么重写

如果目标是让当前项目真正吸收 Codex 的精髓，我建议按下面顺序推进。

### 第一步：重写文件探索链，而不是先重写搜索器

先做：

- `list_dir`
- `search_files`
- `read_file_slice`
- `read_file_block`
- 动作级 UI 卡片

原因是本地代码/skill/reference 的读取，比 web_search 更稳定、可控，也更容易先把“渐进式披露”的主体框架搭起来。

### 第二步：把 prompt 重写成 Codex 风格的工作约束

重点加入：

- 先搜索再读取
- 小步展开
- 不复制原始内容到最终回复
- 调试信息与最终回答分离
- 工具调用前后如何组织用户可见状态

### 第三步：重构 web_search 为 action pipeline

如果不能切原生 Responses API，就本地模拟：

- `search`
- `open_page`
- `find_in_page`

同时把每个 action 做成细粒度 timeline item，而不是一个笼统的 `web_search` 结果块。

### 第四步：补齐并行与压缩展示

参考 Codex：

- 工具声明自己是否支持并行
- 编排器统一并行/串行
- UI 对连续读取/连续搜索做折叠摘要

## 11. 最终判断

Codex 这套 harness engineering 的本质，可以概括成一句话：

> 用 prompt 把模型训练成“小步探索者”，用小工具把动作拆细，用安全和并行策略保证执行可控，再用 UI 把底层动作压缩成用户能看懂的探索轨迹。

所以我们接下来如果要“参考 Codex 重写”，正确方向不是：

- 再做一个更复杂的 `read_file`
- 再写一个更长的 `web_search` 爬虫函数

而应该是：

- 重写 agent 行为约束
- 重写工具颗粒度
- 重写 action 事件模型
- 重写调试轨迹展示

只有这样，最后出来的系统才会像 Codex，而不是只是在功能列表上多了几个同名按钮。