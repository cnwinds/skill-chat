# SkillChat Codex 化重构 TODO

**状态**: 进行中  
**最后更新**: 2026-04-10  
**关联方案**: `docs/SkillChat_Codex_Refactor_Plan.md`

## 1. 文档与阶段

- [x] 完成 `docs/Codex_Harness_Engineering_Analysis.md`
- [x] 完成 `docs/Codex_Tools_Deep_Analysis.md`
- [x] 完成 `docs/SkillChat_Codex_Refactor_Plan.md`
- [x] 将 TODO 重构为可执行阶段清单

## 2. 共享契约与时间线

- [x] 保持旧 `tool_*` 事件兼容
- [x] 保持等待态气泡与正文输出框切换逻辑稳定
- [x] 为 timeline 聚合增加新增工具类型测试覆盖
- [x] 确认 workspace / skill / artifact 工具轨迹可被现有时间线消费

## 3. 后端工具层

- [x] 拆分 `assistant-tool-service.ts`，抽出 catalog 与资源访问 helper
- [x] 保留现有 `web_search` / `web_fetch` 能力与并行语义
- [x] 补充 `list_workspace_paths`
- [x] 补充 `read_workspace_path_slice`
- [x] 补充 `list_skill_resources`
- [x] 补充 `read_skill_resource_slice`
- [x] 补充 `write_artifact_file`
- [x] 明确受控路径根目录与权限边界

## 4. 编排与模型规划

- [x] 更新 rule-based planner，对 workspace / skill 工具建立启发式规划
- [x] 更新 OpenAI planner prompt，使其优先内部文件工具，再按需走 shell/runtime
- [x] 保持现有 Skill runtime 主链路可用
- [x] 为新增工具补充 tool context 压缩策略
- [x] 让 assistant tool 生成的 artifact 能进入 `file` / `file_ready` 事件链

## 5. 前端展示

- [x] 为新增工具结果卡片提供可读摘要
- [x] 展开 `web_search` 时展示结果列表与页面摘要
- [x] 展开 workspace / skill 读取卡片时展示片段
- [x] 保持默认卡片一行压缩显示

## 6. 测试

- [x] 新增后端单元测试：workspace list/read
- [x] 新增后端单元测试：skill resource list/read
- [x] 新增后端单元测试：artifact write
- [x] 更新聊天编排测试，覆盖新增工具和调试轨迹
- [x] 更新前端 timeline / MessageItem 测试
- [x] 跑通 `npm test`
- [x] 跑通 `npm run typecheck`
- [x] 跑通 `npm run build`

## 7. 验收门槛

- [x] 模型可通过内部工具访问受控 workspace / session / skill 文件
- [x] 不依赖 shell 也能完成主要文件读取与报告落盘能力
- [x] shell 仅保留为可选扩展，不作为默认主路径
- [x] 工具轨迹可调试，且默认展示足够紧凑
- [x] 最终回答不回显“工具结果 / 上下文 / 引用资料”等原始调试信息
