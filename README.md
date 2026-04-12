# SkillChat

源码仓库：<https://github.com/cnwinds/qizhi>

SkillChat 是一个轻量级 Skill 驱动 Web 聊天平台。当前仓库已实现：

- 邀请码注册、登录、JWT 鉴权
- 会话创建、消息持久化、SSE 流式输出
- 文件上传、下载、共享
- 内置 `pdf`、`xlsx`、`docx` Skill
- SQLite + 本地磁盘持久化
- React 单页应用，移动端优先，兼容桌面浏览器

## 1. 环境要求

- Node.js 24+
- Python 3.13+

## 2. 安装

```bash
npm install
npm run setup:python
cp .env.example .env
```

如果不配置 `ANTHROPIC_API_KEY`，系统会自动使用本地 rule-based 模型回退逻辑，依然可以完成普通聊天和 Skill 调度测试。

## 3. 启动

终端 1：

```bash
npm run dev:server
```

终端 2：

```bash
npm run dev:web
```

前端默认地址：

```text
http://localhost:5173
```

后端默认地址：

```text
http://localhost:3000
```

## 4. 初始化邀请码

```bash
npm run invite:create
```

一次生成多个邀请码：

```bash
npm run invite:create -- 5
```

## 5. 构建与测试

```bash
npm run build
npm test
```

## 6. 技术说明

- 后端：Fastify + SQLite + better-sqlite3
- 前端：React + Vite + TanStack Query + Zustand
- Skill 运行：SessionRunner + Python 子进程
- Skill 依赖：`reportlab`、`openpyxl`、`python-docx`

## 7. 当前内置 Skill

- `pdf`：生成中文 PDF 报告
- `xlsx`：支持 CSV 转 Excel，并自动生成基础图表
- `docx`：生成 Word 文档草稿

## 8. 主要文档

- `docs/SkillChat_PRD.md`
- `docs/SkillChat_Design_Dev.md`
- `docs/SkillChat_TODO.md`
