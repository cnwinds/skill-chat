# SkillChat 对齐 Codex 改造表

**目标**: 在保留 SkillChat 产品约束的前提下，按 Codex 的思路收敛架构:

- 模型负责判断与编排
- 程序负责工具、边界、会话与权限
- Skill 只是说明书，不再有额外的“流程型 runtime 身份”
- 能力可配置，但尽量不要在 harness prompt 中硬编码流程偏好

## 对齐原则

1. 保留 SkillChat 的产品约束:
   - 会话只暴露用户已启用的 skill
   - 会话文件与产物继续保留明确的产品语义
2. 对齐 Codex 的架构原则:
   - Prompt 少干预
   - Tool registry 决定可用能力
   - 执行边界下沉到 sandbox / policy / runtime
   - 上下文管理按 token / compaction 驱动，而不是固定条数和字符数
3. 删除不必要的中间层:
   - 删除专用 skill runtime 流程约束
   - 删除 prompt 里的强路由偏好
   - 删除与通用工具重复的私有包装能力

## 完整改造表

| 模块 | 当前实现 | Codex 对齐目标 | 具体修改 | 主要文件 | 验证点 | 状态 |
|---|---|---|---|---|---|---|
| Harness Prompt | Prompt 里写死 `web_search` / `web_fetch` / 文件读取 / 产物写入优先级 | Prompt 只给出角色、工作方式、Skill 渐进式披露、边界说明 | 删除大部分流程性工具路由提示，只保留最小行为约束 | `apps/server/src/modules/chat/openai-harness-prompt.ts` | prompt test 覆盖移除项与保留项 | 已完成 |
| Skill 注入 | 已按启用 skill 注入，渐进式披露接近 Codex | 保留会话 allowlist，但继续贴近 Codex 的技能说明格式 | 保留当前会话 allowlist；不引入全局隐式 skill 暴露 | `apps/server/src/modules/chat/openai-harness-prompt.ts` `apps/server/src/modules/skills/skill-registry.ts` | 仅注入启用 skill；禁用 skill 不可见 | 待执行 |
| History/Context | 固定最近 16 条消息、单条 12k 截断、文件预览 8 条 | 改为 token/truncation/compaction 驱动 | 已完成 history builder、manual/pre-turn compact、mid-turn continuation compact 与 assistant replay；后续只剩增强项 | `apps/server/src/modules/chat/openai-harness-prompt.ts` `apps/server/src/modules/chat/openai-harness.ts` `apps/server/src/modules/chat/openai-harness-context.ts` `apps/server/src/modules/chat/session-context-store.ts` | 长对话不中途异常丢上下文；测试覆盖 | 已完成 |
| Tool Registry | 本地工具集由 harness 手工拼装，`run_workspace_script` 特殊追加 | 统一走工具注册视角，能力是否可用由配置和会话状态决定 | 抽出独立 tool catalog/builders，逐步收敛为通用工具集合 | `apps/server/src/modules/chat/openai-harness.ts` `apps/server/src/modules/tools/tool-catalog.ts` | 不同配置下工具暴露符合预期 | 进行中 |
| Web Search | Prompt 强提示优先搜索；服务端只有原生 `web_search` 调用 | 参考 Codex 的 `web_search_mode` 配置与能力暴露方式 | 引入 `web_search_mode` 配置，prompt 不再指导优先级 | `apps/server/src/config/env.ts` `apps/server/src/modules/tools/assistant-tool-service.ts` `apps/server/src/modules/chat/openai-harness.ts` | disabled/cached/live 行为可测 | 已完成 |
| Workspace/File Tools | 自定义 list/read 工具承担较多流程引导 | 保留产品需要的文件工具，但弱化流程干预 | 把“先 list 再 read”从 prompt 移到 tool description 或删除 | `apps/server/src/modules/tools/assistant-tool-service.ts` `apps/server/src/modules/tools/resource-access.ts` `apps/server/src/modules/chat/openai-harness-prompt.ts` | 文件读取仍可用，prompt 更轻 | 已完成 |
| Skill Script 执行 | `run_workspace_script` + `SessionRunner` + JSON 行协议 + outputs 扫描 | 对齐 Codex 的统一执行工具，不保留 skill 专用 runner 身份 | 中期目标是删除 `run_workspace_script`，改由通用执行工具接管；短期先减少 prompt 对该工具的依赖 | `apps/server/src/modules/chat/openai-harness.ts` `apps/server/src/core/runner/session-runner.ts` `apps/server/src/core/runner/runner-manager.ts` | 现有官方 skill 仍可运行；新模式测试通过 | 待执行 |
| Network Policy | 仅在工具层用 hostname/IP 做公网限制 | 对齐 Codex 的 policy/proxy 思路 | 先抽象为统一 `network policy` 检查接口，再决定是否引入代理层 | `apps/server/src/modules/tools/assistant-tool-service.ts` | 本地/私网访问继续被拒绝；策略可扩展 | 待执行 |
| Tool Loop | 固定 8 轮上限；局部 provider 兼容逻辑混在主循环 | 对齐 Codex 的 follow-up + compaction 驱动 | 已改为动态 follow-up continuation；模型请求数、工具调用总量、压缩次数分别独立熔断，不再由固定 8 轮主导 | `apps/server/src/modules/chat/openai-harness.ts` | 长工具链任务不中断；死循环仍能熔断 | 已完成 |
| Sampling Params | `verbosity=medium`、reasoning 由模型名正则判断 | 由模型能力和配置决定 | 把 verbosity / reasoning 提升为配置能力判断 | `apps/server/src/config/env.ts` `apps/server/src/modules/chat/openai-harness.ts` | 不同模型配置下请求体正确 | 待执行 |
| Artifact 语义 | `write_artifact_file` 和 runner outputs 继续是产品能力 | 保留产品能力，但不再让 prompt 过度指导 | 保留 artifact 能力；改为工具说明和服务端边界负责 | `apps/server/src/modules/tools/assistant-tool-service.ts` `apps/server/src/core/runner/session-runner.ts` | 产物仍可下载；无正文污染 | 待执行 |
| Docs/Test | 旧设计文档仍描述较多 SkillChat 特有流程 | 用新的对齐文档驱动重构并补测试 | 已更新上下文设计文档，新增 mid-turn compaction、assistant replay、动态 follow-up 回归测试 | `docs/SkillChat_Design_Dev.md` `docs/Context_Management_Design.md` `apps/server/src/**/*.test.ts` | 文档与实现一致，测试全绿 | 已完成 |

## 执行顺序

1. 收敛 harness prompt
2. 收敛 tool registry 与 web search 配置
3. 重构上下文管理与 tool loop
4. 重构 skill 执行入口
5. 收敛 network policy 与 artifact 说明
6. 补测试并更新设计文档

## 明确保留项

- 会话级 skill allowlist
- 会话 uploads / outputs / shared 产品语义
- 产物下载能力
- 路径边界与超时/中断

## 明确删除项

- Prompt 中的工具优先级编排
- 固定 16/12k/8 这类上下文硬编码
- skill 专用流程性叙述
- 最终架构中的 `run_workspace_script` 特殊地位
