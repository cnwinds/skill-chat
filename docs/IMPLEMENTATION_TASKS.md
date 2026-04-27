# SkillChat 首轮实现任务

## 写入范围

本项目只写：

```text
C:\projects\skill-chat
```

注意：这是 `C:\projects\qizhi` 的 junction，真实 git 工作树是 `C:\projects\qizhi`。

可以只读：

```text
C:\projects\skill-market\packages\skill-spec
C:\projects\official-skills
```

不要修改：

```text
C:\projects\skill-market
C:\projects\official-skills
```

## 目标

让 SkillChat 具备从 SkillMarket 安装 skill 的后端基础，同时不破坏现有本地 `skills/` 兼容逻辑。

## 必做

1. 在 server 端新增 market/installed skill 设计实现。
2. 新增配置：

```text
MARKET_BASE_URL
INSTALLED_SKILLS_ROOT
```

默认：

```text
MARKET_BASE_URL=http://localhost:3100
INSTALLED_SKILLS_ROOT={DATA_ROOT}/installed-skills
```

3. 新增 SQLite 表或等价持久化：

```text
installed_skills
```

字段至少包括：

```text
id
version
manifest_json
install_path
source_market_url
status
installed_at
updated_at
```

4. 新增服务：

```text
MarketClient
SkillInstallService
InstalledSkillRegistry 或扩展 SkillRegistry
```

5. 新增 API：

```text
GET /api/market/skills
GET /api/skills/installed
POST /api/skills/install
```

6. 安装流程必须：

- 请求 market manifest
- 下载 package
- 解压到 staging
- 校验 `skill.json` 和 `SKILL.md`
- 使用 `@qizhi/skill-spec` 校验 manifest
- 禁止路径穿越和 symlink
- 原子移动到 installed root
- registry reload

7. `SkillRegistry` 必须继续兼容旧 `SKILLS_ROOT`，不要阻断现有测试。
8. 更新 `docs/HANDOFF.md`，说明新增 API 和本地验证方法。

## 可选

- 前端增加“市场 / 已安装”区分。
- 会话 active skill 从旧 slug 迁移到 canonical id。

## 禁止

- 不要移除当前 `skills/` 目录逻辑。
- 不要让前端直接下载和解压包。
- 不要执行安装包里的脚本。
- 不要改动 skill-market 或 official-skills。

## 验收

```powershell
npm install
npm run typecheck
npm test
```

