# SkillChat 设计开发文档

**版本**: v0.1  
**日期**: 2026-04-09  
**状态**: Draft  
**依据文档**: `docs/SkillChat_PRD.md`

---

## 1. 文档目标

本文档用于将 PRD 转换为可直接落地的工程设计方案，覆盖：

- V0.1 MVP 的系统边界、模块拆分与目录结构
- 前后端接口契约、数据存储与 Skill 执行模型
- 移动端优先的聊天体验设计，重点覆盖微信浏览器
- 开发顺序、测试策略、上线要求与验收标准

本文档不追求“大而全”，而是为两周内完成 MVP 提供可执行方案。

> 说明：本文档仍保留部分早期设计内容。当前正在进行中的 harness / tool registry / skill 对齐改造，以 `docs/Codex_Alignment_Refactor_Table.md` 为准。

---

## 2. 设计范围

### 2.1 V0.1 MVP 范围

- 邀请码注册、登录、JWT 鉴权
- 会话创建、会话列表、历史消息加载
- 移动端优先聊天界面，兼容桌面浏览器
- SSE 流式回复
- 文件上传、文件下载、会话产出展示
- 内置 3 个 Skill：`pdf`、`xlsx`、`docx`
- SessionRunner 进程内执行模型
- SQLite + 本地磁盘持久化

### 2.2 非目标

- 用户自定义 Skill 上传
- MCP 外部工具协议接入
- 微信 OAuth 登录
- 对象存储、分布式部署、容器级沙箱
- 管理后台 Web 界面

说明：PRD 提到管理员生成邀请码。V0.1 不做后台页面，改为提供 CLI 管理命令生成邀请码，减少实现面。

---

## 3. 关键设计决策

### 3.1 仓库结构

推荐采用单仓结构，前后端分目录管理：

```text
/
├── apps/
│   ├── server/                  # Fastify 服务
│   └── web/                     # React + Vite 前端
├── packages/
│   └── shared/                  # 共享类型、schema、常量
├── skills/                      # Skill 仓库
├── data/                        # 本地开发数据目录
├── docs/
└── docker-compose.yml
```

这样可以：

- 共享 TypeScript 类型，减少前后端事件定义漂移
- 保持部署仍为单机单仓，不引入额外 monorepo 复杂度
- 后续增加新 Skill、脚本和资源目录时不影响应用代码结构

### 3.2 技术栈落地

| 领域 | 选择 | 说明 |
|---|---|---|
| 前端框架 | React + Vite + TypeScript | 启动快，适合 SPA |
| 样式 | TailwindCSS | 适合快速搭建移动端界面 |
| 路由 | React Router | 足够支撑登录页与主应用壳 |
| 服务端状态 | TanStack Query | 处理会话、文件、技能列表缓存 |
| 本地 UI 状态 | Zustand | 管理当前会话、抽屉状态、流式过程态 |
| 流式协议 | SSE + `@microsoft/fetch-event-source` | 可携带 JWT Header，支持自动重连 |
| 后端框架 | Fastify | 性能好，插件体系清晰 |
| DB | SQLite + `better-sqlite3` | 单机部署简单，读写性能足够 |
| 校验 | Zod | 前后端共享 schema |
| 日志 | Pino | 结构化日志 |
| 进程调度 | Node `child_process.spawn` + semaphore | 满足 SessionRunner 需求 |

### 3.3 Skill 调用边界

V0.1 不允许模型直接输出任意 shell 命令。LLM 只能生成结构化 `tool_call`，后端再映射为受控脚本执行：

- 允许调用已注册 Skill 的预定义入口脚本
- 允许读取当前会话和共享目录中的已授权文件
- 不允许模型直接拼接命令串
- 不允许访问会话目录之外的用户数据

这样可以显著降低注入风险，并保证脚本运行路径可审计。

### 3.4 `thinking` 事件定义

PRD 中有 `thinking` 消息类型。V0.1 不展示原始推理链，而是展示“可公开的阶段性状态”，例如：

- 正在分析需求
- 正在检查可用文件
- 准备调用 `pdf` Skill
- 正在生成文件

这既满足用户对进度可见性的需求，也避免泄露模型内部推理。

### 3.5 文件目录规范

PRD 在“用户 uploads 根目录”和“上传到当前会话 uploads/”之间存在歧义。V0.1 统一采用以下目录：

```text
/data/users/{uid}/
├── sessions/
│   └── {session_id}/
│       ├── meta.json
│       ├── messages.jsonl
│       ├── uploads/
│       ├── outputs/
│       └── tmp/
├── shared/
└── trash/
```

解释：

- 当前会话上传文件存入 `sessions/{sid}/uploads/`
- 当前会话生成文件存入 `sessions/{sid}/outputs/`
- 用户手动“移动为共享文件”后，复制或移动到 `shared/`
- `tmp/` 用于 Skill 执行过程中的临时中间文件

该结构更贴近会话隔离，也更容易实现“当前会话上下文自动注入”。

---

## 4. 总体架构

### 4.1 逻辑分层

```text
Web App
  -> API Layer
    -> Auth / Session / Chat / File / Skill Routes
      -> Domain Services
        -> LLM Client / Skill Registry / Runner Manager / Storage
          -> SQLite / Local FS / Skill Scripts
```

### 4.2 核心模块职责

| 模块 | 职责 |
|---|---|
| `AuthService` | 注册、登录、密码 hash、JWT 签发 |
| `InviteService` | 邀请码校验与消费 |
| `SessionService` | 会话创建、列表、标题维护、更新时间 |
| `MessageStore` | `messages.jsonl` 读写、回放、截断加载 |
| `ChatService` | 消息主流程编排，驱动 LLM 与 Skill |
| `StreamHub` | 管理每个 session 的 SSE 连接与事件广播 |
| `SkillRegistry` | 启动时扫描 Skill 元数据 |
| `SkillLoader` | 按需加载完整 `SKILL.md` 与 references |
| `RunnerManager` | 管理并发队列、活跃 SessionRunner 缓存 |
| `SessionRunner` | 在会话目录下运行 Skill 脚本，监听进度与产出 |
| `FileService` | 上传、下载、归档、文件索引与权限检查 |
| `CleanupJob` | 处理 Runner 回收、临时文件清理、配额扫描 |

### 4.3 建议目录结构

```text
apps/server/
├── src/
│   ├── app.ts
│   ├── config/
│   ├── plugins/
│   ├── routes/
│   ├── modules/
│   │   ├── auth/
│   │   ├── invite/
│   │   ├── sessions/
│   │   ├── chat/
│   │   ├── files/
│   │   └── skills/
│   ├── core/
│   │   ├── llm/
│   │   ├── runner/
│   │   ├── storage/
│   │   ├── stream/
│   │   └── prompt/
│   ├── db/
│   │   ├── migrations/
│   │   └── sqlite.ts
│   └── scripts/
│       └── create-invite.ts
└── package.json
```

```text
apps/web/
├── src/
│   ├── app/
│   ├── routes/
│   ├── components/
│   ├── features/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── files/
│   │   ├── sessions/
│   │   └── skills/
│   ├── stores/
│   ├── hooks/
│   ├── lib/
│   └── styles/
└── package.json
```

---

## 5. 后端详细设计

### 5.1 Fastify 插件与路由

建议拆分为以下路由：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id/messages`
- `POST /api/sessions/:id/messages`
- `GET /api/sessions/:id/stream`
- `GET /api/files`
- `GET /api/files/:fileId/download`
- `POST /api/files/:sessionId/upload`
- `POST /api/files/:fileId/share`
- `GET /api/skills`

说明：

- `GET /api/files` 是对 PRD 的补充，用于文件面板按用户维度聚合查询
- 下载接口建议改为 `fileId`，避免文件名冲突与路径穿越问题
- 如需兼容 PRD 里的 `/:session_id/:filename` 路由，可在服务端提供 alias，但前端主流程应走 `fileId`

### 5.2 ChatService 主流程

`POST /api/sessions/:id/messages` 的服务端流程：

1. 鉴权并校验当前用户是否拥有该 session。
2. 将用户消息写入 `messages.jsonl`。
3. 通过 `StreamHub` 广播 `thinking` 事件：例如“正在分析需求”。
4. 读取最近 N 条消息、当前会话文件列表、共享文件列表、所有 Skill 元数据。
5. 调用 Router Prompt 判断：
   - 是否为普通对话
   - 是否需要 Skill
   - 是否需要先澄清问题
6. 若为普通对话，直接流式生成文本回复。
7. 若需 Skill，按需加载目标 Skill 的完整 `SKILL.md` 和 references，生成结构化执行计划。
8. 调用 `RunnerManager.execute(runSpec)` 执行脚本。
9. 将脚本进度、stdout 日志摘要和产出文件通过 SSE 广播。
10. 将最终 assistant 总结消息写入 `messages.jsonl` 并广播 `done`。

### 5.3 两阶段 Prompt 设计

为降低 token 消耗与误触发，建议采用两阶段：

#### 阶段一：Intent Router

输入：

- 最近对话摘要
- 当前用户消息
- 所有 Skill 的 `name + description`
- 当前 session 可用文件摘要

输出固定 JSON：

```json
{
  "mode": "chat",
  "needClarification": false,
  "selectedSkills": [],
  "reason": "..."
}
```

或：

```json
{
  "mode": "skill",
  "needClarification": false,
  "selectedSkills": ["pdf"],
  "reason": "用户明确要求生成 PDF 报告"
}
```

#### 阶段二：Skill Planner

仅在阶段一确定需要 Skill 时触发。输入：

- 目标 Skill 的完整 `SKILL.md`
- 该 Skill 对应 references
- 当前会话的上下文文件摘要
- 用户消息

输出固定 JSON：

```json
{
  "assistantMessage": "我将为你生成一份 PDF 周报。",
  "toolCalls": [
    {
      "skill": "pdf",
      "action": "run",
      "arguments": {
        "title": "本周销售报告",
        "language": "zh-CN"
      }
    }
  ]
}
```

约束：

- `toolCalls` 只允许使用后端已注册的 action
- `arguments` 必须通过 Zod 校验
- Planner 输出不包含 shell 命令

### 5.4 LLM Client 抽象

后端设计统一接口，避免未来切换模型时侵入业务层：

```ts
interface ChatModelClient {
  classify(input: RouterPrompt): Promise<RouterResult>;
  planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult>;
  replyStream(input: ReplyPrompt): AsyncIterable<string>;
  skillReplyStream(input: SkillReplyPrompt): AsyncIterable<string>;
}
```

当前实现以单模型为核心：

- 路由判断优先走本地启发式，不再区分 router model
- runtime skill 的执行计划由服务端本地生成，不再额外请求 planner model
- OpenAI / Anthropic 主要负责回复采样；工具调用规划优先使用本地启发式

模型名称通过环境变量配置，例如：

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`

### 5.5 SessionRunner 设计

#### 5.5.1 生命周期

- 当某个 session 第一次触发 Skill 时，`RunnerManager` 创建或复用 `SessionRunner`
- `SessionRunner` 记录：
  - `userId`
  - `sessionId`
  - `workDir`
  - `uploadsDir`
  - `outputDir`
  - `sharedDir`
  - `lastActiveAt`
- 空闲超过 30 分钟后释放引用

#### 5.5.2 并发控制

- 全局并发上限：`MAX_CONCURRENT_RUNS=5`
- 同一 session 内默认串行执行，避免文件写入冲突
- 排队任务在 SSE 中显示 `tool_progress` 状态：`queued`

#### 5.5.3 执行约束

- 单次执行超时：120 秒
- 单次标准输出日志上限：1 MB
- 单次产出文件总量上限：50 MB
- 只允许读取：
  - 当前 session `uploads/`
  - 当前 session `outputs/`
  - 用户 `shared/`
  - Skill 自身 `references/` 和 `assets/`

#### 5.5.4 执行方式

后端不再为 Skill 生成包装请求文件，而是执行模型明确指定的 CLI：

```ts
type SkillRunSpec = {
  skillName: string;
  path: string;
  args: string[];
  cwdRoot: 'session' | 'workspace';
  cwdPath?: string;
};
```

例如：

```text
python skills/xlsx/scripts/recalc.py outputs/model.xlsx 30
```

#### 5.5.5 进度与产出监听

推荐所有内置 Skill 脚本遵循 JSONL stdout 协议：

```json
{"type":"progress","message":"正在整理数据","percent":20}
{"type":"progress","message":"正在生成 PDF","percent":70}
{"type":"artifact","path":"outputs/report.pdf","label":"销售周报.pdf"}
{"type":"result","message":"文件生成完成"}
```

后端处理规则：

- `progress` -> 广播 `tool_progress`
- `artifact` -> 校验路径是否在 `outputs/` 中，写入 `files` 表，广播 `file_ready`
- `result` -> 记录为 `tool_result`
- 非 JSON 行 -> 作为普通日志摘要写入 `tool_progress`

此外，Runner 在执行前后对 `outputs/` 做一次目录快照，保证即使脚本未输出 `artifact` 行，也能发现新增文件。

### 5.6 Skill Registry 与 Loader

#### 5.6.1 启动时扫描

服务启动时扫描 `/skills/*/SKILL.md`，仅加载 metadata：

- `name`
- `description`
- `tools_required`
- `entrypoint`
- `timeout_sec`

建议通过 frontmatter 规范化：

```yaml
---
name: pdf
description: 生成和处理 PDF 文件
---
```

#### 5.6.2 运行时按需加载

当 Router 选择某个 Skill 后：

- 读取完整 `SKILL.md`
- 加载声明的 references
- 限制总注入体积，例如不超过 80 KB
- 对大文件 references 仅截取首部目录或摘要

V0.1 不做复杂引用检索，直接按 Skill 声明加载，优先保证稳定实现。

### 5.7 MessageStore 设计

`messages.jsonl` 中每行记录一个事件对象，统一格式如下：

```json
{
  "id": "evt_01",
  "sessionId": "s1",
  "kind": "message",
  "role": "user",
  "type": "text",
  "content": "帮我生成本周销售报告 PDF",
  "createdAt": "2026-04-09T10:00:00.000Z"
}
```

其他 `kind`：

- `message`
- `thinking`
- `tool_call`
- `tool_progress`
- `tool_result`
- `file`
- `error`

这样可以实现：

- 聊天历史回放
- 弱网断线后恢复页面
- 后续支持将执行过程完整展示给用户

历史查询建议默认返回最近 100 条，向上滚动时支持分页拉取更早记录。

### 5.8 FileService 设计

职责：

- 处理 multipart 上传
- 为文件生成稳定 `fileId`
- 识别 MIME 类型、大小、来源
- 提供下载鉴权
- 支持将会话文件转移到 `shared/`

实现建议：

- 物理文件名采用 `timestamp-random-originalName`
- 展示文件名单独存 `display_name`
- `files` 表保存 `relative_path`，不要持久化绝对路径
- 下载时根据 `fileId` 查表并做用户权限校验

文本类文件注入上下文策略：

- `.txt`、`.md`、`.csv`、`.json` 可抽取前 8 KB 文本摘要
- 二进制文件只注入文件名、类型、大小
- 上传后无需立即写入聊天消息，可在后续 prompt 构造时自动纳入“可用文件”

### 5.9 Auth 设计

V0.1 采用用户名 + 密码 + 邀请码注册：

- `POST /api/auth/register` 输入：`username`、`password`、`inviteCode`
- 密码使用 `bcrypt` hash
- 登录返回 JWT，默认有效期 7 天
- 前端将 token 存于 `localStorage`

说明：

- 对于 SSE，前端使用 `fetch-event-source` 发送 `Authorization: Bearer <token>`，不依赖原生 `EventSource`
- V0.1 不做 refresh token，过期后重新登录

管理员邀请码生成方式：

- 服务端提供 CLI：`pnpm server invite:create`
- 仅服务器运维可执行
- 生成的邀请码写入 `invite_codes` 表

---

## 6. 前端详细设计

### 6.1 路由结构

建议路由：

- `/login`
- `/register`
- `/app`
- `/app/session/:sessionId`

进入 `/app` 后：

- 若无 session，自动创建一个空会话或跳转到最近会话
- 桌面端显示三栏或两栏布局
- 移动端显示单栏，文件与会话使用抽屉面板

### 6.2 页面拆分

#### 6.2.1 AppShell

负责：

- 顶部导航
- 当前会话标题
- 会话切换入口
- 文件面板入口
- Skill 面板入口

#### 6.2.2 ChatPage

由以下组件组成：

- `MessageList`
- `MessageItem`
- `Composer`
- `TypingStatus`
- `RunProgressCard`
- `FileCard`

#### 6.2.3 FilePanel

展示：

- 当前会话 `uploads`
- 当前会话 `outputs`
- 用户 `shared`

支持：

- 类型筛选
- 下载
- 共享
- 图片预览
- PDF 首页缩略图占位

V0.1 不强制实现 ZIP 批量下载，可作为次优先级需求。

### 6.3 状态管理建议

使用 TanStack Query 管理服务端资源：

- `sessions`
- `messages`
- `files`
- `skills`

使用 Zustand 管理本地 UI 态：

- `activeSessionId`
- `composerDraft`
- `mobileDrawerState`
- `streamStatus`
- `pendingRun`

### 6.4 流式交互模型

建议交互方式：

1. 进入会话页即建立 SSE 连接。
2. 用户发送消息时，先本地 optimistic append 用户消息。
3. `POST /messages` 成功后等待 SSE 推送 assistant 事件。
4. 收到 `text_delta` 时增量渲染。
5. 收到 `file_ready` 时在消息流和文件面板同时更新。
6. 收到 `done` 时将流式缓冲合并为正式消息。

断线重连：

- 使用 `fetch-event-source` 内建重试机制
- 保留最近一次 `eventId`
- 重连成功后先拉取 `GET /api/sessions/:id/messages?after=...` 或直接刷新最近消息，保证状态一致

### 6.5 微信浏览器适配

#### 6.5.1 输入区

- 输入框使用 `textarea`
- 字号固定至少 16px
- 底部内边距包含 `env(safe-area-inset-bottom)`
- 监听 `visualViewport` 调整输入区和消息区高度

#### 6.5.2 下载体验

微信内对部分文件下载限制较大，V0.1 采用分级方案：

1. 优先尝试直接打开下载 URL
2. 若检测为微信环境且下载失败，展示“请在浏览器中打开”引导
3. 对 PDF 文件可预留后续接入微信 JS-SDK 的扩展点

#### 6.5.3 滚动与触摸

- 消息列表开启 `-webkit-overflow-scrolling: touch`
- 点击区域不小于 `44x44`
- 长消息文本允许长按复制

### 6.6 桌面端增强

桌面端在不改变主流程的前提下增强：

- 左栏会话列表
- 右栏文件面板
- 拖拽上传
- `Enter` 发送，`Shift+Enter` 换行

---

## 7. 数据设计

### 7.1 SQLite 表结构

在 PRD 基础上做以下微调：

```sql
CREATE TABLE users (
  id         TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invite_codes (
  code       TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by    TEXT REFERENCES users(id),
  used_at    DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  title           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_message_at DATETIME
);

CREATE TABLE files (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  session_id     TEXT REFERENCES sessions(id),
  display_name   TEXT NOT NULL,
  relative_path  TEXT NOT NULL,
  mime_type      TEXT,
  size           INTEGER,
  bucket         TEXT NOT NULL CHECK(bucket IN ('uploads', 'outputs', 'shared')),
  source         TEXT NOT NULL CHECK(source IN ('upload', 'generated', 'shared')),
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sessions_user_updated
  ON sessions(user_id, updated_at DESC);

CREATE INDEX idx_files_user_created
  ON files(user_id, created_at DESC);

CREATE INDEX idx_files_session_created
  ON files(session_id, created_at DESC);
```

关键调整：

- `users.role` 用于管理邀请码生成权限
- `files.user_id` 便于按用户聚合文件
- `files.bucket` 区分 `uploads`、`outputs`、`shared`
- `relative_path` 替代绝对路径，降低部署迁移成本

### 7.2 会话元数据

`meta.json` 示例：

```json
{
  "sessionId": "s1",
  "userId": "u1",
  "title": "销售周报",
  "createdAt": "2026-04-09T10:00:00.000Z",
  "updatedAt": "2026-04-09T10:02:00.000Z"
}
```

作用：

- 会话目录自描述
- 启动后重建索引时可辅助恢复
- 即使 DB 损坏，也保留一定恢复能力

### 7.3 JSONL 与 SQLite 的职责划分

SQLite 保存：

- 用户、邀请码、会话索引、文件索引

JSONL 保存：

- 用户消息
- assistant 文本
- 过程事件
- 文件生成事件

这样划分的原因：

- 聊天记录天然是 append-only，更适合 JSONL
- 文件和会话查询更适合走 SQLite 索引
- 重放与调试成本低

---

## 8. API 与事件契约

### 8.1 REST 接口

#### `POST /api/auth/register`

请求：

```json
{
  "username": "alice",
  "password": "secret123",
  "inviteCode": "INV-ABCD"
}
```

响应：

```json
{
  "user": {
    "id": "u1",
    "username": "alice"
  },
  "token": "jwt-token"
}
```

#### `POST /api/auth/login`

响应同上。

#### `GET /api/sessions`

响应：

```json
[
  {
    "id": "s1",
    "title": "销售周报",
    "updatedAt": "2026-04-09T10:02:00.000Z"
  }
]
```

#### `POST /api/sessions`

请求可为空，服务端创建空会话：

```json
{
  "title": "新会话"
}
```

#### `GET /api/sessions/:id/messages`

查询参数：

- `after`
- `before`
- `limit`

返回按时间升序的事件列表。

#### `POST /api/sessions/:id/messages`

请求：

```json
{
  "content": "帮我生成一份本周销售报告 PDF"
}
```

响应：

```json
{
  "accepted": true,
  "messageId": "msg_01",
  "runId": "run_01"
}
```

#### `GET /api/sessions/:id/stream`

长连接 SSE，Header 携带 JWT。

#### `GET /api/files`

查询参数：

- `sessionId`
- `bucket`
- `type`

用于文件面板聚合查询。

#### `POST /api/files/:sessionId/upload`

`multipart/form-data`，字段名 `file`。

#### `GET /api/files/:fileId/download`

返回二进制流。

#### `POST /api/files/:fileId/share`

将文件移动或复制到 `shared/`，并更新索引。

### 8.2 SSE 事件

统一格式：

```ts
interface SSEvent<T = unknown> {
  id: string;
  event:
    | 'text_delta'
    | 'thinking'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_result'
    | 'file_ready'
    | 'done'
    | 'error';
  data: T;
}
```

事件示例：

```json
{
  "id": "evt_101",
  "event": "thinking",
  "data": {
    "message": "正在分析需求"
  }
}
```

```json
{
  "id": "evt_102",
  "event": "tool_start",
  "data": {
    "skill": {
      "name": "pdf",
      "status": "running"
    }
  }
}
```

```json
{
  "id": "evt_103",
  "event": "file_ready",
  "data": {
    "file": {
      "id": "f1",
      "name": "销售周报.pdf",
      "size": 102400,
      "url": "/api/files/f1/download"
    }
  }
}
```

---

## 9. Skill 规范

### 9.1 Skill 目录

V0.1 采用如下结构：

```text
/skills/
├── pdf/
│   ├── SKILL.md
│   ├── scripts/
│   │   └── run.py
│   ├── references/
│   └── assets/
├── xlsx/
└── docx/
```

### 9.2 `SKILL.md` 建议格式

```yaml
---
name: pdf
description: 生成和处理 PDF 文件
---
```

正文部分保留：

- 触发条件
- 执行步骤
- 输出约束
- 错误处理约束

### 9.3 Skill 脚本输入协议

后端为 Skill 生成 `request.json`：

```json
{
  "runId": "run_01",
  "skill": "pdf",
  "user": {
    "id": "u1"
  },
  "session": {
    "id": "s1",
    "workDir": "/data/users/u1/sessions/s1",
    "uploadsDir": "/data/users/u1/sessions/s1/uploads",
    "outputDir": "/data/users/u1/sessions/s1/outputs",
    "sharedDir": "/data/users/u1/shared"
  },
  "input": {
    "prompt": "帮我生成一份本周销售报告 PDF",
    "arguments": {
      "title": "本周销售报告"
    },
    "files": [
      {
        "name": "sales.csv",
        "path": "/data/users/u1/sessions/s1/uploads/sales.csv",
        "mimeType": "text/csv"
      }
    ]
  }
}
```

脚本通过原生命令行接收：

```text
python scripts/fill_fillable_fields.py uploads/form.pdf uploads/field-values.json outputs/filled.pdf
```

这样与官方 skill 保持一致，模型只需要按 `SKILL.md` 明确传入 `path + args` 即可。

### 9.4 V0.1 内置 Skill

#### `pdf`

- 输入：文本、Markdown、结构化数据
- 输出：`pdf`
- 典型能力：报告生成、简单排版、封面与页脚

#### `xlsx`

- 输入：CSV、JSON、自然语言表格描述
- 输出：`xlsx`
- 典型能力：多 sheet、基础格式化、简单图表

#### `docx`

- 输入：文档提纲、正文、表格数据
- 输出：`docx`
- 典型能力：合同草稿、方案文档、会议纪要

统一要求：

- 默认中文字体可用
- 脚本缺少依赖时返回明确 stderr
- 输出文件必须写入 `outputs/`

---

## 10. 安全、稳定性与运维

### 10.1 安全边界

- 所有文件下载必须校验 `file.user_id == currentUser.id`
- 所有 session 操作必须校验归属
- 文件名下载时做响应头转义，避免 header 注入
- 上传类型白名单优先支持：`pdf`、`docx`、`xlsx`、`csv`、`txt`、`md`、`json`、图片
- 上传大小限制建议 20 MB
- Skill 脚本不可写入 `../` 路径，后端对路径做 `resolve + prefix` 校验

### 10.2 资源控制

- 单用户默认存储配额：1 GB
- 单文件上传上限：20 MB
- 单次执行超时：120 秒
- 全局并发数：5
- 空闲 Runner 回收：30 分钟

### 10.3 日志与可观测性

日志字段建议包含：

- `requestId`
- `userId`
- `sessionId`
- `runId`
- `skillName`
- `durationMs`
- `status`

关键日志场景：

- 登录失败
- 邀请码消费
- Skill 执行开始/结束/超时
- 文件上传/下载失败
- SSE 连接断开与重连

### 10.4 部署方式

V0.1 支持两种：

- Docker Compose
- 直接在 VPS 上用 `pm2` 启动 Node 服务 + `nginx` 反代

系统依赖：

- Node.js LTS
- Python 3.x
- `reportlab`
- `openpyxl`
- `python-docx`

环境变量建议：

```text
NODE_ENV=production
PORT=3000
DATA_ROOT=/data
SKILLS_ROOT=/skills
WEB_ORIGIN=https://app.example.com
SESSION_EXPIRES_IN=7d
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=...
MAX_CONCURRENT_RUNS=5
RUN_TIMEOUT_MS=120000
```

---

## 11. 开发顺序

### 11.1 里程碑拆分

#### 阶段 1：工程骨架

- 初始化 `apps/web` 与 `apps/server`
- 配置 TypeScript、Tailwind、Fastify、SQLite
- 打通基础路由与构建脚本

#### 阶段 2：认证与会话

- 注册、登录、JWT
- 邀请码校验与 CLI 生成
- 会话创建、列表、目录初始化

#### 阶段 3：聊天基础链路

- 消息持久化到 JSONL
- SSE 连接与前端流式渲染
- 普通对话回复链路

#### 阶段 4：Skill 系统

- SkillRegistry 扫描
- Router / Planner prompt
- SessionRunner 与并发控制
- `pdf`、`xlsx`、`docx` 内置 Skill

#### 阶段 5：文件系统

- 上传、下载、文件列表
- 生成文件入库
- 文件共享到 `shared/`

#### 阶段 6：移动端打磨

- 微信浏览器适配
- `visualViewport` 键盘处理
- 下载引导与异常兜底

#### 阶段 7：上线前验证

- 真机微信测试
- 小流量压测
- 部署脚本与运维文档

### 11.2 建议排期

按 2 周 MVP 估算：

- 第 1-2 天：工程骨架、认证、会话目录
- 第 3-4 天：聊天消息链路、SSE、前端消息流
- 第 5-7 天：Skill Registry、RunnerManager、`pdf`
- 第 8-9 天：`xlsx`、`docx`、文件上传下载
- 第 10-11 天：移动端适配、桌面端补齐
- 第 12-14 天：测试、修复、部署验证

---

## 12. 测试与验收

### 12.1 测试层次

单元测试：

- 邀请码消费逻辑
- JWT 校验
- Skill metadata 解析
- SessionRunner 超时与队列控制
- 路径安全校验

集成测试：

- 注册 -> 登录 -> 创建会话 -> 发消息 -> 收流式回复
- 上传 CSV -> 触发 `xlsx` -> 下载生成文件
- 上传 Markdown -> 触发 `pdf`
- 文件共享到 `shared/` 后下一会话可见

端到端测试：

- 移动端视口聊天发送
- 微信浏览器兼容性重点场景
- SSE 弱网断开重连

### 12.2 MVP 验收标准

- 用户可通过邀请码注册并登录
- 用户进入系统后可创建和切换会话
- 用户发送普通消息可获得流式文本回复
- 用户上传文件后可在当前会话中看到文件
- 用户发送“生成 PDF/Excel/Word”类需求时，系统能正确触发相应 Skill
- 生成文件后消息流出现文件卡片，且可下载
- 在微信浏览器中聊天、上传、下载主链路可用
- 10 个并发用户下系统可稳定运行，无明显阻塞或崩溃

### 12.3 上线前检查清单

- HTTPS 证书可用
- 文件目录可写
- Python 依赖已安装
- `ANTHROPIC_API_KEY` 已配置
- SQLite 自动迁移执行成功
- 邀请码 CLI 可生成有效邀请码
- 微信真机完成一次完整“发消息 -> 生成文件 -> 下载文件”链路

---

## 13. 后续扩展预留

V0.1 实现时需要预留但不立即交付的点：

- 用户自定义 Skill 上传能力
- MCP 工具协议适配层
- 微信 JS-SDK 文件预览
- 管理后台
- 对象存储迁移能力
- `fileId` 之外的公开短链分享能力

建议方式：

- 所有 LLM、Runner、Storage 模块都定义接口层
- 前端文件预览与下载逻辑分开封装
- Skill metadata 增加 `runtime`、`entrypoint`、`input_schema` 字段，减少未来协议变更成本

---

## 14. 结论

SkillChat 的 MVP 可按“单机部署、受控 Skill 调用、会话级目录隔离、SSE 流式交互”的路线快速落地。工程实现上最关键的不是页面本身，而是以下四点：

- Skill 调用必须结构化，不能让模型直接执行任意命令
- 文件路径与会话目录必须严格隔离
- SSE 必须采用可携带 JWT 的实现方案，并考虑弱网重连
- Skill 脚本必须统一输入输出协议，否则后续新增 Skill 成本会快速失控

按本文档实施，可以较稳妥地完成 PRD 中定义的 V0.1 MVP，并为 V0.2 的文件增强、更多 Skill 和微信能力扩展保留清晰演进路径。
