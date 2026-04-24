# Auth Refactor Plan

## 目标

- 去掉前端 `localStorage + Bearer` 鉴权链路。
- 改为浏览器侧 `HttpOnly` Cookie，会话由服务端控制。
- 支持服务端注销、会话失效和后续图片二进制预览。
- 为后续 `gpt-image-2` 生图/改图能力铺平鉴权基础。

## 改造范围

### 1. 浏览器鉴权传输

- 前端不再保存 access token。
- 所有 `fetch` 和 SSE 请求统一走 `credentials: 'include'`。
- 启动时通过 `GET /api/auth/session` 恢复登录态。
- 登出走 `POST /api/auth/logout`，不再只清本地状态。

### 2. 服务端会话模型

- 登录、注册、初始化管理员成功后，服务端创建随机 opaque session token。
- token 只通过 `HttpOnly` Cookie 下发给浏览器。
- 数据库新增 `auth_sessions` 表，保存：
  - `id`
  - `user_id`
  - `token_hash`
  - `expires_at`
  - `created_at`
  - `last_seen_at`
- 服务端鉴权改为：
  - 从 Cookie 读取 token
  - 哈希后查库
  - 校验过期时间
  - 读取用户最新角色/状态

### 3. 注销与失效控制

- `POST /api/auth/logout` 删除当前 session 记录并清 Cookie。
- 禁用用户后，请求会在服务端按最新用户状态被拒绝。
- 过期 session 在读取和创建新 session 时清理。

### 4. Cookie 模式下的浏览器安全收口

- CORS 从“反射任意来源”改为只允许 `WEB_ORIGIN`。
- 对 `POST/PUT/PATCH/DELETE` 增加来源校验：
  - 无 `Origin` 的非浏览器请求允许
  - 有 `Origin` 时必须等于 `WEB_ORIGIN`
- Cookie 继续使用 `HttpOnly`，避免前端脚本读取。

## 完成标准

- 前端无 `Authorization: Bearer` 和本地 token 持久化。
- 服务端不再依赖 JWT 校验浏览器登录态。
- 用户退出后，旧 Cookie 重放失败。
- 受保护接口和 SSE 均使用 Cookie 会话。
- Web 端类型检查和测试通过。
- Server 端至少完成类型检查；运行时测试受本机原生模块环境影响时需单独记录。

## 对图片能力的直接收益

- 后续图片下载、Blob 预览、改图上传都可以直接复用同一套 Cookie 会话。
- 前端不需要把鉴权 token 暴露给 `img`、`fetch` 或第三方组件。
- `gpt-image-2` 返回的文件只要落到现有文件服务，就能复用当前鉴权与下载链路。
