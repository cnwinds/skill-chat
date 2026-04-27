# SkillChat / SkillMarket / Official Skills 三项目核心设计

## 1. 项目边界

本轮拆分为三个项目，不再把 skill 内容、市场管理和聊天运行时放在同一个代码库里。

```text
C:\projects\skill-market
  Skill 市场和契约源头。负责 skill 查询、详情、版本、包下载、发布审核、共享 schema。

C:\projects\official-skills
  官方 skill 包集合。负责维护 pdf/xlsx/docx/角色类等官方 skill 的源码、校验和打包。

C:\projects\skill-chat
  SkillChat 应用。当前是 C:\projects\qizhi 的 junction。负责连接市场、安装 skill、会话启用、运行 skill。
```

核心原则：

1. SkillMarket 只分发和治理，不执行 skill。
2. SkillChat 只运行本地已安装、且当前会话已启用的 skill。
3. Official Skills 只生产符合契约的 skill 包，不关心聊天应用内部实现。
4. `skill-market/packages/skill-spec` 是三项目唯一契约源头。

## 2. 共享契约

共享契约包名：

```text
@qizhi/skill-spec
```

源头位置：

```text
C:\projects\skill-market\packages\skill-spec
```

契约包含：

- `skill.json` manifest schema
- market API 数据结构
- install request / installed record 数据结构
- 包布局规则
- id、version、permission、runtime 的语义

三项目使用方式：

- `skill-market` 直接引用本地 package。
- `official-skills` 用该 package 校验每个 skill 目录。
- `skill-chat` 用该 package 校验市场 manifest 和下载后的 package。

## 3. Skill 包结构

每个 skill 包根目录必须包含：

```text
skill.json
SKILL.md
```

可选目录：

```text
references/
scripts/
assets/
examples/
```

推荐完整结构：

```text
official-pdf/
  skill.json
  SKILL.md
  README.md
  CHANGELOG.md
  LICENSE
  scripts/
  references/
  assets/
  examples/
```

`skill.json` 是程序契约，`SKILL.md` 是给模型阅读的使用说明。市场列表、安装校验、权限展示都以 `skill.json` 为准。

## 4. Skill 身份

Skill 的稳定身份使用：

```text
{publisher}/{name}
```

示例：

```text
official/pdf
official/xlsx
official/docx
official/zhangxuefeng-perspective
```

版本使用 SemVer：

```text
1.0.0
1.1.0
2.0.0
```

运行时可引用为：

```text
official/pdf@1.0.0
```

第一阶段 SkillChat 可以继续兼容旧的 `pdf`、`xlsx`、`docx` 名称，但新安装和新会话应使用 canonical id。

## 5. Skill 类型

`kind` 分三类：

```text
instruction
  只提供说明和参考资料，不执行脚本。适合角色、观点、方法论类 skill。

runtime
  主要通过脚本生成产物。适合 pdf/xlsx/docx 等。

hybrid
  同时有参考资料和脚本能力。
```

SkillChat 根据 `kind` 决定 UI 和工具暴露：

- `instruction`：允许读取 `SKILL.md` 和 `references`，不暴露脚本运行工具。
- `runtime`：允许暴露受控 runner 工具。
- `hybrid`：两者都允许，但仍受 permissions 约束。

## 6. 权限模型

Manifest 中必须显式声明权限。第一阶段权限只做粗粒度治理：

```json
{
  "permissions": {
    "filesystem": ["uploads:read", "outputs:write", "tmp:write"],
    "network": false,
    "scripts": true,
    "secrets": []
  }
}
```

SkillChat 执行时以本地策略为最终裁决：

- 未声明 `scripts: true` 的 skill 不可执行脚本。
- 未声明 `network` 的 skill 脚本不应获得联网能力。
- 文件访问只能在当前用户、当前会话、shared 和 skill 自身资源范围内。
- SkillMarket 的权限声明只用于展示和预审，不能替代 SkillChat 运行时边界。

## 7. Market API

第一阶段只实现安装所需的只读 API：

```text
GET /api/v1/skills
GET /api/v1/skills/{publisher}/{name}
GET /api/v1/skills/{publisher}/{name}/versions
GET /api/v1/skills/{publisher}/{name}/versions/{version}/manifest
GET /api/v1/skills/{publisher}/{name}/versions/{version}/package
```

发布、审核、下架等 API 第二阶段再做。

包下载格式第一阶段使用 `.tgz`。包根目录解开后必须直接看到 `skill.json` 和 `SKILL.md`。

## 8. SkillChat 安装流程

```text
用户/管理员点击安装
  -> SkillChat 请求 market manifest
  -> 校验 skillSpecVersion、id、version、compatibility、permissions
  -> 下载 .tgz 到 staging
  -> 解压到临时目录
  -> 禁止路径穿越和 symlink
  -> 校验 skill.json 与 market manifest 一致
  -> 校验 checksum
  -> 原子移动到 data/installed-skills/{publisher}/{name}/{version}
  -> 写入 installed_skills 表
  -> SkillRegistry reload
```

安装目录：

```text
data/installed-skills/
  official/
    pdf/
      1.0.0/
        skill.json
        SKILL.md
```

旧的仓库根目录 `skills/` 只作为迁移兼容目录，不再是长期真相来源。

## 9. SkillChat 会话启用

当前已有 `activeSkills` 会话白名单，保留该产品模型。

新语义：

```text
activeSkills = ["official/pdf", "official/zhangxuefeng-perspective"]
```

SkillRegistry 返回给 harness 的只有当前会话启用的 skill。模型不能看到未启用 skill 的 `SKILL.md`、references 或 scripts。

已安装 skill 对模型暴露为统一虚拟路径：

```text
skills/{publisher}/{name}/SKILL.md
skills/{publisher}/{name}/references/...
skills/{publisher}/{name}/scripts/...
```

例如：

```text
skills/official/pdf/SKILL.md
```

SkillChat 内部再把该虚拟路径映射到：

```text
data/installed-skills/official/pdf/{version}/...
```

这避免模型或工具层直接依赖本机绝对路径，也让 legacy skill 与 market-installed skill 使用同一种访问形态。

## 10. 三项目并行开发规则

为了避免信息割裂：

1. 所有契约变更先改 `@qizhi/skill-spec`。
2. API 字段不能在各项目私自发明。
3. 每个项目必须维护 `docs/HANDOFF.md`。
4. 每个项目必须有本地验证命令。
5. 第一阶段用 mock 和固定官方包打通纵向链路。

## 11. 第一阶段验收

最小闭环：

1. `official-skills` 能校验并打包 `official/pdf`。
2. `skill-market` 能列出 `official/pdf`，返回 manifest，并下载 `.tgz`。
3. `skill-chat` 能从 market 安装 `official/pdf`。
4. `skill-chat` 新建会话时能启用 `official/pdf`。
5. 启用后模型只能看到该 skill。
6. 旧的本地 `skills/` 目录仍可临时兼容，不能阻断现有功能。
