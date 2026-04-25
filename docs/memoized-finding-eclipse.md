# SkillChat 前端整体重构计划

## Context

`apps/web/` 当前前端架构存在三个核心问题：

1. **结构失衡**：`App.tsx` 单文件 2060 行，包含 12 个组件；`SessionWorkspace` 一个组件就 1100+ 行，把会话列表、聊天主区、设置中心、Composer、Inspector 全部塞在一起。`/app/settings` 路由共享 `SessionWorkspace`，靠 `isSettingsView` 布尔分支切换内容——路由与组件结构不对齐。
2. **样式失控**：`index.css` 单文件 1747 行全局样式，没有 design token 体系（只有颜色变量），用大量 backdrop-filter + 径向渐变 + 高饱和橙色，视觉与 claude.ai 极简风差距显著。
3. **移动端是补丁**：仅两个断点（1180/900），侧栏 drawer 是手写 transform，无 backdrop / 焦点陷阱 / 手势，没有为平板/竖屏专门设计。

**目标**：参考 claude.ai 的极简对话界面，引入 Tailwind CSS + shadcn/ui，对桌面 web 和手机 web 同时优化体验，同时保持后端 API、状态层（TanStack Query / zustand）、SSE 流式契约不变。

## 技术选型

- **Tailwind CSS v3**（v4 仍偏新，部分 shadcn 模板未跟上；v3 + shadcn 是经过验证的组合）
- **shadcn/ui**（手动复制源码到 `components/ui/`，不是依赖包，方便 patch）
- **lucide-react** 替换内联 SVG 图标
- **@radix-ui/* 系列**（shadcn 依赖）：Dialog / Tabs / Tooltip / Dropdown / Sheet / ScrollArea / Toast / Accordion
- **tailwind-merge + class-variance-authority**（shadcn 标配）
- 保留：React 19、Vite 8、TanStack Query、zustand、react-router-dom、react-markdown、@microsoft/fetch-event-source、`@skillchat/shared`

## 目标文件结构

```
apps/web/src/
├── main.tsx
├── App.tsx                          (≤ 60 行，仅路由表)
├── index.css                        (Tailwind 三层指令 + 设计 token CSS 变量)
├── routes/
│   ├── auth/
│   │   ├── AuthLayout.tsx           (登录/注册页共用 shell)
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   └── BootstrapAdminPage.tsx
│   └── app/
│       ├── AppShell.tsx             (侧栏 + 顶栏 + Outlet 布局)
│       ├── ChatPage.tsx             (消息流 + composer)
│       └── SettingsPage.tsx         (admin 设置中心)
├── components/
│   ├── ui/                          (shadcn 生成的基础组件)
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   ├── sheet.tsx                (移动 drawer)
│   │   ├── tabs.tsx
│   │   ├── tooltip.tsx
│   │   ├── dropdown-menu.tsx
│   │   ├── scroll-area.tsx
│   │   ├── input.tsx
│   │   ├── textarea.tsx
│   │   ├── toast.tsx / toaster.tsx
│   │   └── accordion.tsx
│   ├── chat/
│   │   ├── MessageList.tsx          (虚拟滚动 + 自动跟随底部)
│   │   ├── MessageItem.tsx          (重构后保留 props/exports，便于测试沿用)
│   │   ├── AssistantMessage.tsx     (无气泡：纯排版 + 左侧可选 avatar)
│   │   ├── UserMessage.tsx          (右对齐柔和气泡)
│   │   ├── ThinkingIndicator.tsx
│   │   ├── ToolTraceCard.tsx        (Accordion 折叠)
│   │   ├── ImageMessage.tsx
│   │   ├── FileMessage.tsx
│   │   ├── ErrorMessage.tsx
│   │   ├── AssistantMetaFooter.tsx
│   │   ├── Composer.tsx             (textarea + 工具栏 + 附件)
│   │   ├── AttachmentChips.tsx
│   │   ├── FollowUpQueue.tsx        (待处理输入)
│   │   ├── EmptyChat.tsx
│   │   └── RecoveryBanner.tsx
│   ├── sidebar/
│   │   ├── Sidebar.tsx              (桌面常驻 / 移动 Sheet)
│   │   ├── SessionList.tsx
│   │   ├── SessionItem.tsx
│   │   ├── NewSessionButton.tsx
│   │   └── NewSessionDialog.tsx
│   ├── inspector/
│   │   ├── InspectorPanel.tsx       (Tabs 容器，桌面右侧 / 移动 Sheet)
│   │   ├── FilesTab.tsx
│   │   ├── SkillsTab.tsx
│   │   └── SkillCard.tsx
│   ├── settings/
│   │   ├── UsersTab.tsx
│   │   ├── SystemTab.tsx
│   │   └── InvitesTab.tsx
│   └── layout/
│       ├── ChatHeader.tsx           (会话标题 + 状态 pill + 操作)
│       ├── MobileTabBar.tsx         (底部 tab：会话/聊天/文件)
│       └── ThemeToggle.tsx
├── hooks/
│   ├── useSessionStream.ts          (保留)
│   ├── useFilePreviewUrl.ts         (保留)
│   ├── useComposerAttachments.ts    (新：从 SessionWorkspace 抽出)
│   ├── useKeyboardInset.ts          (新：visualViewport 处理)
│   ├── useMediaQuery.ts             (新：响应式断点 hook)
│   └── useAutoScrollToBottom.ts     (新：消息流自动跟随底部)
├── stores/                          (保留 auth / ui / preferences)
├── lib/
│   ├── api.ts                       (保留)
│   ├── timeline.ts                  (保留)
│   ├── utils.ts                     (保留 formatBytes/groupBy/isWechatBrowser)
│   └── cn.ts                        (新：clsx + tailwind-merge，shadcn 标准)
└── test/
    └── setup.ts                     (保留)
```

## 视觉规范（claude.ai 风）

### 设计 token（CSS 变量，dark/light 双套，注入 Tailwind 主题）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--background` | `#fafaf7` (米白) | `#1a1a1a` (碳黑) | 页面底色 |
| `--surface` | `#ffffff` | `#222222` | 卡片/面板 |
| `--surface-hover` | `#f3f3f0` | `#2a2a2a` | 悬停 |
| `--border` | `#e5e3df` | `#333333` | 1px 细边 |
| `--border-strong` | `#d0cec9` | `#404040` | 强边 |
| `--text` | `#191919` | `#f5f5f0` | 正文 |
| `--text-muted` | `#6f6e6a` | `#a0a0a0` | 辅助文字 |
| `--accent` | `#c96442` (clay) | `#d97757` | 唯一强调色（按钮/选中） |
| `--accent-fg` | `#ffffff` | `#ffffff` | 强调色上的文字 |

- 圆角：`--radius` = 12px（卡片）/ 6px（按钮 sm）/ 18px（用户气泡）/ 24px（Composer 容器）
- 字号刻度：13/14/15/16/18/22/28（rem 单位）
- 字体：保留 `Ubuntu Sans / PingFang SC / Microsoft YaHei` 链
- 阴影：`shadow-sm`（边框替代）/ `shadow-md`（dialog/sheet 用）
- 移除：`backdrop-filter`、径向渐变背景、所有橙色渐变

### 关键页面外观

**ChatPage**
- 消息流最大宽度 `max-w-3xl` (约 768px)，居中
- AI 回复：无气泡，左侧 16px 缩进可选放置头像；正文使用 `prose` 样式（react-markdown 配合 typography）
- 用户消息：右对齐，柔和灰背景气泡（`bg-surface-hover`），最大宽度 75%
- ThinkingIndicator：内联小 pill，浅灰背景，"思考中（12 秒）"配合呼吸点
- ToolTraceCard：默认折叠，左侧 5px 强调色色条，`Accordion` 展开看参数/结果/进度
- Composer：圆角 24px 容器，textarea 无边框，底部一排 ghost 图标按钮（上传/中断），右侧实色 send 按钮

**Sidebar（桌面）**
- 固定 260px，无圆角面板感，靠右细 1px 分隔
- 会话项：扁平，hover/active 背景变化，没有边框装饰
- 顶部新建按钮 + 搜索（搜索为 Phase 7 选做）

**Header（桌面）**
- 极薄（48px），左侧会话标题，右侧状态点 + 操作菜单（DropdownMenu）
- 状态从一排 pill 改成单个小圆点 + tooltip："已连接" / "重连 1/3" / "回应中"

### 响应式策略

- 桌面（≥1024px）：三列 grid（侧栏 260 + 中央 1fr + Inspector 320）
- 平板（≥640px <1024px）：两列（侧栏 256 + 中央 1fr），Inspector 通过右侧 Sheet 调出
- 移动（<640px）：单列，Sidebar 走 `Sheet` 从左滑入，Inspector 走 `Sheet` 从右滑入，底部 `MobileTabBar` 切换 chat/files/skills 焦点
- 全部移动 drawer 都用 shadcn `Sheet`（基于 Radix Dialog，自带 backdrop / 焦点陷阱 / Esc 关闭 / `aria-*`）
- 软键盘：保留 `useKeyboardInset` hook 抽自现有逻辑，通过 CSS 变量注入 composer

## 路由与 Shell 重构

```tsx
// App.tsx
<AuthBootstrap>
  <Routes>
    <Route element={<PublicOnlyRoute><AuthLayout /></PublicOnlyRoute>}>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/bootstrap-admin" element={<BootstrapAdminPage />} />
    </Route>
    <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
      <Route index element={<ChatPage />} />
      <Route path="session/:sessionId" element={<ChatPage />} />
      <Route path="settings" element={<AdminGuard><SettingsPage /></AdminGuard>} />
    </Route>
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>
</AuthBootstrap>
```

`AppShell` 持有：sessions query、theme、logout、Sidebar/Header/Inspector/MobileTabBar 布局。`ChatPage` 仅持有：sessionId 派生、messages query、stream hook、composer 子树。

## 分阶段实施

### Phase 0 — 基础设施（≤1 PR）
1. 安装：`tailwindcss@3 postcss autoprefixer clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area @radix-ui/react-accordion @radix-ui/react-toast`
2. 生成 `tailwind.config.ts` / `postcss.config.js` / 在 `index.css` 顶部加三层指令
3. 配置 `tailwind.config.ts` 的 `theme.extend`：把上表 token 映射成 `colors.background/surface/border/...`、`borderRadius.*`、`fontSize.*`
4. 新增 `lib/cn.ts`（替换 `lib/utils.ts` 中的 `cn`，但保留旧 export 以兼容）
5. 通过 shadcn CLI（`npx shadcn@latest init` 后 add）拉入：button / dialog / sheet / tabs / tooltip / dropdown-menu / scroll-area / input / textarea / toast / accordion
6. 验证：`npm run dev` 启动后旧 UI 不破坏（新 css 与旧 css 并存，先不删旧规则）；`npm test` 全绿
7. 验证：`npm run build` 无 TS 错误

### Phase 1 — 路由与 Shell 拆分（不改视觉）
1. 抽 `routes/auth/{AuthLayout, LoginPage, RegisterPage, BootstrapAdminPage}.tsx`，复制原 JSX，沿用旧 className
2. 抽 `routes/app/{AppShell, ChatPage, SettingsPage}.tsx`：把 `SessionWorkspace` 切成布局壳 + 两个页面；用 `<Outlet />`
3. `App.tsx` 缩减为路由表
4. 抽 `useComposerAttachments` / `useKeyboardInset` hooks
5. 验证：`npm test` 全绿（`App.routes.test.tsx` 应仍通过——路由路径未变）

### Phase 2 — Layout 视觉换皮（应用 Tailwind + shadcn）
1. 重写 `AppShell` 的 grid 布局，使用 Tailwind 响应式 class 替代 `.shell` 媒体查询
2. `Sidebar`（桌面常驻）+ 移动用 `Sheet`；`MobileTabBar` 提供切换入口
3. `ChatHeader` 极简化：状态点 + DropdownMenu + ThemeToggle
4. `InspectorPanel`：桌面常驻面板；移动 Sheet
5. `Toaster` 接管原来的 `pageError` banner，错误改用 toast
6. 验证：桌面三尺寸（1440 / 1180 / 1024）+ 移动两尺寸（414 / 360）手测

### Phase 3 — 聊天主区视觉重做
1. `MessageList` 居中容器（max-w-3xl），消息间距重做
2. `MessageItem` 拆出 `AssistantMessage / UserMessage / ThinkingIndicator / ToolTraceCard / ImageMessage / FileMessage / ErrorMessage / AssistantMetaFooter` 子组件，**保留 `MessageItem` 的对外 props 与 export 路径以让现有测试继续工作**
3. AssistantMessage 无气泡，使用 react-markdown + typography
4. UserMessage 柔和灰气泡，右对齐
5. ToolTraceCard 改成 shadcn Accordion，左 4px accent 色条
6. CopyButton 用 lucide 图标，hover 显示
7. `useAutoScrollToBottom` hook 替代当前 `useEffect` 强制滚动
8. 验证：`apps/web/src/App.test.tsx`（MessageItem 单元测试）必须全绿——可能要改测试中按 className 选择器为 `getByRole/getByText`

### Phase 4 — Composer 重做
1. 单一 textarea + auto-grow（依据 scrollHeight 调高度，max-h: 12rem）
2. 底部工具栏：左 ghost 图标按钮（上传 / 中断），右实色 send 按钮（lucide ArrowUp）
3. AttachmentChips：横向滚动条，每个 chip 带 `X` 关闭
4. FollowUpQueue：composer 上方独立 Card，每项可单独取消
5. 移动端：Composer 固定底部，软键盘弹起时通过 `useKeyboardInset` 推上去；Enter 行为保留（≥900px 直发，否则换行）
6. 验证：粘贴图片、上传、断流中断、follow-up 取消手测

### Phase 5 — 认证页 + 设置中心
1. 三个 auth 页用 shadcn Card + Form + Input + Button 重做，居中卡片（`max-w-sm`），背景去掉 backdrop
2. `SettingsPage` 用 shadcn Tabs，把 `UsersTab / SystemTab / InvitesTab` 拆成独立文件
3. 表格用简单 div grid（数据量小，不引入 table 组件）
4. 验证：`App.routes.test.tsx` 中 admin / bootstrap 流程全绿

### Phase 6 — 清理 & 收尾
1. 删除 `index.css` 中所有旧业务样式（保留三层 Tailwind 指令 + token + 全局基础）
2. 删除原 `App.tsx` 中残留的内联组件
3. 把内联 SVG 全部替换成 lucide-react
4. ESLint / TS 全绿
5. 桌面 + 移动手测全功能（清单见下文 Verification）

## 关键复用与不动点

**保留不变**：
- `lib/api.ts` 全部 API 客户端
- `lib/timeline.ts` 的 `buildRenderableTimeline / TimelineItem / ToolTraceDisplayEvent`
- `hooks/useSessionStream.ts` 的对外接口
- `hooks/useFilePreviewUrl.ts`
- `stores/{auth,ui,preferences}-store.ts` 全部 action 与 state 形状
- `MessageItem` 组件的 props 签名与导出路径（`components/MessageItem.tsx` 改为内部委托给 `components/chat/*` 实现，外层 wrapper 保持 export）
- `applyThemeMode()` 的实现思路（data-theme 属性）
- `lib/utils.ts` 的 `formatBytes / groupBy / isWechatBrowser`

**会破坏的部分**（需要同步改）：
- `apps/web/src/App.test.tsx` 中按 `.message-bubble` / `.tool-trace-card` 等 className 选择的断言：改为按 role / text / data-testid 选
- `apps/web/src/App.routes.test.tsx` 中如果有按 className 的查询：同上

## Verification

1. `npm run typecheck` 全绿
2. `npm test` 全绿（覆盖 MessageItem 12 个用例 + App routes 集成测试）
3. `npm run build` 产物可用，bundle 体积控制在合理范围（增加 Tailwind + Radix 应在 ~80KB gzipped 内）
4. `npm run dev:server` + `npm run dev` 后人工验证：
   - 桌面 1440：登录 → 创建会话 → 选 skill → 发消息 → 看流式 → 看 token / 时长 → 中断 → 重发 → 看 follow-up 队列 → 上传文件 → 看 image 预览 → 切换主题 → 退出
   - 桌面 1024：三列布局自适应正常
   - 平板 768：Inspector 退化成 Sheet
   - 移动 414：Sidebar Sheet / Inspector Sheet / MobileTabBar 切换 / 软键盘弹起 composer 不被遮 / 微信内打开看到下载警告
   - 设置页（admin）：三个 tab 全可用，模型配置可保存
   - 注册流程：开放/邀请码两种模式
5. 跨浏览器抽检：Chrome、Safari (iOS)、微信内置浏览器

## Critical Files To Modify

**新增**：
- `apps/web/tailwind.config.ts`
- `apps/web/postcss.config.js`
- `apps/web/src/lib/cn.ts`
- `apps/web/src/routes/auth/{AuthLayout,LoginPage,RegisterPage,BootstrapAdminPage}.tsx`
- `apps/web/src/routes/app/{AppShell,ChatPage,SettingsPage}.tsx`
- `apps/web/src/components/{chat,sidebar,inspector,settings,layout,ui}/*` (≈30 个文件)
- `apps/web/src/hooks/{useComposerAttachments,useKeyboardInset,useMediaQuery,useAutoScrollToBottom}.ts`

**重写**：
- `apps/web/src/App.tsx`（2060 → ~60 行）
- `apps/web/src/index.css`（1747 → ~120 行：Tailwind 指令 + token + base）
- `apps/web/src/components/MessageItem.tsx`（504 行 → wrapper，实现移到 `components/chat/*`）
- `apps/web/src/components/SkillCard.tsx`（移到 `components/inspector/SkillCard.tsx`，重写视觉）
- `apps/web/src/App.test.tsx` / `apps/web/src/App.routes.test.tsx`（断言策略调整）

**新增依赖**（`apps/web/package.json`）：
- 运行时：`tailwindcss@^3 clsx tailwind-merge class-variance-authority lucide-react @radix-ui/react-{dialog,tabs,tooltip,dropdown-menu,scroll-area,accordion,toast,slot,avatar}`
- 开发时：`postcss autoprefixer @tailwindcss/typography`

## 风险与回退

- **风险 1**：测试用 className 查询失败。**缓解**：Phase 0 即跑一遍测试基线，每个 Phase 独立小步提交并跑 `npm test`，断点早发现。
- **风险 2**：流式状态在重构布局时漏掉某种 transientEvent。**缓解**：保留 `lib/timeline.ts` 不动，所有 message 类型走同一入口。
- **风险 3**：移动端虚拟键盘 + Sheet 焦点冲突。**缓解**：Sheet 关闭后再 focus textarea，参考 Radix Dialog 推荐用法。
- **回退**：每个 Phase 独立 PR；如某 Phase 出问题可 revert 而不影响前序成果。

预计工作量：6 个 Phase × 0.5–1.5 天 = 5–8 个工作日（不含验证）。
