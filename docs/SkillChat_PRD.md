# SkillChat — 轻量级 Skill 驱动 Web 聊天平台

## 产品需求文档 (PRD)

**版本**: v0.1  
**日期**: 2026-04-09  
**状态**: 草案  

---

## 1. 产品定位

SkillChat 是一个面向个人/小团队的**轻量级 Web 聊天平台**，核心理念是借鉴 OpenAI Codex 的 Skill 架构，让 AI 不仅能对话，还能通过 Skill 执行真实任务——生成 PDF、Excel、图表、代码等文件，并让用户直接下载。

主要使用场景：**微信浏览器内打开使用**，同时兼容桌面浏览器。

### 1.1 核心价值主张

"对话即工作流"：用户通过自然语言触发 Skill，AI 在服务端进程内执行任务，生成的文件直接推送到用户专属目录，一键下载。

### 1.2 借鉴 Codex 的关键设计

| Codex 概念 | SkillChat 对应 |
|---|---|
| SKILL.md — 描述 + 指令 + 资源 | 同样采用 `SKILL.md` + `scripts/` + `references/` + `assets/` 结构 |
| 渐进式加载（先读 metadata，按需加载全文） | Skill Registry 仅注册 name/description，运行时按需读取 |
| 进程内执行 | 每个会话对应一个 SessionRunner 对象，直接在 Node 进程内调度脚本 |
| Thread 持久化（会话可恢复） | 每个用户的 session 绑定持久化目录 + 对话历史 |
| MCP 外部工具扩展 | 预留 MCP 接口，V1 先内置核心 Skill |

---

## 2. 用户画像

**主要用户**：需要 AI 协助完成文档/数据处理任务的个人用户或小团队成员。

典型场景举例：

- 在手机微信里对 AI 说"帮我生成一份本周销售报告的 PDF"，AI 调用 pdf skill 生成文件，用户直接下载
- 在电脑上说"把这个 CSV 转成格式化的 Excel 并加上图表"，AI 调用 xlsx skill 处理
- 说"帮我做一个 5 页的产品介绍 PPT"，AI 调用 pptx skill 生成

---

## 3. 系统架构

### 3.1 整体架构

```
┌──────────────────────────────────────────────────────┐
│                   客户端 (SPA)                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ 聊天面板     │  │ 文件管理面板  │  │ Skill 面板   │  │
│  │ (消息流)     │  │ (用户文件)    │  │ (可用技能)   │  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  │
│         └────────────────┼──────────────────┘          │
│                     WebSocket / SSE                     │
└──────────────────────────┬───────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────┐
│                    API Gateway                         │
│            (Node.js / Express / Fastify)               │
│  ┌────────────┐ ┌──────────────┐ ┌─────────────────┐  │
│  │ Auth 模块  │ │ Session 管理 │ │ 文件服务        │  │
│  │ (JWT)      │ │ (会话+目录)  │ │ (上传/下载)     │  │
│  └────────────┘ └──────────────┘ └─────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Agent Core (核心调度)                    │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ LLM 调用 │ │ Skill    │ │ SessionRunner    │  │  │
│  │  │ (Claude  │ │ Registry │ │ (进程内会话对象) │  │  │
│  │  │  API)    │ │ & Loader │ │                   │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │           数据层                                  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │  │
│  │  │ SQLite   │ │ 用户文件 │ │ Skill 仓库       │  │  │
│  │  │ (会话/   │ │ 存储     │ │ (本地目录)       │  │  │
│  │  │  用户)   │ │          │ │                   │  │  │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 3.2 技术选型

| 层级 | 技术 | 理由 |
|---|---|---|
| 前端 | React (Vite) + TailwindCSS | 轻量、移动端友好、SSE 流式渲染 |
| 后端 | Node.js + Fastify | Codex CLI 本身是 Node/Rust 生态；Fastify 性能好 |
| 数据库 | SQLite (better-sqlite3) | 单文件部署、无需额外服务 |
| LLM | Anthropic Claude API | Skill 系统与 Claude 的 tool use 高度契合 |
| 文件存储 | 本地磁盘 (`/data/users/{uid}/`) | 轻量方案，不依赖 S3 |
| Skill 执行 | 进程内 SessionRunner | 每个会话一个对象，直接调用 child_process 执行脚本，无需容器开销 |
| 部署 | 单台 VPS + 直接运行或 Docker Compose | 1 命令启动 |

---

## 4. 核心功能

### 4.1 用户会话与文件目录

每个用户注册/登录后，系统自动创建专属目录结构：

```
/data/users/{uid}/
├── sessions/
│   ├── {session_id_1}/
│   │   ├── meta.json          # 会话元信息
│   │   ├── messages.jsonl     # 对话历史（JSONL 格式，借鉴 Codex）
│   │   └── outputs/           # 本次会话生成的文件
│   │       ├── report.pdf
│   │       └── data.xlsx
│   └── {session_id_2}/
│       └── ...
├── uploads/                   # 用户上传的文件
└── shared/                    # 跨会话共享文件
```

**关键设计**：

- 每个会话（session）绑定独立目录，会话产生的文件存入 `outputs/`
- 用户可以在文件面板中浏览所有会话的产出物
- 支持将文件从一个会话"移动"到 `shared/`，使其跨会话可用
- 会话历史采用 JSONL 格式（借鉴 Codex 的 history.jsonl），便于追溯和恢复

### 4.2 Skill 系统

#### 4.2.1 Skill 目录结构（借鉴 Codex Skills 标准）

```
/skills/
├── pdf/
│   ├── SKILL.md               # 必需：名称 + 描述 + 指令
│   ├── scripts/               # 可执行脚本
│   │   └── generate_pdf.py
│   ├── references/            # 参考文档（按需加载到上下文）
│   │   └── reportlab_guide.md
│   └── assets/                # 模板、字体等资源
│       └── templates/
├── xlsx/
│   ├── SKILL.md
│   └── scripts/
├── pptx/
│   ├── SKILL.md
│   └── scripts/
├── chart/
│   ├── SKILL.md
│   └── scripts/
└── docx/
    ├── SKILL.md
    └── scripts/
```

#### 4.2.2 SKILL.md 格式

```yaml
---
name: pdf
description: 生成和处理 PDF 文件。支持从文本/数据创建 PDF 报告，合并、拆分、添加水印等操作。
tools_required:
  - file_write
  - bash_exec
---

# PDF Skill

## 触发条件
当用户请求涉及 PDF 创建、编辑、转换时触发。

## 执行步骤
1. 分析用户需求，确定 PDF 类型（报告/表格/演示文稿）
2. 选择合适的模板或从零生成
3. 调用 scripts/generate_pdf.py 执行生成
4. 将结果写入会话的 outputs/ 目录

## 约束
- 输出文件不超过 50MB
- 中文内容需使用内置的思源字体
```

#### 4.2.3 Skill 调度流程

```
用户消息
    │
    ▼
┌─────────────────┐
│  LLM 分析意图    │  ← 传入所有已注册 Skill 的 name + description
│  (Claude API)   │
└────────┬────────┘
         │
    ┌────▼────┐
    │ 需要Skill？│
    └────┬────┘
      否 │  是
     ┌──┘  └──┐
     ▼        ▼
  普通回复  ┌──────────────┐
           │ 加载完整      │
           │ SKILL.md      │  ← 渐进式加载：此时才读取全文
           │ + references  │
           └──────┬───────┘
                  │
           ┌──────▼───────┐
           │ LLM 生成      │
           │ 执行计划       │  ← 可能包含多步工具调用
           └──────┬───────┘
                  │
           ┌──────▼───────┐
           │ SessionRunner│  ← 进程内会话对象，cwd 设为用户目录
           │ 执行脚本/命令 │
           └──────┬───────┘
                  │
           ┌──────▼───────┐
           │ 收集产出文件  │
           │ 推送到前端    │  ← 通过 SSE 通知前端新文件
           └──────────────┘
```

### 4.3 聊天界面

#### 4.3.1 消息类型

| 类型 | 描述 | 渲染方式 |
|---|---|---|
| `text` | 普通文本消息 | Markdown 渲染 |
| `thinking` | AI 思考过程 | 可折叠的灰色区块 |
| `tool_call` | 工具/Skill 调用 | 显示调用的 Skill 名 + 参数摘要 |
| `file` | 生成的文件 | 文件卡片（文件名 + 大小 + 下载按钮） |
| `error` | 执行错误 | 红色提示 |
| `progress` | 执行进度 | 进度条或 spinner |

#### 4.3.2 移动端适配（微信浏览器）

**这是重点**，需要特殊处理：

- **安全区域**：底部输入框需要适配 iOS 的 safe area（`env(safe-area-inset-bottom)`）
- **键盘弹出**：使用 `visualViewport` API 监听键盘事件，动态调整布局
- **输入框**：使用 `textarea` 而非 `input`，支持多行；微信浏览器中 `contenteditable` 行为不稳定
- **文件下载**：微信浏览器限制较多，PDF 等文件需通过"用浏览器打开"提示，或使用微信 JS-SDK 的 `previewFile` 接口
- **长按复制**：确保消息文本支持长按选择复制
- **字体大小**：最小 16px，避免微信浏览器自动缩放
- **触摸优化**：按钮最小 44×44px 触摸区域；消息列表使用 `-webkit-overflow-scrolling: touch`
- **网络适配**：SSE 在弱网下的自动重连机制

#### 4.3.3 桌面端增强

- 侧边栏显示会话列表 + 文件面板
- 支持拖拽上传文件
- 键盘快捷键（Enter 发送、Shift+Enter 换行）
- 代码块支持语法高亮 + 一键复制

### 4.4 文件管理

- **文件面板**（移动端为底部抽屉，桌面端为侧边栏 Tab）
  - 按会话分组展示文件
  - 支持按类型筛选（PDF/Excel/PPT/图片/其他）
  - 文件预览（图片内联预览，PDF 显示首页缩略图）
  - 一键下载、批量下载（打包 zip）
- **上传**
  - 支持拖拽（桌面）和点击选择（移动）
  - 上传到当前会话的 `uploads/` 目录
  - 上传后自动将文件路径注入对话上下文

### 4.5 认证与多用户

V1 采用轻量方案：

- **邀请码注册**：管理员生成邀请码，用户通过邀请码 + 设置密码注册
- **JWT 认证**：登录后发放 JWT，后续请求携带 Bearer Token
- **无需微信 OAuth**（避免公众号审核流程），直接在微信浏览器中打开 H5 页面使用
- 预留微信扫码登录接口，V2 可接入

---

## 5. API 设计

### 5.1 核心端点

```
POST   /api/auth/register          # 邀请码注册
POST   /api/auth/login              # 登录
GET    /api/sessions                # 会话列表
POST   /api/sessions                # 创建会话
GET    /api/sessions/:id/messages   # 获取历史消息
POST   /api/sessions/:id/messages   # 发送消息（触发 AI 回复）
GET    /api/sessions/:id/stream     # SSE 流式回复
GET    /api/files/:session_id       # 会话文件列表
GET    /api/files/:session_id/:filename  # 下载文件
POST   /api/files/:session_id/upload    # 上传文件
GET    /api/skills                  # 可用 Skill 列表
```

### 5.2 消息发送与流式回复

用户发送消息后，服务端建立 SSE 连接，逐块推送 AI 回复：

```typescript
// SSE 事件类型
interface SSEvent {
  event: 'text_delta'     // 文本片段
       | 'thinking'       // 思考过程
       | 'tool_start'     // 开始调用 Skill
       | 'tool_progress'  // 执行进度
       | 'tool_result'    // Skill 执行结果
       | 'file_ready'     // 文件生成完毕
       | 'done'           // 回复结束
       | 'error';         // 错误
  data: {
    content?: string;
    file?: { name: string; size: number; url: string; };
    skill?: { name: string; status: string; };
  };
}
```

---

## 6. Skill 执行模型 — SessionRunner

### 6.1 设计思路

不使用 Docker 隔离或沙箱，而是在 Node.js 进程内为每个活跃会话维护一个 **SessionRunner** 对象。SessionRunner 负责接收 LLM 产出的工具调用指令，在用户专属目录下执行脚本，并收集产出文件。

### 6.2 SessionRunner 生命周期

```
用户打开/创建会话
    │
    ▼
┌──────────────────────────────────┐
│  new SessionRunner(session)      │
│  ├─ workDir = /data/users/{uid}/sessions/{sid}/  │
│  ├─ outputDir = workDir/outputs/ │
│  ├─ env = { PATH, PYTHONPATH }   │
│  └─ timeout = 120s               │
└──────────────────────────────────┘
    │
    ▼  (用户发消息，LLM 返回 tool_call)
┌──────────────────────────────────┐
│  runner.exec(command, args)      │
│  ├─ child_process.spawn()        │
│  │   cwd = workDir               │
│  │   timeout = 120s              │
│  ├─ stdout/stderr → SSE 推送     │
│  └─ 执行结束 → 扫描 outputs/ 新文件 │
└──────────────────────────────────┘
    │
    ▼  (会话空闲超过 30 分钟)
┌──────────────────────────────────┐
│  runner.dispose()                │
│  └─ 释放引用，可被 GC 回收       │
└──────────────────────────────────┘
```

### 6.3 关键实现细节

- **工作目录隔离**：每个 SessionRunner 的 `cwd` 指向该用户该会话的专属目录，脚本只能在此目录下读写
- **超时控制**：单次脚本执行上限 120 秒，超时自动 kill 子进程
- **并发限制**：全局最多同时运行 N 个脚本（默认 5），超出排队等待
- **环境预装**：服务器本机预装 Python + 常用库（reportlab、openpyxl、python-pptx 等），Skill 脚本直接调用
- **文件监听**：执行完毕后扫描 `outputs/` 目录，将新增文件通过 SSE 推送给前端

---

## 7. 数据模型

### 7.1 SQLite 表结构

```sql
-- 用户
CREATE TABLE users (
  id         TEXT PRIMARY KEY,     -- UUID
  username   TEXT UNIQUE NOT NULL,
  password   TEXT NOT NULL,         -- bcrypt hash
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 邀请码
CREATE TABLE invite_codes (
  code       TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used_by    TEXT REFERENCES users(id),
  used_at    DATETIME
);

-- 会话
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  title      TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文件记录
CREATE TABLE files (
  id         TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  filename   TEXT NOT NULL,
  filepath   TEXT NOT NULL,           -- 磁盘上的完整路径
  size       INTEGER,
  mime_type  TEXT,
  source     TEXT CHECK(source IN ('upload', 'generated')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

对话历史不存 SQLite，而是按 Codex 的方式写入 `messages.jsonl` 文件，每行一条消息的 JSON。好处是回放简单、不受数据库行大小限制，且与 Skill 的上下文加载机制天然兼容。

---

## 8. 部署方案

### 8.1 单机部署（Docker Compose）

```yaml
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes:
      - ./data:/data           # 用户文件持久化
      - ./skills:/skills       # Skill 仓库
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - SESSION_EXPIRES_IN=${SESSION_EXPIRES_IN}

  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs     # Let's Encrypt 证书
```

也可以不用 Docker Compose，直接在 VPS 上 `node server.js` 运行，配合 pm2 做进程管理、nginx 做反代即可。

### 8.2 服务器要求

- 最低配置：2C4G VPS（推荐 4C8G）
- 存储：40GB+（根据用户量和文件量调整）
- 域名 + HTTPS 证书（微信浏览器要求 HTTPS）
- 建议使用国内云服务商（阿里云/腾讯云轻量），降低微信浏览器的访问延迟

---

## 9. 项目分期

### V0.1 — MVP（2 周）

- 基础聊天界面（移动端优先）
- 用户注册/登录（邀请码）
- 会话管理 + 文件目录绑定
- 3 个核心 Skill：pdf、xlsx、docx
- SSE 流式输出
- 文件下载

### V0.2 — 增强（2 周）

- 文件上传 + 上下文注入
- 更多 Skill：pptx、chart、image
- SessionRunner 并发调度优化
- 桌面端侧边栏布局
- 会话历史搜索

### V0.3 — 扩展（2 周）

- 自定义 Skill 支持（用户可上传 SKILL.md）
- MCP 协议接入（预留）
- 微信 JS-SDK 集成（文件预览优化）
- 管理后台（用户管理、Skill 管理、使用统计）

---

## 10. 关键风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 微信浏览器兼容性 | 布局异常、文件下载受限 | 开发阶段在真机微信中持续测试；文件下载提供备用方案（二维码+链接） |
| LLM API 延迟/费用 | 用户体验差、成本高 | SSE 流式输出缓解感知延迟；Skill 元数据轻量注入减少 token 用量 |
| 脚本执行异常 | 进程挂起或内存泄漏 | 单次执行 120 秒超时 + 全局并发数限制；pm2 自动重启 |
| 文件存储膨胀 | 磁盘空间耗尽 | 单用户配额（默认 1GB）+ 过期文件自动清理（30 天） |

---

## 11. 成功指标

- MVP 上线后，核心流程（聊天 → 触发 Skill → 下载文件）在微信浏览器中可完整走通
- 单次 Skill 执行（含 LLM 调用 + 文件生成）平均耗时 < 30 秒
- 系统支持 10 个并发用户，单日 500 次 Skill 调用
- 用户无需任何技术背景即可完成文件生成任务
