# Codex 工具体系深度分析

## 1. 这份文档解决什么问题

上一份分析 `docs/Codex_Harness_Engineering_Analysis.md` 重点解释了 Codex 的 harness engineering 机制。本篇聚焦一个更具体的问题：

> Codex 到底有哪些工具？这些工具如何分类？哪些是真正本地执行的？哪些只是 provider 原生 tool 的暴露？哪些是动态注入的？为什么同一个会话里工具集合不是固定的？

这个问题如果不拆开，最容易产生三种误解：

1. 误以为 Codex 的工具就是几个 shell 工具。
2. 误以为 `web_search` 和 `tool_search` 是一类东西。
3. 误以为 Codex 的工具清单是写死的。

实际上，Codex 的工具系统是分层、可裁剪、可延迟加载、可并行执行、可协议适配的一整套体系。

## 2. 先给总图：Codex 的工具不是一个列表，而是五层结构

从 `codex-rs/tools/src/lib.rs`、`tool_registry_plan.rs`、`core/src/tools/spec.rs` 可以看出，Codex 的工具体系可以分成五层：

### 第一层：内建稳定工具

这类工具由 Codex 自己定义、自己维护、自己执行，属于默认主干能力，例如：

- `shell`
- `shell_command`
- `exec_command`
- `write_stdin`
- `apply_patch`
- `update_plan`
- `request_user_input`
- `request_permissions`
- `view_image`
- `list_dir`
- `js_repl`
- `js_repl_reset`

### 第二层：原生 provider 工具

这类工具不是 Codex 本地 handler 在执行，而是 Codex 只把 tool spec 暴露给模型，由 provider 执行：

- `web_search`
- `image_generation`
- `local_shell` 也更接近 provider 协议项而不是普通 function tool

这里尤其要注意 `web_search`，它不是本地爬虫实现。

### 第三层：发现型工具

这类工具的作用不是直接解决用户任务，而是帮助模型“发现后续要用的工具”：

- `tool_search`
- `tool_suggest`

这两个是 Codex 非常有代表性的设计，它把“发现工具”单独设计成一类能力，而不是让模型盲猜全量工具。

### 第四层：协作/代理工具

这类工具服务于多 agent 编排：

- `spawn_agent`
- `send_input`
- `send_message`
- `followup_task`
- `resume_agent`
- `wait_agent`
- `close_agent`
- `list_agents`
- `spawn_agents_on_csv`
- `report_agent_job_result`

这部分是 Codex 和普通代码助手差异最大的地方之一。

### 第五层：外部注入工具

这类工具不是 Codex 固定内建的，而是运行时被注入：

- MCP tools
- deferred MCP tools
- dynamic tools

也就是说，Codex 工具面并不是“内建工具 + 完事”，而是“内建工具 + 外部生态接入层”。

## 3. 工具清单全貌：按功能域拆开

下面按功能域做一次完整归类。

## 4. 本地执行与环境交互工具

### 4.1 `shell`

来源：

- `codex-rs/tools/src/local_tool.rs`

作用：

- 执行 shell 命令
- 参数是命令数组
- 通常要求显式传 `workdir`

特征：

- function tool
- 支持并行
- handler 为 `Shell`
- 偏简洁、偏传统 execvp 风格

定位：

- 适合短平快的无状态命令
- 是 Codex 最基础的探索工具之一

### 4.2 `shell_command`

来源：

- `codex-rs/tools/src/local_tool.rs`

作用：

- 执行字符串形式的 shell script
- 比 `shell` 更接近“给 shell 一段完整命令”

特征：

- function tool
- 支持并行
- handler 为 `ShellCommand`

定位：

- 适合模型更自然地产生一段命令脚本
- 在启用 `ShellZshFork` 或某些模型组合时常被选作主要 shell 能力

### 4.3 `exec_command`

来源：

- `codex-rs/tools/src/local_tool.rs`
- handler 在 `core/src/tools/handlers/unified_exec.rs`

作用：

- 在 PTY 中运行命令
- 支持 session 化交互
- 可以返回 ongoing session id

关键参数：

- `cmd`
- `workdir`
- `shell`
- `tty`
- `yield_time_ms`
- `max_output_tokens`
- `login`
- `sandbox_permissions`
- `additional_permissions`
- `justification`
- `prefix_rule`

特征：

- function tool
- 支持并行
- 能和 `write_stdin` 组合形成持续交互会话

定位：

- 这是 Codex 里最强的命令执行能力
- 比 `shell` / `shell_command` 更接近“交互式终端”

### 4.4 `write_stdin`

来源：

- `codex-rs/tools/src/local_tool.rs`

作用：

- 向 `exec_command` 打开的会话写入 stdin
- 或空轮询最新输出

特征：

- function tool
- 不支持并行
- 依附于 `exec_command` 的 session 机制

定位：

- 让模型不仅能“运行一个命令”，还能“接着操作正在运行的命令”

### 4.5 `local_shell`

来源：

- `tool_spec.rs`
- 路由在 `router.rs` 里通过 `ResponseItem::LocalShellCall` 做协议适配

作用：

- 属于 provider 协议级 local shell call
- 不是普通 JSON function tool

定位：

- 它是“协议兼容层”的一部分，不应和 `shell` 混为一谈

## 5. 文件系统与本地资源工具

### 5.1 `list_dir`

来源：

- `codex-rs/tools/src/utility_tool.rs`
- handler 在 `core/src/tools/handlers/list_dir.rs`

作用：

- 列目录
- 支持 `offset` / `limit` / `depth`
- 要求绝对路径

特征：

- function tool
- 支持并行
- 是渐进式披露里“先看轮廓”的关键工具

重要性：

- 这是 Codex 工具里非常值得我们迁移的一项，因为它比“直接 read_file”更符合小步探索。

### 5.2 `view_image`

来源：

- `codex-rs/tools/src/view_image.rs`

作用：

- 查看本地图片
- 返回 data URL
- 可选 `detail = original`

特征：

- function tool
- 支持并行

定位：

- 不是图像生成，而是图像读取/理解前置工具

### 5.3 `read_mcp_resource`

来源：

- `codex-rs/tools/src/mcp_resource_tool.rs`
- handler 在 `core/src/tools/handlers/mcp_resource.rs`

作用：

- 读取 MCP server 提供的 resource

参数：

- `server`
- `uri`

特征：

- function tool
- 支持并行
- 不是本地 repo 文件读取，而是外部 MCP 资源读取

### 5.4 `list_mcp_resources`

作用：

- 列出 MCP server 的资源
- 可分页

定位：

- 资源发现，不是直接读取

### 5.5 `list_mcp_resource_templates`

作用：

- 列出参数化资源模板

定位：

- 对于带参数的资源发现层

### 关于“本地文件读取工具”的一个关键结论

Codex 没有把“本地文件读取”设计成一个核心大 function tool。它主要依赖：

- `list_dir`
- `shell` / `shell_command` / `exec_command`
- `rg --files`
- `rg -n`
- `sed -n`
- `cat`
- `nl`
- `tail`

也就是说：

- 本地文件探索主要靠 shell 能力
- MCP resource 负责补充结构化外部资源
- UI 再把连续读取折叠成更可读的轨迹

这点很关键，说明 Codex 的核心不是 `read_file tool`，而是“读文件工作流”。

## 6. 编辑与工作流控制工具

### 6.1 `apply_patch`

来源：

- `codex-rs/tools/src/apply_patch_tool.rs`

形态：

- freeform grammar tool
- 或 JSON function tool

为什么有两种形态：

- GPT-5 系列更适合 freeform grammar
- 某些模型或兼容模式下退化为 JSON function tool

定位：

- 这是 Codex 的主编辑能力，不是 shell 里 `sed -i`
- 它是受控、可验证、易审查的变更接口

### 6.2 `update_plan`

来源：

- `codex-rs/tools/src/plan_tool.rs`

作用：

- 更新任务计划
- 把 plan 状态作为结构化事件流的一部分

定位：

- 它不是业务工具，而是 agent 自我管理工具
- 属于 harness 的“认知外显化”机制

### 6.3 `request_user_input`

来源：

- `codex-rs/tools/src/request_user_input_tool.rs`

作用：

- 请求用户在 UI 中做 1-3 个短问题回答
- 支持推荐选项

定位：

- 这是 agent 在默认自主执行之外，主动向用户结构化澄清的机制

### 6.4 `request_permissions`

来源：

- 在 `local_tool.rs` 导出
- 属于权限/审批相关工具

作用：

- 当普通沙箱能力不足时，请求额外权限

定位：

- 这是 Codex 对“模型申请升级权限”的显式接口
- 配合 orchestrator、approval policy 一起工作

## 7. 搜索与发现工具

这一类工具最容易混淆，必须拆开。

### 7.1 `web_search`

来源：

- `codex-rs/tools/src/tool_spec.rs`

本质：

- provider 原生工具，不是本地 handler

可配置项：

- `external_web_access`
- `filters.allowed_domains`
- `user_location`
- `search_context_size`
- `search_content_types`

特征：

- 不注册本地 handler
- 不支持并行
- provider 会以 `web_search_call` action 形式回传事件

重要结论：

- 它不是我们当前项目里那种“本地 search + fetch”函数
- Codex 本地只负责暴露 spec、记录动作、展示轨迹

### 7.2 `tool_search`

来源：

- `codex-rs/tools/src/tool_discovery.rs`
- handler 在 `core/src/tools/handlers/tool_search.rs`

作用：

- 对 deferred MCP tools 做 BM25 检索
- 找到后为“下一次模型调用”提供匹配工具命名空间

特征：

- type 是 `tool_search`，不是普通 function tool
- execution = `client`
- 支持并行
- 结果不是普通文本，而是 namespace 下的 deferred tools 列表

本质定位：

- 这是“搜索工具”，不是“搜索网页”
- 它服务的是工具发现，不是信息检索

### 7.3 `tool_suggest`

来源：

- `tool_discovery.rs`

作用：

- 当当前工具不够用时，给模型推荐可安装/可启用的 connector 或 plugin

定位：

- 这是生态扩展建议器
- 它不是执行器，不是搜索器，而是“能力拓展建议器”

### 三者的根本区别

- `web_search`：搜外部信息
- `tool_search`：搜尚未加载的工具
- `tool_suggest`：建议引入新的工具来源

这三个在 Codex 里是严格分开的。

## 8. JavaScript 执行工具

### 8.1 `js_repl`

来源：

- `codex-rs/tools/src/js_repl_tool.rs`

作用：

- 在持久 Node kernel 中执行 JS
- 支持 top-level await
- 以 freeform grammar 形式输入原始 JS

为什么重要：

- 它不是“另一个 shell”
- 它是让模型在受控运行时里做更复杂程序化推理的工具

关键能力：

- 持久绑定
- `codex.tool(...)` 桥接其他工具
- `codex.emitImage(...)` 输出图像

### 8.2 `js_repl_reset`

作用：

- 重置 js_repl kernel

定位：

- 生命周期控制工具

## 9. 图像生成工具

### 9.1 `image_generation`

来源：

- `tool_spec.rs`

本质：

- provider 原生工具

作用：

- 生成图像

特征：

- 不走本地 handler
- 是否暴露取决于 auth、feature、model modality 支持

## 10. 协作与多代理工具

这一类是 Codex 最复杂的工具域。

### 10.1 `spawn_agent`

版本：

- v1
- v2

作用：

- 创建子 agent

区别：

- v2 更强调 canonical task name 与 mailbox/树状协作
- v1 更偏传统 id 驱动

### 10.2 `send_input`

作用：

- 给已有 agent 发消息
- 可 `interrupt`

适用：

- v1 协作模型

### 10.3 `send_message`

作用：

- 向已有 agent 邮箱追加消息，不强制立刻起新 turn

适用：

- MultiAgentV2

### 10.4 `followup_task`

作用：

- 给非 root agent 发后续任务
- 可以触发目标 turn

### 10.5 `resume_agent`

作用：

- 恢复已关闭 agent

### 10.6 `wait_agent`

版本：

- v1：等待最终状态
- v2：等待 mailbox update / final notification

### 10.7 `close_agent`

版本：

- v1 / v2

作用：

- 关闭 agent 与子孙

### 10.8 `list_agents`

作用：

- 列当前 root thread 树中的 live agents

### 10.9 `spawn_agents_on_csv`

作用：

- 基于 CSV 批量生成 agent 任务

### 10.10 `report_agent_job_result`

作用：

- agent jobs worker 回报结果

### 这一组工具的真正定位

这组工具不是一般意义上的业务工具，而是 Codex 把“多代理协作”系统化后暴露给模型的编排接口。

它们说明：

- Codex 的工具体系不只是“环境操作工具”
- 还包含“社会化组织工具”

## 11. 测试与内部辅助工具

### 11.1 `test_sync_tool`

来源：

- `utility_tool.rs`

作用：

- 并发测试中的 barrier / sleep 同步辅助

性质：

- internal helper
- 不属于最终产品能力面

但它说明了一点：

- Codex 连“工具并行性”本身都通过专用工具做集成测试

## 12. 外部注入工具：MCP tool 与 dynamic tool

## 13. MCP tool

来源：

- `mcp_tool.rs`
- `core/src/tools/spec.rs`

机制：

- 把 MCP tool schema 转成 Responses API function tool
- 注册为 `ToolHandlerKind::Mcp`

特征：

- 不是固定内建名字
- 工具名来源于外部 MCP server
- 可以是立即可见，也可以 deferred

这意味着：

- Codex 的工具面天然支持外部能力生态
- 不是靠改 core 源码来新增每个业务工具

## 14. Deferred MCP tool

这是 Codex 工具体系最聪明的部分之一。

机制：

- 工具本身先不全量暴露给模型
- 只暴露 `tool_search`
- 模型先搜索匹配的 MCP 工具
- 返回 namespace/deferred tool 描述
- 下一次调用再真正使用

价值：

- 降低 prompt 中一次暴露的工具数量
- 降低模型选错工具的概率
- 让 connector/app 的工具规模能扩展

如果未来我们也想接更多 skills / plugins / app connectors，这个模式非常值得借鉴。

## 15. Dynamic tool

来源：

- `dynamic_tool.rs`

机制：

- 运行时提供 `DynamicToolSpec`
- 转为标准 `ToolDefinition`
- 注入统一 registry

意义：

- Codex 工具系统并不要求所有工具在编译期静态确定
- 只要能给出 schema 与 description，就能挂到同一套调度链路

## 16. 工具的四种技术形态

从协议视角看，Codex 工具至少有四种形态。

### 16.1 Function tool

典型：

- `shell`
- `exec_command`
- `list_dir`
- `update_plan`
- `view_image`

特点：

- JSON schema 输入
- 本地 handler 或外部 handler 执行

### 16.2 Freeform tool

典型：

- `apply_patch` freeform
- `js_repl`

特点：

- 输入不是 JSON，而是 grammar 定义的自由文本
- 更适合 patch / code / program source 这类内容

### 16.3 Provider-native tool

典型：

- `web_search`
- `image_generation`
- `local_shell`

特点：

- 本地不负责核心执行
- 本地更像 spec builder 与 event mapper

### 16.4 Discovery tool

典型：

- `tool_search`
- `tool_suggest`

特点：

- 工具的输出是“下一步可用的工具能力”
- 不是直接面向最终任务结果

## 17. 工具并行语义是显式声明的

Codex 不是运行时猜测“哪些工具能并行”，而是在 `tool_registry_plan.rs` 中显式标注每个 tool spec：

- `supports_parallel_tool_calls = true`
- `supports_parallel_tool_calls = false`

再由 `core/src/tools/parallel.rs` 根据这个标记决定：

- 并行工具拿 `read lock`
- 串行工具拿 `write lock`

典型支持并行的工具：

- `shell`
- `shell_command`
- `exec_command`
- `list_dir`
- `view_image`
- `tool_search`
- `list_mcp_resources`
- `read_mcp_resource`

典型不支持并行的工具：

- `web_search`
- `image_generation`
- `apply_patch`
- `update_plan`
- 多 agent 控制工具
- `write_stdin`

这说明 Codex 的并行不是“临时优化”，而是工具 contract 的一部分。

## 18. 工具集合为什么不是固定的

`ToolsConfig` 决定了本轮到底给模型哪些工具，影响因素包括：

- model capability
- feature flags
- auth 状态
- sandbox policy
- session source
- collaboration mode
- environment 是否存在
- web search mode
- image generation entitlement
- js_repl 开关
- code mode 开关
- multi-agent v1/v2 开关
- plugin/app discovery 开关

这意味着：

- 两个不同模型，工具面可能不同
- 同一个模型在不同 sandbox policy 下，`web_search` 模式不同
- 有的会话没有 `exec_command`
- 有的会话没有 `image_generation`
- 某些子 agent 会额外看到 agent jobs worker tools

所以“Codex 有哪些工具”这个问题，正确答案不是一个固定数组，而是一套“按条件生成的工具面”。

## 19. Codex 工具体系的设计哲学

通过整套实现可以总结出六条哲学。

### 19.1 把工具分成“做事工具”和“找工具工具”

很多系统只有前者。Codex 同时有：

- 执行工具
- 发现工具
- 建议工具

这让大规模工具生态成为可能。

### 19.2 把工具分成“本地执行”和“provider 原生”两条通路

这避免了不必要地重造 provider 能力。

### 19.3 把工具暴露与工具执行拆开

`ToolSpec` 负责暴露，`handler` 负责执行，`orchestrator` 负责治理。

### 19.4 把并行能力做成元数据

这让调度更稳、更可测试。

### 19.5 把扩展能力外包给 MCP / dynamic tools

Codex 核心不需要知道所有业务工具。

### 19.6 把用户看到的工具轨迹重新语义化

用户看到的是：

- 搜索
- 读取
- 打开页面

而不是一堆底层 JSON。

## 20. 对我们项目的直接启示

如果我们想参考 Codex，不该只学“加几个工具名”，而要学它的工具体系设计。

### 20.1 我们需要先做工具分类，不要把所有能力都塞到 `assistant-tool-service`

至少应该拆成：

- 本地文件探索工具
- Web 信息检索工具
- 参考资料/skill 资源工具
- 工作流控制工具
- 未来可扩展工具

### 20.2 要单独设计“发现型工具”

如果未来 skill、plugin、connector 增多，不能让模型一上来面对几十上百个工具。应考虑：

- `tool_search`
- 延迟加载 skill/tool

### 20.3 要区分 provider 原生工具和本地模拟工具

例如：

- 真正的 `web_search`
- 本地 fallback 的 `search + fetch + find`

这两个应该在架构上分清，否则后续很难演进。

### 20.4 要给每个工具声明并行语义

这会比现在在业务代码里手工判断“某些 web 工具并行、某些文件工具串行”更可维护。

### 20.5 要给 UI 一个“动作层”

前端主视图不应该只显示：

- 工具名
- 参数
- 原始结果

而应该优先显示：

- Search query
- Open page
- Find in page
- Read file slice
- Read reference file

这样才接近 Codex 的可调试性和可读性平衡。

## 21. 最终结论

Codex 的“有哪些工具”，不能用一句“它有 shell、web_search、read_file”来概括。

更准确的说法是：

- 它有一组稳定内建工具，负责本地执行、编辑、计划、审批、图像查看、目录探索。
- 它有一组 provider 原生工具，负责网页搜索、图像生成、某些协议级 shell 行为。
- 它有一组发现型工具，负责搜索尚未加载的工具和建议新增能力来源。
- 它有一组协作工具，把多 agent 组织能力也纳入了工具面。
- 它还能把 MCP tools 与 dynamic tools 在运行时注入同一套注册表。
- 它通过 `ToolsConfig` 与 `ToolRegistryPlan` 每轮动态裁剪工具面，通过并行标记决定调度策略，通过 UI 重新语义化展示工具轨迹。

所以真正值得我们学的，不是某一个工具，而是这整套“工具地图 + 暴露策略 + 执行策略 + 展示策略”。