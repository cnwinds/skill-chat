# 管理员启动引导与系统配置需求设计

## 1. 背景

当前 SkillChat 已具备以下基础能力：

- 用户表已存在 `role` 字段，支持 `admin` / `member`
- 用户注册当前强制依赖邀请码
- 邀请码当前仅支持 CLI 生成
- 登录后通过 JWT 鉴权访问业务接口

但当前系统缺少以下关键管理能力：

- 系统首次启动时，无法通过产品界面完成管理员初始化
- 管理员无法在 Web 端管理所有用户
- 管理员无法在 Web 端管理邀请码
- 系统缺少“系统配置”持久化能力
- 无法动态配置“用户注册是否需要邀请码”

这导致部署后的初始化和运维仍然依赖命令行，且部分角色能力虽然在数据结构上存在，但没有完整产品闭环。

---

## 2. 本次目标

本次需求目标是补齐最小可用的后台管理闭环，使系统在首次启动后可通过 Web 端完成基础管理。

目标包括：

1. 系统首次启动时，允许创建第一个管理员用户
2. 管理员可登录后管理全站用户
3. 管理员可管理邀请码
4. 管理员可查看和修改系统配置
5. 系统配置中新增“注册是否需要邀请码”开关
6. 系统配置页尽量承接当前 `.env` 中适合在线管理的配置项

本次设计强调：

- 保持与当前后端 Fastify + SQLite + JWT 架构一致
- 优先做最小可用闭环，不引入复杂 RBAC
- 配置修改持久化到数据库，不依赖重启和 `.env`
- 保持默认安全策略，即默认仍为“注册需要邀请码”

---

## 3. 非目标

本次不纳入：

- 多级角色体系，例如超级管理员、运营管理员、审计员
- 复杂权限点配置
- 邀请码过期时间、使用次数上限等高级能力
- 用户禁用后立即强制踢出在线会话
- 操作审计日志
- 通用系统设置中心的大量配置项
- 第三方登录、邮箱验证、短信验证码

---

## 4. 现状分析

### 4.1 后端现状

当前后端已有基础：

- 用户表 `users`
  - 包含 `id`、`username`、`password`、`role`
- 邀请码表 `invite_codes`
  - 包含 `code`、`created_by`、`used_by`、`used_at`
- 注册接口 `POST /api/auth/register`
  - 当前强制要求 `inviteCode`
- 登录接口 `POST /api/auth/login`
- JWT 中已携带 `role`

当前缺失：

- 系统配置表
- 首次启动判断逻辑
- 管理员接口
- 管理员前端页面
- 基于管理员身份的接口保护中间层

### 4.2 前端现状

当前前端只有普通用户界面：

- 登录页
- 注册页
- 会话列表
- 文件和 Skill 面板

当前缺失：

- 管理后台入口
- 用户管理页面
- 邀请码管理页面
- 系统配置页面
- 首次启动管理员创建页

---

## 5. 总体方案

整体采用以下策略：

1. 新增“系统状态/系统配置”概念
2. 用数据库持久化系统配置，而不是写回 `.env`
3. 当系统中还没有任何管理员时，开放一次性的“管理员初始化”
4. 初始化完成后，普通注册流程遵循系统配置
5. 所有管理接口统一要求当前用户角色为 `admin`

系统行为分两阶段：

- 阶段 A：未初始化管理员
  - 允许访问“首次创建管理员”接口
  - 不允许通过普通注册接口绕过管理员初始化
- 阶段 B：已存在管理员
  - 首次初始化接口关闭
  - 系统按配置运行

---

## 6. 角色与权限

本次保留两类角色：

### 6.1 admin

管理员拥有：

- 查看所有用户
- 查看单个用户基础信息
- 调整用户角色
- 禁用或启用用户
- 查看邀请码列表
- 创建邀请码
- 删除未使用邀请码
- 查看系统配置
- 修改系统配置

### 6.2 member

普通用户仅拥有：

- 登录
- 注册
- 使用自己的会话与文件能力
- 无权访问任何管理员接口

---

## 7. 关键业务规则

### 7.1 首次启动管理员创建规则

- 当 `users` 表中 `role = 'admin'` 的用户数量为 `0` 时，系统视为“未初始化管理员”
- 未初始化管理员时：
  - 前端登录/注册页应能识别系统处于初始化模式
  - 展示“创建管理员账户”入口
  - `POST /api/system/bootstrap-admin` 可调用
- 一旦创建成功第一个管理员：
  - 该接口永久关闭
  - 后续返回 `409 Conflict` 或等价业务错误

### 7.2 普通注册规则

新增系统配置项：

- `registration_requires_invite_code: boolean`

业务规则：

- 默认值为 `true`
- 当为 `true` 时：
  - 普通用户注册必须提供有效邀请码
- 当为 `false` 时：
  - 普通用户允许直接注册
  - 注册时 `inviteCode` 可为空
- 无论开关如何：
  - 首个管理员创建不走普通注册接口
  - 首个管理员创建不依赖邀请码

### 7.3 管理员创建邀请码规则

- 仅管理员可创建邀请码
- 支持批量创建
- 默认每次创建 1 个，管理员可指定批量数量
- 已被使用的邀请码不可删除
- 未使用的邀请码允许删除

### 7.4 用户管理规则

管理员可以管理所有用户，但需要限制以下高风险场景：

- 不允许删除最后一个管理员
- 不允许将最后一个管理员降级为 `member`
- 不允许禁用最后一个管理员
- 管理员不能删除自己当前账号，除非系统中仍有其他管理员

本次建议先实现：

- 用户列表
- 用户角色修改
- 用户启用/禁用

本期明确不做“删除用户”，避免连带清理会话、文件、邀请码关系带来高复杂度。

---

## 8. 数据模型设计

### 8.1 新增 `system_settings` 表

建议新增：

```sql
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by TEXT REFERENCES users(id)
);
```

首批必须支持：

- `registration_requires_invite_code`

后续建议逐步纳入当前 `.env` 中适合在线管理、且变更后不需要重建工作目录的数据型配置。优先级建议如下：

- 第一批
  - `registration_requires_invite_code`
  - `default_session_active_skills`
  - `enable_assistant_tools`
  - `web_origin`
  - `openai_model_router`
  - `openai_model_planner`
  - `openai_model_reply`
  - `openai_reasoning_effort_reply`
  - `llm_max_output_tokens`
  - `tool_max_output_tokens`
- 第二批
  - `anthropic_model_router`
  - `anthropic_model_planner`
  - `anthropic_model_reply`
  - `run_timeout_ms`
  - `max_concurrent_runs`
- 不建议放入系统配置页的项
  - `jwt_secret`
  - `openai_api_key`
  - `anthropic_api_key`
  - `db_path`
  - `data_root`
  - `cwd`
  - 其他涉及部署路径、密钥、进程级启动参数的配置

存储建议：

- 统一使用字符串存储
- 布尔值用 `"true"` / `"false"`
- 服务层负责解析与默认值兜底
- 白名单内配置保存后实时生效，新请求直接读取数据库中的最新值

### 8.2 建议扩展 `users` 表

建议新增：

```sql
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled'));
```

用途：

- 支持管理员禁用用户
- 被禁用用户不能登录

可选新增：

- `updated_at`
- `last_login_at`

如果本期追求最小改动，可只加 `status`。

### 8.3 新增 `user_settings` 表

用于保存用户个性化偏好设置，不属于系统级配置。

建议新增：

```sql
CREATE TABLE IF NOT EXISTS user_settings (
  user_id TEXT NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, key)
);
```

首批用户偏好项：

- `theme_mode`

说明：

- `theme_mode` 取值建议为 `light` / `dark`
- 主题模式属于用户个人偏好，不纳入管理员系统配置页
- 用户修改后应在刷新、重新登录、跨会话访问时保持一致

### 8.4 `invite_codes` 表

当前表可继续使用，暂不强制改动。

可选增强字段：

- `deleted_at`

如果本期只做硬删除未使用邀请码，则不需要新增字段。

---

## 9. 后端接口设计

## 9.1 系统状态接口

### `GET /api/system/status`

用途：

- 前端在登录页/注册页判断系统是否已完成管理员初始化
- 判断当前注册是否需要邀请码

返回示例：

```json
{
  "initialized": true,
  "hasAdmin": true,
  "registrationRequiresInviteCode": true
}
```

未登录可访问。

---

## 9.2 首次管理员初始化接口

### `POST /api/system/bootstrap-admin`

请求：

```json
{
  "username": "admin",
  "password": "strong-password"
}
```

规则：

- 仅在系统尚无管理员时可调用
- 创建成功后返回 JWT 与用户信息

返回示例：

```json
{
  "user": {
    "id": "u_admin_1",
    "username": "admin",
    "role": "admin"
  },
  "token": "..."
}
```

失败场景：

- 已存在管理员：`409`
- 用户名重复：`400`
- 参数不合法：`400`

---

## 9.3 普通注册接口调整

### `POST /api/auth/register`

当前请求固定要求：

```json
{
  "username": "alice",
  "password": "password123",
  "inviteCode": "INV-XXXX"
}
```

调整后：

- `inviteCode` 变为条件可选
- 服务端根据系统配置决定是否必填

建议请求体设计：

```json
{
  "username": "alice",
  "password": "password123",
  "inviteCode": "INV-XXXX"
}
```

说明：

- 前端可以继续传 `inviteCode`
- 当系统配置为“不需要邀请码”时，该字段允许为空或不传

---

## 9.4 管理员系统配置接口

### `GET /api/admin/system-settings`

返回示例：

```json
{
  "registrationRequiresInviteCode": true,
  "defaultSessionActiveSkills": ["pdf", "docx"],
  "enableAssistantTools": true,
  "webOrigin": "http://localhost:5173",
  "modelConfig": {
    "openaiModelRouter": "gpt-4o-mini",
    "openaiModelPlanner": "gpt-4o-mini",
    "openaiModelReply": "gpt-5.4",
    "openaiReasoningEffortReply": "high",
    "llmMaxOutputTokens": 4096,
    "toolMaxOutputTokens": 3072
  }
}
```

### `PATCH /api/admin/system-settings`

请求示例：

```json
{
  "registrationRequiresInviteCode": false,
  "enableAssistantTools": true
}
```

规则：

- 仅管理员可访问
- 修改后立即生效
- 仅允许修改白名单配置项
- 密钥、数据库路径、目录路径等敏感或进程级配置不允许在线修改
- 模型配置、token 上限等常用运行参数属于第一批可在线修改项

---

## 9.5 管理员用户管理接口

### `GET /api/me/settings`

返回当前用户偏好设置。

返回示例：

```json
{
  "themeMode": "dark"
}
```

### `PATCH /api/me/settings`

请求示例：

```json
{
  "themeMode": "light"
}
```

规则：

- 登录用户均可访问
- 仅修改当前用户自己的偏好项
- 修改后立即生效，并在后续访问中保持

### `GET /api/admin/users`

返回示例：

```json
[
  {
    "id": "u1",
    "username": "admin",
    "role": "admin",
    "status": "active",
    "createdAt": "2026-04-12T00:00:00.000Z"
  },
  {
    "id": "u2",
    "username": "alice",
    "role": "member",
    "status": "active",
    "createdAt": "2026-04-12T00:10:00.000Z"
  }
]
```

### `PATCH /api/admin/users/:id`

请求示例：

```json
{
  "role": "member",
  "status": "disabled"
}
```

规则：

- 仅管理员可访问
- 至少保留一个启用中的管理员

---

## 9.6 管理员邀请码管理接口

### `GET /api/admin/invite-codes`

返回邀请码列表，包含：

- `code`
- `createdBy`
- `usedBy`
- `usedAt`
- `createdAt`

### `POST /api/admin/invite-codes`

请求示例：

```json
{
  "count": 5
}
```

返回示例：

```json
{
  "codes": [
    "INV-AAAA1111",
    "INV-BBBB2222"
  ]
}
```

### `DELETE /api/admin/invite-codes/:code`

规则：

- 仅允许删除未使用邀请码

---

## 10. 前端页面设计

## 10.1 登录/注册页

新增系统状态判断逻辑：

- 页面加载时请求 `/api/system/status`

展示规则：

- 如果 `initialized = false`
  - 显示“初始化管理员账户”入口
  - 普通注册入口隐藏或置灰
- 如果 `initialized = true`
  - 显示正常登录/注册页面
- 如果 `registrationRequiresInviteCode = false`
  - 注册页隐藏邀请码输入框
- 如果 `registrationRequiresInviteCode = true`
  - 注册页显示邀请码输入框

## 10.2 初始化管理员页

独立页面建议：

- `/bootstrap-admin`

字段：

- 用户名
- 密码
- 确认密码

提交成功后：

- 自动登录
- 进入系统

## 10.3 管理后台入口

登录后若 `user.role = admin`：

- 在当前应用左侧导航中增加“设置”按钮
- 仅管理员可见
- 点击后进入应用内的管理设置区，而不是独立后台系统

普通用户：

- 不显示“设置”按钮
- 即使手工访问管理路由，也应被前端拦截并由后端鉴权拒绝

## 10.4 管理后台结构

建议先做四块能力：

1. 用户管理
2. 系统配置
3. 邀请码管理
4. 当前用户偏好设置

### 用户管理页

展示：

- 用户名
- 角色
- 状态
- 创建时间

操作：

- 切换角色
- 启用/禁用

### 系统配置页

展示：

- 注册是否需要邀请码
- 默认会话激活技能
- 是否启用 Assistant Tools
- Web Origin
- 模型相关配置
  - Router / Planner / Reply model
  - reasoning effort
  - token 上限类参数

操作：

- 开关切换
- 文本或下拉编辑
- 保存提示

建议在页面上显式区分两类配置：

- 可立即生效配置
- 需要谨慎修改的运行配置

并明确说明：

- 密钥与路径类配置仍保留在 `.env`
- 系统配置页不会展示也不会修改这些敏感项

### 当前用户偏好设置

展示：

- 黑白主题切换按钮

规则：

- 对所有登录用户可见
- 属于用户个人偏好，不依赖管理员权限
- 修改后立即生效
- 需要写入用户设置并在刷新、重新登录后恢复

### 邀请码管理页

展示：

- 邀请码
- 是否已使用
- 使用者
- 创建时间

操作：

- 创建邀请码
- 复制邀请码
- 删除未使用邀请码

约束：

- 支持批量创建
- 单次创建上限为 `100`

---

## 11. 服务端模块拆分建议

建议新增模块：

### `SystemSettingsService`

职责：

- 读取系统配置
- 写入系统配置
- 提供默认值
- 判断系统初始化状态

### `AdminService`

职责：

- 用户管理
- 邀请码管理
- 后台聚合接口

### `AdminGuard`

职责：

- 校验当前登录用户是否为管理员

如果当前工程倾向简单实现，也可以先不拆 guard，直接在接口内校验 `request.user.role === 'admin'`。

---

## 12. 注册流程设计

## 12.1 首次启动

1. 前端调用 `/api/system/status`
2. 若发现 `hasAdmin = false`
3. 前端跳转或展示“创建管理员”
4. 用户提交管理员账号密码
5. 后端创建 `admin`
6. 返回 JWT
7. 前端登录进入系统

## 12.2 普通注册

1. 前端调用 `/api/system/status`
2. 根据 `registrationRequiresInviteCode` 决定是否显示邀请码输入框
3. 用户提交注册
4. 后端按配置校验邀请码
5. 创建 `member`
6. 返回 JWT

---

## 13. 迁移设计

数据库迁移建议顺序：

1. 若 `users.status` 不存在，补充字段
2. 创建 `system_settings` 表
3. 写入默认配置：
   - `registration_requires_invite_code = true`

兼容性要求：

- 老库升级后无需手工初始化配置
- 老版本已有用户时：
  - 若已经存在管理员，则系统视为已初始化
  - 若没有管理员，则进入管理员初始化模式
- 老版本 `.env` 中已有可映射配置时：
  - 首次启动升级后可按当前 `.env` 值写入数据库默认项
  - 写入后以数据库配置为准

---

## 14. 安全与风控要求

### 14.1 默认安全原则

- 默认注册仍需邀请码
- 首次管理员创建只允许一次
- 所有管理员接口都必须鉴权并校验角色
- 首次管理员初始化不额外增加初始化口令

### 14.2 风险点

- 首次启动窗口若被非预期用户访问，可能抢占管理员身份

缓解建议：

- 部署文档中明确要求首次启动后立即初始化管理员
- 可选增强：
  - 引导页增加初始化口令
  - 仅允许本地地址初始化

本期建议先不做额外初始化口令，保持最小实现。

---

## 15. 测试建议

需要覆盖以下测试：

### 后端测试

- 无管理员时，`/api/system/status` 返回未初始化
- 无管理员时，可成功调用 `/api/system/bootstrap-admin`
- 创建首个管理员后，再次调用 bootstrap 接口失败
- `registrationRequiresInviteCode = true` 时，注册缺少邀请码失败
- `registrationRequiresInviteCode = false` 时，注册可成功
- 普通用户访问 `/api/admin/*` 全部失败
- 管理员可查看用户列表
- 管理员可修改系统配置
- 管理员可批量创建邀请码
- 管理员删除已使用邀请码失败
- 不允许移除最后一个管理员身份
- 模型配置、token 上限等白名单运行配置修改后可实时生效
- 主题模式保存后刷新或重新登录仍保持

### 前端测试

- 未初始化时显示管理员初始化入口
- 初始化后隐藏该入口
- 注册页根据系统配置显示或隐藏邀请码输入框
- 管理员用户在左侧导航看到应用内“设置”入口
- 普通用户看不到后台入口
- 主题切换按钮切换后 UI 正确更新且配置持久化

---

## 16. 验收标准

满足以下条件视为需求完成：

1. 新部署系统在无管理员时，可以通过前端创建第一个管理员
2. 第一个管理员创建后，初始化入口失效
3. 管理员可在前端查看所有用户
4. 管理员可调整用户角色和启用状态
5. 管理员可在前端批量创建和查看邀请码
6. 管理员可在系统配置中切换“注册是否需要邀请码”
7. 管理员可在系统配置中管理白名单内的运行配置项
8. 切换后注册页面与后端校验行为一致
9. 模型配置、max token 等常用配置修改后对后续请求实时生效
10. 管理员通过左侧导航中的“设置”入口访问后台能力
11. 黑白主题切换状态可持久化并在后续访问中恢复
12. 普通用户无法访问任何管理员功能

---

## 17. 分期建议

建议一次性实现，但内部仍按以下顺序推进：

1. 首次启动管理员初始化
2. 系统状态与系统配置持久化
3. 管理员接口
4. 当前应用内的“设置”入口与管理页面

---

## 18. 待确认问题

当前已确认：

1. 本期不删除用户，只做禁用/启用
2. 邀请码支持批量创建
3. 系统配置页尽量纳入 `.env` 中适合在线管理的配置项，敏感项与路径项除外
4. 首次管理员初始化不增加额外口令保护
5. 管理后台放在当前应用内，通过左侧导航中的管理员可见“设置”按钮进入
6. 常用模型配置和 max token 等运行配置要支持在线修改并实时生效
7. 邀请码批量创建单次上限为 `100`
8. 增加黑白主题切换按钮，配置需持久化记录
9. 主题模式属于每个用户自己的偏好设置，记录到用户设置中，不属于系统级配置

仍建议实现前再补充确认的细节：

1. 左侧导航“设置”按钮是否进入单页 tabs，还是单独 settings route
