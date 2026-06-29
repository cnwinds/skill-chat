# HarnessKit 开发与发布流程

SkillChat 依赖 [HarnessKit](https://github.com/cnwinds/harness-kit)（`@skillchat/harness-*`）。HarnessKit 仍在快速迭代时，推荐：

| 阶段 | 依赖方式 | 目的 |
|------|----------|------|
| **日常开发** | 本地 `file:` 双仓库联调 | 修 bug 可同时在两边改、立即验证 |
| **生产部署** | npm 注册表固定版本 | Docker / CI 可复现，不依赖旁路目录 |

本文档是上述流程的标准操作说明。

---

## 1. 仓库布局（开发）

本地把两个仓库并列放置：

```text
ai_projects/
├── harness-kit/          # Harness 引擎 + React UI
└── skill-chat/           # 本仓库
```

SkillChat 默认在 `package.json` 中使用 `file:../../../harness-kit/packages/*` 链接本地包。

---

## 2. 日常开发

### 2.1 首次 / 切回本地联调

```bash
cd skill-chat
npm run harness:local    # 确保 package.json 为 file: 依赖
npm install
npm run build:harness-kit
```

### 2.2 启动服务

```bash
# 终端 1
npm run dev:server

# 终端 2
npm run dev:web
```

`predev:web` / `pretest` 会自动执行 `build:harness-kit`。

### 2.3 跨仓库修 bug

1. 在 `harness-kit` 修改并测试：`npm run test`
2. 重新编译：`npm run build`（或在 skill-chat 根目录 `npm run build:harness-kit`）
3. 在 skill-chat 验证功能
4. 分别在两个仓库提交，**先合并 / 发布 harness-kit，再更新 skill-chat**

### 2.4 注意

- 不要把 `harness-kit` 的 `dev:demo` 和 skill-chat 同时跑在 3000 端口。
- 改 harness-kit 后若前端行为未更新，执行 `npm run build:harness-kit` 并刷新页面。

---

## 3. 发布 HarnessKit 到 npm

在 **harness-kit** 仓库操作。

### 3.1 版本号

五个包版本需保持一致（当前均为 `0.1.x`）：

- `@skillchat/harness-protocol`
- `@skillchat/harness-core`
- `@skillchat/harness`
- `@skillchat/harness-server`
- `@skillchat/harness-react`

```bash
cd harness-kit
# 在各 packages/*/package.json 或根 workspace 统一 bump 版本
npm version 0.1.1 -ws
```

### 3.2 登录与私有源（可选）

公开发布到 npmjs.org：

```bash
npm login
```

私有 GitLab / GitHub Packages：在 harness-kit 与 skill-chat 根目录配置 `.npmrc`（参考 skill-chat 的 `.npmrc.example`）。

### 3.3 发布

```bash
cd harness-kit
npm test
npm run publish:packages              # 按依赖顺序发布全部包
# 预发布版本：
npm run publish:packages -- --tag next
# 演练：
npm run publish:packages -- --dry-run
```

发布顺序由 `scripts/publish-packages.mjs` 保证：`protocol → core → harness → server → react`。

### 3.4 发布后

更新 skill-chat 的 `config/harness-deps.manifest.json` 中的 `registryVersion`：

```json
{
  "registryVersion": "0.1.1"
}
```

---

## 4. 发布 SkillChat（生产）

### 4.1 切换为 npm 依赖

在 **skill-chat** 仓库：

```bash
npm run harness:registry -- --version=0.1.1
npm install
npm run build
npm test
```

这会改写 `apps/server`、`apps/web`、`packages/shared` 的 `@skillchat/harness-*` 为 `^0.1.1`，并更新 lockfile。

### 4.2 提交发布用依赖（推荐）

```bash
git add apps/server/package.json apps/web/package.json packages/shared/package.json package-lock.json config/harness-deps.manifest.json
git commit -m "chore: pin @skillchat/harness-* to 0.1.1 for release"
git tag v0.1.1   # 按项目版本策略
```

### 4.3 Docker 部署

`docker/Dockerfile` 在构建时会自动执行：

```bash
node scripts/sync-harness-deps.mjs registry --version=${HARNESSKIT_VERSION}
npm install
```

在 `docker/.env` 中指定与已发布版本一致的号：

```dotenv
HARNESSKIT_VERSION=0.1.1
```

然后：

```bash
cd docker
docker compose up -d --build
```

详见 [Docker_Deployment.md](./Docker_Deployment.md)。

### 4.4 发布完成后切回本地开发

```bash
npm run harness:local
npm install
```

`file:` 依赖可保留在开发分支，不必把 registry 版本长期留在日常开发用的分支上（按团队习惯二选一）。

---

## 5. 快速对照

| 我想… | 命令 |
|--------|------|
| 本地双仓库开发 | `npm run harness:local && npm install` |
| 编译 harness-kit | `npm run build:harness-kit` |
| 发布 harness-kit | `cd ../harness-kit && npm run publish:packages` |
| 准备 skill-chat 上线 | `npm run harness:registry -- --version=X.Y.Z && npm install` |
| Docker 构建 | 设置 `docker/.env` 的 `HARNESSKIT_VERSION=X.Y.Z` |
| 上线后恢复本地联调 | `npm run harness:local && npm install` |

---

## 6. 文件索引

| 文件 | 作用 |
|------|------|
| `config/harness-deps.manifest.json` | 本地 / registry 依赖映射与默认版本 |
| `scripts/sync-harness-deps.mjs` | 切换 `local` / `registry` 模式 |
| `.npmrc.example` | 私有 npm 源配置示例 |
| `docker/Dockerfile` | 构建时自动切换 registry 依赖 |
| `harness-kit/scripts/publish-packages.mjs` | 按顺序发布全部 @skillchat/harness-* 包 |

---

## 7. 管理后台：联网搜索与生图

SkillChat 在 **设置 → 系统 → 运行配置** 中提供与 HarnessKit [ADVANCED.md](../harness-kit/docs/ADVANCED.md) 对齐的能力配置，分三块折叠面板：

1. **聊天模型** — `OPENAI_*`、Reasoning、Token 上限  
2. **联网搜索** — `WEB_SEARCH_MODE`、Native 策略、Tavily / Serper / Brave Key  
3. **图片生成** — Native 策略、OpenAI Images / 智谱 / 百炼 三方通道  

修改后点击「保存运行配置」即可热更新，无需重启服务。`.env` 中的同名变量仅作首次启动默认值。

HarnessKit Demo（`npm run dev:demo`）通过 `examples/minimal-server/.env` 配置同等能力，详见 [examples/demo/README.md](../harness-kit/examples/demo/README.md)。

---

## 8. 常见问题

**Q: Docker 构建报找不到 `@skillchat/harness-*`？**  
A: 确认已 `npm run publish:packages`，且 `HARNESSKIT_VERSION` 与已发布版本一致；私有源需把 `.npmrc` 传入构建环境。

**Q: 开发时改了 harness-kit 但 skill-chat 没变化？**  
A: 运行 `npm run build:harness-kit`，必要时重启 `dev:server` / `dev:web`。

**Q: 能否长期把 registry 版本提交到 main？**  
A: 可以，团队统一用 `harness:local` 切回 file: 即可；或 main 保持 file:、仅在 release 分支 / tag 使用 registry。
