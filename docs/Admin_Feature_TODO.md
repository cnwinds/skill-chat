# 管理员与系统配置实现 TODO

## 1. 数据与共享契约

- [x] 新增 `system_settings` 表与默认配置写入
- [x] 新增 `user_settings` 表
- [x] 为 `users` 表补充 `status`
- [x] 扩展 shared types / schemas，支持系统状态、系统配置、用户设置、管理员接口数据结构

## 2. 后端鉴权与配置

- [x] 实现 `SystemSettingsService`
- [x] 实现用户设置服务
- [x] 实现首次管理员初始化逻辑
- [x] 调整注册逻辑，按系统配置决定是否需要邀请码
- [x] 调整登录逻辑，禁用用户不可登录
- [x] 让模型与运行配置从数据库设置读取并实时生效

## 3. 后端管理员接口

- [x] `GET /api/system/status`
- [x] `POST /api/system/bootstrap-admin`
- [x] `GET/PATCH /api/admin/system-settings`
- [x] `GET/PATCH /api/admin/users`
- [x] `GET/POST/DELETE /api/admin/invite-codes`
- [x] `GET/PATCH /api/me/settings`

## 4. 前端体验

- [x] 登录/注册页接入系统状态
- [x] 新增管理员初始化页
- [x] 左侧导航增加管理员“设置”入口
- [x] 新增管理员设置页：用户管理 / 系统配置 / 邀请码管理
- [x] 新增用户主题切换并持久化
- [x] 应用黑白主题样式

## 5. 测试与验收

- [x] 后端迁移与服务单测
- [x] 后端接口集成测试
- [x] 前端页面与交互测试
- [x] `apps/server` 测试通过
- [x] `apps/web` 测试通过
- [x] 全仓 `npm test` / `npm run build` / `npm run typecheck` 通过
