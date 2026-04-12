# Codex Mid-Turn Steering TODO

## 目标

- 在 assistant 正在运行时，继续发送消息。
- 所有运行中追加消息统一进入单一待处理队列，严格 FIFO。
- runtime 内部可以优先吸收到当前 turn；不可吸收时自动排到下一 turn，但这些分流细节不暴露给 UI。
- 支持显式中断当前 turn。
- 前端只展示一个底部待处理队列；只有真正 commit 给模型后，消息才进入聊天流。
- 增加完整自动化测试并跑到全绿。

## 待办清单

- [x] 完成基于当前项目的设计文档
- [x] 创建实现 TODO 文档
- [x] 扩展 shared 协议
  - [x] SSE turn 生命周期事件
  - [x] runtime snapshot 类型
  - [x] start / steer / interrupt 请求响应 schema
- [x] 实现后端 turn runtime
  - [x] session turn registry
  - [x] active turn / pending steer / queued follow-up
  - [x] interrupt 状态流转
- [x] 改造 ChatService
  - [x] 接入 runtime
  - [x] 同 turn steer 持久化与 drain
  - [x] queued follow-up 自动启动
  - [x] turn lifecycle SSE 广播
- [x] 改造 OpenAIHarness
  - [x] round boundary drain steer
  - [x] 支持外部 AbortSignal
- [x] 改造通用模型流
  - [x] `ChatModelClient` 支持 signal
  - [x] OpenAI Responses 支持外部 signal
  - [x] 非 harness 路径支持 interrupt
- [x] 新增服务端 API
  - [x] `GET /api/sessions/:id/runtime`
  - [x] `POST /api/sessions/:id/turns/:turnId/steer`
  - [x] `POST /api/sessions/:id/turns/:turnId/interrupt`
- [x] 改造前端运行态
  - [x] active turn store
  - [x] 底部单队列输入预览
  - [x] 运行中继续发送
  - [x] interrupt 按钮
- [x] 补齐测试
  - [x] shared / schema 覆盖
  - [x] chat service runtime 测试
  - [x] openai harness steer 测试
  - [x] app route API 测试
  - [x] web 交互测试
- [x] 跑通相关测试并修复到全绿

## 二阶段补齐

- [x] 非 regular turn steer 策略
  - [x] `review / compact / maintenance` turn kind
  - [x] 非 regular turn steer 自动降级为 queued
- [x] 更细粒度的运行态
  - [x] `sampling / tool_call / waiting_tool_result / streaming_assistant / finalizing / non_steerable`
  - [x] runtime round 计数与 SSE 同步
- [x] runtime snapshot 持久化与恢复
  - [x] `turn-runtime.json` 磁盘快照
  - [x] registry 启动时恢复
  - [x] 进程重启后 pending / queued 输入恢复展示
- [x] 非 harness 路径 same-turn continuation
  - [x] 纯文本回复链路在 boundary 后继续同 turn
  - [x] skill runner summary 后继续同 turn
- [x] runner abort 真正生效
  - [x] 队列等待支持 signal
  - [x] 子进程 `SIGTERM` / `SIGKILL` 终止
- [x] 前端恢复态与 richer runtime 展示
  - [x] recovery 提示
  - [x] turn kind / phase / round 展示
- [x] 二阶段自动化测试
  - [x] runtime recovery 单测
  - [x] plain-text continuation 单测
  - [x] app 重启恢复集成测试
  - [x] runner abort 测试
  - [x] web recovery 渲染测试

## 单队列纠偏

- [x] 去掉前端“继续引导 / 排到下一轮”的显式分支
- [x] 运行中追加消息统一通过 `/api/sessions/:id/messages` + `dispatch: auto`
- [x] runtime snapshot 对外统一暴露 `followUpQueue`
- [x] 队列预览移到底部，且在真正 `user_message_committed` 前不进入聊天记录
- [x] 一旦已有排队项，后续输入不得重新插回当前 turn，保证 FIFO
- [x] 补齐前后端回归测试并验证通过
