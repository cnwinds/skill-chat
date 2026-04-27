# SkillChat

源码仓库：<https://github.com/cnwinds/skill-chat>

SkillChat 是一个轻量级 Skill 驱动 Web 聊天平台。当前仓库已实现：

- 邀请码注册、登录、JWT 鉴权
- 会话创建、消息持久化、SSE 流式输出
- 文件上传、下载、共享
- 本地 legacy Skill 兼容、市场 Skill 安装、当前会话 Skill 启用
- SQLite + 本地磁盘持久化
- React 单页应用，移动端优先，兼容桌面浏览器

## 0. 运行约定

- 开发环境：直接在宿主机运行，不使用 Docker。后端使用 `npm run dev:server`，前端使用 Vite dev server，Python Skill 依赖安装到本地 `.venv`。
- 正式环境：统一使用 Docker Compose 部署，对外服务实例不要再切回本地开发启动方式。

## 0.1 三仓库拆分关系

当前 Skill 系统已经拆成三个独立仓库，开发时请保持三者边界清晰：

```text
skill-market
  仓库：https://github.com/cnwinds/skill-market
  职责：Skill 市场、版本分发、Market API、@qizhi/skill-spec 契约源头。

official-skills
  仓库：https://github.com/cnwinds/official-skills
  职责：官方 Skill 源码、skill.json、SKILL.md、脚本、参考资料、校验和打包。

skill-chat
  仓库：https://github.com/cnwinds/skill-chat
  职责：聊天应用、用户会话、Skill 安装、会话启用、运行本地已安装 Skill。
```

本地开发推荐三个项目并列放置：

```text
C:\projects\skill-market
C:\projects\official-skills
C:\projects\skill-chat
```

修改规则：

- 契约字段、manifest schema、Market API 类型先改 `skill-market/packages/skill-spec`。
- 官方 Skill 内容只改 `official-skills/skills/*`，打包产物由 `npm run pack` 生成。
- 聊天应用只负责安装、启用和运行 Skill，不要在本仓库新增市场契约字段。
- 详细设计见 `docs/Three_Project_Split_Design.md`。下次改 Skill 相关功能前请先阅读该文档。

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

## 3. 本地开发命令（宿主机直跑，不走 Docker）

### 3.1 前台启动

推荐开发时开两个终端。

终端 1，启动后端：

```bash
npm run dev:server
```

终端 2，启动前端：

```bash
npm --workspace @skillchat/web run dev -- --host 0.0.0.0
```

前端默认地址：

```text
http://localhost:5173
```

后端默认地址：

```text
http://localhost:3000
```

### 3.2 后台启动

如果希望一个终端里直接拉起并把日志写到文件，可以用：

```bash
mkdir -p logs
nohup npm run dev:server > logs/dev-server.log 2>&1 &
nohup npm --workspace @skillchat/web run dev -- --host 0.0.0.0 > logs/dev-web.log 2>&1 &
```

### 3.3 关闭

按端口关闭当前开发服务：

```bash
lsof -ti :3000 | xargs -r kill -TERM
lsof -ti :5173 | xargs -r kill -TERM
```

如果你是前台启动，也可以直接在对应终端按 `Ctrl+C`。

### 3.4 重启

先关闭，再重新启动：

```bash
lsof -ti :3000 | xargs -r kill -TERM
lsof -ti :5173 | xargs -r kill -TERM
```

然后重新执行启动命令：

```bash
npm run dev:server
```

```bash
npm --workspace @skillchat/web run dev -- --host 0.0.0.0
```

如果你使用后台方式，可以直接整套复制：

```bash
lsof -ti :3000 | xargs -r kill -TERM
lsof -ti :5173 | xargs -r kill -TERM
mkdir -p logs
nohup npm run dev:server > logs/dev-server.log 2>&1 &
nohup npm --workspace @skillchat/web run dev -- --host 0.0.0.0 > logs/dev-web.log 2>&1 &
```

### 3.5 查看是否启动成功

检查端口监听：

```bash
ss -ltnp | rg ':3000|:5173'
```

检查后端接口：

```bash
curl http://127.0.0.1:3000/api/system/status
```

查看后台日志：

```bash
tail -f logs/dev-server.log
tail -f logs/dev-web.log
```

## 4. 正式环境部署（Docker Compose）

如果你要在服务器上一键启动，仓库根目录已经提供：

- `docker/compose.yml`
- `docker/Dockerfile`
- `docker/nginx.conf`
- `docker/.env.example`

最短流程：

```bash
cd docker
cp .env.example .env
docker compose up -d --build
```

国内服务器如果拉镜像或装依赖慢，compose 已经支持国内源构建参数，详见：

- `docs/Docker_Deployment.md`

默认访问地址（按 `docker/.env.example` 模板）：

```text
http://localhost:7070
```

完整说明见：

- `docs/Docker_Deployment.md`

## 5. 初始化邀请码

```bash
npm run invite:create
```

一次生成多个邀请码：

```bash
npm run invite:create -- 5
```

## 6. 构建与测试

```bash
npm run build
npm test
```

## 7. 技术说明

- 后端：Fastify + SQLite + better-sqlite3
- 前端：React + Vite + TanStack Query + Zustand
- Skill 运行：SessionRunner + Python 子进程
- Skill 依赖：`reportlab`、`openpyxl`、`python-docx`

## 8. Skill 来源

第一阶段仍兼容仓库根目录的 legacy `skills/`，但长期真相来源是：

- 官方 Skill 源码：`official-skills/skills/*`
- 市场安装目录：`data/installed-skills/{publisher}/{name}/{version}`
- 当前会话启用列表：`activeSkills = ["official/pdf", "official/xlsx"]`

## 9. 主要文档

- `docs/SkillChat_PRD.md`
- `docs/SkillChat_Design_Dev.md`
- `docs/SkillChat_TODO.md`
