# Skill 市场独立化 + 右栏会话视图重构

## Context

当前右侧 Inspector 的 Skill 区把"市场 / 已安装 / 会话"三件事塞进一个 320px 宽的窄栏，体验差：
- 浏览市场时空间局促，无法看清描述、标签、权限、入口、起始提示等关键信息。
- "已安装"和"会话"语义重叠（已安装就是当前会话能选的池子），使三个 tab 形成认知噪音。
- 没有详情页，用户在安装前没法判断 skill 是否值得装。

目标：
1. 把市场拆成独立路由 `/app/market`（列表）+ `/app/market/:publisher/:name`（详情），可深链、可搜索筛选。
2. 右栏 Skill 面板只保留"会话"语义：列出当前用户已安装的 skill，已启用的自动置顶，点详情跳转到市场详情页。
3. 视觉风格沿用现有 `surface/border/accent` token 与 `Button/Input/ScrollArea` 组件，与设置页（`SettingsPage`）和 ChatPage 协调统一。

外部市场 (`MarketClient.getVersion`) 已可拿到完整 manifest，本地只缺一个 server 转发端点和前端 api 方法。

---

## 设计要点

### 路由
- `/app/market` — 网格列表，搜索 + kind 筛选。
- `/app/market/:publisher/:name` — 详情页，展示完整 manifest。
- 两条路由都嵌套在现有 `<AppShell>` 下，复用左 sidebar；右 Inspector 在市场页保留可见（默认显示"会话"tab，让用户随时对照已激活 skill）。

### 数据
- 列表：复用 `GET /api/market/skills`（已存在）。
- 详情：新增 `GET /api/market/skills/:publisher/:name`，内部调 `MarketClient.getVersion(id)` 取最新版，返回 `MarketSkillVersion`（含完整 `SkillManifest`）。
- 已安装记录里 `manifest` 字段 server 已经塞了完整 manifest（`installedSkillRecordSchema` 用的是 `skillManifestSchema`），前端 `SkillManifestSummary` 是窄化类型——可直接扩字段，不需要改后端响应。

### 右栏 Inspector 简化
- 删除 `session/installed/market` 三 tab 切换，只保留单一列表。
- 列表数据源：`useQuery(['user-installed-skills'])`（已有 `api.listInstalledSkills`）合并 `installedSkills` prop 做激活态判断。
- 排序规则：当前会话激活的在前（按激活顺序），其余按 `displayName` 字典序。
- 卡片操作：toggle 启用 / 卸载 / "查看详情" → `navigate('/app/market/${publisher}/${name}')`。
- 列表底部加 "浏览技能市场 →" 主按钮，跳 `/app/market`。
- 无活跃会话时禁用 toggle 但保留详情链接。

### 详情页布局
顶部返回按钮 + 标题区（displayName / id@version / author / kind / runtime 标签）+ 主操作（安装 / 卸载 / 当前会话启停）。
正文分区：
1. 描述（manifest.description）
2. 权限（filesystem / network / scripts / secrets，分项可视化展示）
3. 运行时入口（runtime.entrypoints 列表，name/path/description）
4. 起始提示（starterPrompts 列表）
5. 元数据（tags / categories / license / homepage / repository / updatedAt）

---

## 实施步骤

### A. 后端 (1 文件)

**`apps/server/src/app.ts`**
在第 715 行 `GET /api/market/skills` 路由旁新增：
```ts
app.get('/api/market/skills/:publisher/:name', { preHandler: app.authenticate }, async (request, reply) => {
  try {
    const params = z.object({ publisher: z.string().min(1), name: z.string().min(1) }).parse(request.params);
    const query = z.object({ version: z.string().optional() }).parse(request.query ?? {});
    const id = skillIdSchema.parse(`${params.publisher}/${params.name}`);
    return await new MarketClient(config.MARKET_BASE_URL).getVersion(id, query.version);
  } catch (error) {
    return reply.code(errorStatus(error)).send({ message: errorMessage(error, '获取 Skill 详情失败') });
  }
});
```
`MarketClient.getVersion` 已经存在 (`apps/server/src/modules/skills/market-client.ts:31`)。

### B. 前端 API 类型 (1 文件)

**`apps/web/src/lib/api.ts`**
- 把 `SkillManifestSummary` 扩成完整 `SkillManifest`：补 `skillSpecVersion`、`license?`、`homepage?`、`repository?`、`compatibility`、`assets`。或新增 `SkillManifestFull` 并在详情场景使用，`InstalledSkillRecord.manifest` 也升级为 `SkillManifestFull`（运行时 server 已发完整数据，仅类型加宽）。
- 新增类型 `MarketSkillDetail`（对应 `marketSkillVersionSchema`：`{id, version, manifest, packageUrl, checksumSha256?, sizeBytes?, publishedAt}`）。
- 新增 `api.getMarketSkillDetail(id: string, version?: string)` 调 `/api/market/skills/${publisher}/${name}` 拼 `?version=` query。

### C. 前端新页面 (3 新文件)

**`apps/web/src/routes/app/MarketPage.tsx`**
- `ChatHeader` 标题 "技能市场"，副标题 "浏览并安装 Claude Code skills"。
- 顶部：`Search` 输入框 + kind 多选筛选（指令/运行时/混合）+ 刷新按钮。
- 主体：`useQuery(['market-skills'])` → 响应式网格（`grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3`）。
- 卡片：复用 `MarketSkillCard` 子组件——名称、id@version、描述（`line-clamp-2`）、kind/category/tag 标签、安装状态徽章。整卡可点击 → 详情；卡内角落按钮：安装（未安装）/ 已安装徽章。

**`apps/web/src/routes/app/MarketDetailPage.tsx`**
- `useParams` 拿 publisher/name，组装 `id`。
- `useQuery(['market-skill-detail', id])` 调 `api.getMarketSkillDetail`。
- 同时 `useQuery(['user-installed-skills'])` 判断是否已安装、当前版本。
- `ChatHeader` 标题 = displayName/id；副标题 = `id@version · author`；`titleActions` 放返回按钮（`useNavigate(-1)` 兜底 `/app/market`）。
- 正文按上面"详情页布局"分块；每块用 `<section>` + 小标题 + `border border-border rounded-md` 容器，与设置页风格一致。
- 主操作区：未安装→"安装"按钮；已安装→"卸载" + 当前会话有效时"启用/停用"按钮。安装/卸载复用现 `installMutation`/`uninstallMutation` 的 invalidate 策略（参考 `InspectorPanel.tsx:378-434`）；可抽到 `apps/web/src/hooks/useSkillMutations.ts` 复用。

**`apps/web/src/components/market/MarketSkillCard.tsx`** (从 `InspectorPanel.tsx:245` 抽出并增强)
- 仅展示用 + 安装按钮，整卡可点击进入详情。

### D. 前端简化 Inspector (修改 2 文件)

**`apps/web/src/components/inspector/InspectorPanel.tsx`**
- 删除 `SkillPanelView` / `skillPanelTabs` / 三段式切换、`renderInstalledSkillList`、`renderMarketSkillList` 与对应 `MarketSkillCard` 内联实现。
- 把 `userInstalledSkillsQuery` 升级为常驻数据源（不再受 `skillView` 控制 enabled）。
- 新顶部信息卡保持现有"X/Y 启用 / 当前会话 Skill 作用域"卡，文案略调。
- 搜索框继续保留，placeholder 改"搜索 Skill"。
- 列表合并：以 `userInstalledRecords` 为主源，按 `(active 顺序优先, displayName)` 排序，渲染统一卡片（融合 `InstalledSkillCard` + 新增"详情"按钮 → `navigate('/app/market/${publisher}/${name}')`）。
- 列表底部固定 CTA：`<Button variant="outline" className="w-full" onClick={() => navigate('/app/market')}><Store .../> 浏览技能市场</Button>`。
- 空态文案区分"还没装过任何 skill" vs "搜不到匹配项"。

**`apps/web/src/components/inspector/SkillCard.tsx`** (可保留，但实际渲染走 InspectorPanel 内的 InstalledSkillCard)
- 给 `InstalledSkillCard` 加一个 `onOpenDetail` 回调入参，按钮放在卡片右下，`Eye` 或 `ExternalLink` 图标。

### E. 路由注册 (1 文件)

**`apps/web/src/App.tsx`**
在 `<Route path="/app">` 块内新增：
```tsx
<Route path="market" element={<MarketPage />} />
<Route path="market/:publisher/:name" element={<MarketDetailPage />} />
```

### F. AppShell 行为 (1 文件)

**`apps/web/src/routes/app/AppShell.tsx`**
- `isSettingsView`/`showInspector` 逻辑保留 — 市场页**也**显示 inspector（让用户对照启用情况），所以无需新增隐藏逻辑。
- `useLocation` 已存在；额外辅助变量 `isMarketView = location.pathname.startsWith('/app/market')` 留作样式钩子，目前不需要分支，但便于后续扩展。

### G. 测试

- 新增/扩展 `apps/server/src/app.test.ts`：`GET /api/market/skills/:publisher/:name` 200 + 404 + 鉴权用例（参考 line 478 现有 listSkills 用例风格）。
- 前端可选：为 `MarketPage` 写一个 smoke 测试，验证网格渲染 + 搜索过滤；详情页验证返回按钮 + 安装按钮交互。现有 `App.routes.test.tsx` 已经有路由级别测试，可加两条断言。

---

## 影响文件清单

修改：
- `apps/server/src/app.ts` (新路由)
- `apps/server/src/app.test.ts` (新用例)
- `apps/web/src/lib/api.ts` (类型扩展 + 新方法)
- `apps/web/src/App.tsx` (路由注册)
- `apps/web/src/components/inspector/InspectorPanel.tsx` (大幅简化)
- `apps/web/src/components/inspector/SkillCard.tsx` (加详情入口)

新增：
- `apps/web/src/routes/app/MarketPage.tsx`
- `apps/web/src/routes/app/MarketDetailPage.tsx`
- `apps/web/src/components/market/MarketSkillCard.tsx`
- `apps/web/src/hooks/useSkillMutations.ts` (可选，封装 install/uninstall mutation)

---

## 验证

1. `npm --workspace apps/server run test` — 后端新路由用例。
2. `npm --workspace apps/web run test` — 前端测试（若有新增）。
3. 启动 dev：`npm run dev`（含 server + web），手动验证：
   - 右栏 Skill tab：单一列表，激活的置顶，"浏览技能市场"按钮跳转。
   - `/app/market`：搜索/筛选/网格渲染。
   - 卡片点击 → `/app/market/:publisher/:name` 显示完整 manifest 各分区。
   - 安装/卸载在详情页执行后，右栏列表即时更新（query invalidate 已有，应继承）。
   - 移动端：sheet 内右栏行为正确；市场页响应式列数。
4. 类型检查：`npm run typecheck`（或对应 workspace 命令）。
