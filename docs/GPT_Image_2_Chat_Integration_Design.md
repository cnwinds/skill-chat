# GPT-Image-2 Chat Integration Design

## 1. 目标

当前项目已经支持基于 OpenAI Responses API 的文本聊天。现在需要补齐图片能力，满足下面 4 个要求：

1. 用户在聊天里提出生图需求时，系统能自动调用图片模型，而不是要求用户切模型或走单独页面。
2. 用户上传图片并提出改图需求时，系统能自动进入改图链路。
3. 图片结果需要回到当前聊天窗口内显示，而不是只作为一个普通下载文件。
4. 后续多轮对话里，系统要能继续引用“刚才那张图”做二次编辑。

本设计的结论是：

- 聊天主模型不要切成 `gpt-image-2`。
- 自动融入聊天，优先走 `Responses API + image_generation tool`。
- 显式支持 OpenAI 官方 `images/generations` 与 `images/edits` 两个接口，作为统一图片能力层的一部分。
- 会话内要引入“图片消息/图片产物”的一等事件模型，而不是把图片继续当普通 `file` 下载卡片处理。

## 2. 官方接口与参考结论

### 2.1 官方能力结论

基于 2026-04-24 检查的 OpenAI 官方文档：

- `gpt-image-2` 模型页显示它支持 `Responses API`、`Images generations API`、`Images edits API`。
- OpenAI 图片生成指南显示，聊天场景下可以通过 `Responses API` 的 `image_generation` 工具让模型在对话中自动生成图片。
- 图片指南里也明确了“带输入图片的同一能力既可以做生成，也可以做编辑”，默认 `action=auto` 即可，也支持 `generate` / `edit`。

需要注意一处官方文档差异：

- 新模型页已经是 `gpt-image-2`。
- 部分图片指南/接口示例页仍然展示旧的 GPT Image 型号示例。

因此实现时不要把旧页面里的型号限制硬编码进业务逻辑，应把“聊天工具调用”和“图片直连 API”抽象成能力层，由配置决定具体模型。

官方文档：

- https://developers.openai.com/api/docs/models/gpt-image-2
- https://platform.openai.com/docs/guides/image-generation
- https://platform.openai.com/docs/api-reference/images

### 2.2 对 `codex` 的参考结论

`codex` 的关键做法不是“让模型返回一个图片 URL”，而是：

1. 把 `image_generation` 当作模型原生工具。
2. 在流式输出里识别 `image_generation_call`。
3. 把返回的 base64 图片落盘成真实文件。
4. 把图片结果作为一类结构化会话项写回历史。
5. 让后续轮次还能引用这张图。

参考文件：

- `codex/codex-rs/tools/src/tool_spec.rs`
- `codex/codex-rs/core/src/stream_events_utils.rs`
- `codex/codex-rs/app-server-protocol/src/protocol/thread_history.rs`
- `codex/codex-rs/core/src/context/image_generation_instructions.rs`

这套思路是对的，但 `codex` 是终端/TUI 优先产品，本项目是 Web 聊天产品，因此还需要补两层它没有重点处理的东西：

1. 浏览器内联图片预览。
2. 浏览器上传图片后，对当前消息显式附带哪些图片参与本轮推理/改图。

## 3. 当前项目现状

### 3.1 已有能力

当前聊天主链路：

- 服务端通过 `apps/server/src/modules/chat/openai-harness.ts` 走 OpenAI Responses API。
- 会话与回合由 `apps/server/src/modules/chat/chat-service.ts` 和 `apps/server/src/core/turn/*` 管理。
- 产物文件已经能通过 `onArtifact -> file 事件 -> file_ready SSE` 回传。
- 前端 `apps/web/src/components/MessageItem.tsx` 已支持 `file` 卡片和下载动作。

### 3.2 当前不足

当前代码还不适合直接承接图片聊天，主要有 4 个结构问题：

1. `openai-harness.ts` 现在只处理文本增量和 `function_call`，没有处理 `image_generation_call`。
2. `openai-harness-context.ts` 现在把会话历史压扁成纯文本，无法保留图片型上下文。
3. 前端 composer 虽然能上传图片，但 `apps/web/src/App.tsx` 发送消息时并没有把附件 ID 一起带给服务端。
4. 浏览器图片预览不能直接使用当前 `downloadUrl` 做 `<img src>`，因为当前鉴权方式是 `Bearer` 请求头。

## 4. 核心设计

### 4.1 总体原则

推荐采用“三层架构”：

1. 聊天编排层：保留现有聊天主模型，继续负责理解上下文、判断是否需要生图/改图、是否要先问澄清问题。
2. 图片能力层：统一封装 OpenAI 图片相关能力，既支持 Responses 工具型生图，也支持 `images/generations`、`images/edits`。
3. 会话资产层：统一保存图片文件、图片消息、来源关系、后续复用关系。

### 4.2 为什么不能直接把聊天主模型切成 `gpt-image-2`

如果把系统现有 `openaiModel` 直接改成 `gpt-image-2`，会带来三个问题：

1. 现有聊天、工具调用、长上下文、推理行为会退化或直接不兼容。
2. “正常聊天”和“图片生成”会争抢同一个模型配置，系统配置会变得混乱。
3. 后续扩展语音、搜索、工具调用时，职责边界会继续恶化。

因此推荐改成：

- `openaiChatModel`: 继续用于对话主链路，例如 `gpt-5.4`。
- `openaiImageModel`: 默认 `gpt-image-2`，专门用于图片生成与编辑。

### 4.3 双通道图片执行策略

#### A. 自动融入聊天的主通道

用于“用户在聊天里说：给我画一张海报 / 把这张图改成赛博朋克风格”这类自然交互。

方案：

- 仍然调用 `POST /v1/responses`。
- 给聊天主模型开放 `image_generation` 工具。
- 用户消息里如果带了图片附件，则作为 `input_image` 内容一起发给 Responses。
- 模型自己决定是直接回答文本，还是调用图片工具。

优点：

- 最贴近“融入聊天”的目标。
- 能在同一轮里先追问，再出图。
- 不需要额外做脆弱的关键词分流器。

#### B. 图片直连能力通道

用于系统内部统一封装官方图片接口，支持：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

这个通道不直接暴露给最终用户作为单独页面，但要在服务端实现成标准能力，原因有三点：

1. 用户已经明确要求两个官方接口都要支持。
2. 后续可以给管理后台、测试工具、工作流脚本、批处理任务直接复用。
3. 当聊天主模型暂时不支持 `image_generation` 工具，或某些场景需要显式参数控制时，可以作为兜底路径。

结论：

- 对用户体验而言，主入口是聊天。
- 对后端工程而言，底层必须同时支持 Responses 工具通道与 Images API 通道。

## 5. 数据模型设计

### 5.1 新增系统配置

在现有系统配置基础上新增：

- `openaiChatModel`
- `openaiImageModel`，默认 `gpt-image-2`
- `openaiImageQuality`，默认 `auto`
- `openaiImageOutputFormat`，默认 `png`
- `enableChatImageGeneration`
- `enableImageApiFallback`

现有 `openaiModel` 建议拆分，避免未来语义不清。

### 5.2 新增消息输入结构

当前 `MessageDispatchRequest` 只有 `content`，无法表达“本轮附带了哪些图片”。

建议扩展为：

```ts
type MessageDispatchRequest = {
  content: string;
  attachmentIds?: string[];
  dispatch?: MessageDispatchMode;
  turnId?: string;
  kind?: TurnKind;
  turnConfig?: TurnConfig;
};
```

同时扩展：

- `RuntimeInput`
- `PersistedRuntimeInput`
- `UserMessageCommittedPayload`

这样本轮请求的输入图片就是显式的，不需要靠模型去 `list_files` 猜。

### 5.3 新增图片事件

建议新增 `image` 事件，而不是继续只用 `file` 事件。

```ts
type ImageMessageEvent = {
  id: string;
  sessionId: string;
  kind: 'image';
  createdAt: string;
  file: FileRecord;
  operation: 'generate' | 'edit';
  provider: 'openai';
  model: string;
  source: 'responses_tool' | 'images_generate_api' | 'images_edit_api';
  prompt: string;
  revisedPrompt?: string;
  inputFileIds?: string[];
  maskFileId?: string;
};
```

保留 `file` 事件用于通用文档、表格、PDF 等产物；图片走独立事件。

这样有三个好处：

1. 前端渲染逻辑清晰。
2. 后续继续改图时可以拿到来源图片和提示词。
3. 历史压缩和多轮引用时，可以区分“普通文件”和“图片资产”。

## 6. 服务端设计

### 6.1 OpenAI 图片能力层

新增模块建议：

- `apps/server/src/modules/chat/openai-image-service.ts`

提供统一接口：

```ts
type GenerateImageArgs = {
  prompt: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
};

type EditImageArgs = {
  prompt: string;
  inputImages: Array<{
    fileId: string;
    mimeType: string | null;
    absolutePath: string;
  }>;
  maskFileId?: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: string;
  outputFormat?: 'png' | 'jpeg' | 'webp';
};
```

内部实现三类方法：

1. `saveResponsesImageToolResult(...)`
2. `generateViaImagesApi(...)`
3. `editViaImagesApi(...)`

三者统一返回：

- 保存后的 `FileRecord`
- 最终 prompt / revised prompt
- 触发来源
- 输入图片来源

### 6.2 Responses 聊天链路改造

#### 6.2.1 工具声明

当前 `openai-harness.ts` 只把本地函数工具塞进 `tools`。

需要改为：

- 当 `enableChatImageGeneration=true` 且当前聊天模型支持该能力时，在 Responses 请求里追加：

```json
{ "type": "image_generation" }
```

如果官方后续允许附加 `output_format` 等字段，则通过配置透传；若当前接口版本不接受，就保持最小声明。

#### 6.2.2 输出事件解析

当前 `runSamplingRequest()` 只处理：

- `response.output_text.delta`
- `response.reasoning_*`
- `response.output_item.done` 里的 `function_call`

需要补：

- 识别 `response.output_item.done` 中 `item.type === 'image_generation_call'`
- 读取：
  - `id`
  - `result`
  - `status`
  - `revised_prompt`
- 解码 base64，保存为图片文件
- 回调 `onImageGenerated`

建议新增回调：

```ts
onImageGenerated?: (event: {
  source: 'responses_tool';
  model: string;
  file: FileRecord;
  prompt: string;
  revisedPrompt?: string;
  inputFileIds?: string[];
}) => Promise<void> | void;
```

#### 6.2.3 当前轮输入拼装

新增附件后，`toResponsesHarnessInput()` 不能再只返回 `role + string`。

建议升级为真正的多模态消息结构：

```ts
type ResponsesMessageContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string };
```

发送时：

- `content` 作为 `input_text`
- `attachmentIds` 对应的图片文件转成 data URL，作为 `input_image`

这样聊天主模型才能在同一轮里直接完成改图。

### 6.3 图片直连 API 服务

除了聊天自动通道，还应提供内部服务方法：

- `generateViaImagesApi() -> POST /v1/images/generations`
- `editViaImagesApi() -> POST /v1/images/edits`

这层不一定先开放成前端独立路由，但服务必须存在。

理由：

1. 方便写单元测试和联调脚本。
2. 后续可给管理页面或 workflow 复用。
3. 当 Responses 工具路径临时不可用时，可作为降级方案。

### 6.4 会话历史与后续复用

这是整个设计最关键的部分。

如果只把图片存成一个下载文件，后续多轮里模型其实“不知道刚才那张图长什么样”，只能知道文件名。

推荐分两阶段做：

#### Phase 1

- 当前轮只把用户显式附带的 `attachmentIds` 转成 `input_image`。
- 助手生成完图片后，写 `image` 事件。
- 前端支持“将这张图加入输入”按钮，用户点一下即可继续改图。

这个阶段已经能稳定完成：

- 自动生图
- 自动改图
- 聊天内展示
- 用户手动基于上一张图继续编辑

#### Phase 2

再增强“自然语言引用上一张图”的自动化能力：

- 当用户说“把刚才那张图改一下”时，后端根据最近的 `image` 事件自动解析候选图片。
- 若候选唯一，自动作为本轮隐式 `attachmentIds`。
- 若候选不唯一，先让模型澄清，或由前端让用户点选。

相比直接把所有旧图片都塞回模型，这种设计更省 token，也更可控。

## 7. 前端设计

### 7.1 composer 附件需要真正参与消息发送

当前前端上传附件后只做了本地展示，没有把 `fileId` 带进 `sendMessage()`。

需要改为：

- `ComposerAttachment` 增加 `fileId`
- 发送消息时附带 `attachmentIds`
- 消息发出成功后，保留或清空附件由产品规则决定

推荐规则：

- 默认发送后清空附件
- 助手生成的图片如果用户点击“继续改图”，再重新附加到 composer

### 7.2 图片消息渲染

`MessageItem.tsx` 需要新增 `image` 分支：

- 展示缩略图/原图
- 展示操作类型：生成 / 改图
- 展示简短 prompt 或 revised prompt
- 操作按钮：
  - 下载
  - 继续编辑
  - 重新生成

### 7.3 图片预览鉴权问题

当前下载接口依赖 `Authorization: Bearer ...`，浏览器 `<img src>` 不能直接带这个 header。

因此不要直接把 `/api/files/:id/download` 塞进 `img src`。

推荐方案：

1. 前端通过 `fetch` 带鉴权头下载 blob。
2. `URL.createObjectURL(blob)` 生成本地预览 URL。
3. React 组件卸载时释放 URL。

建议新增：

- `api.fetchFileBlob(fileId)`
- `useFilePreviewUrl(fileId)`

如果后续图片很多，再考虑增加缩略图路由或临时签名 URL。

## 8. 自动触发策略

### 8.1 不推荐做前端/后端关键词硬匹配

例如：

- “画一张图”
- “给我做个海报”
- “把这个变成水彩”
- “做个 Banner，标题换成 …”

这些表达很多，靠规则分流会很脆。

### 8.2 推荐由聊天主模型决策

在 system/developer prompt 中明确告诉聊天主模型：

- 当用户目标是生成图片时，可调用 `image_generation`
- 当用户附带图片并要求修改视觉内容时，可将图片作为输入进行编辑
- 不确定时先追问风格、尺寸、文案、比例等

也就是说：

- “是否触发生图/改图”交给主模型
- “真正执行图片请求”交给图片能力层

这和当前项目“模型负责判断、程序负责执行”的架构是一致的。

## 9. 推荐实施顺序

### 第一阶段：打通最小可用链路

目标：

- 聊天里自动生图
- 图片回到当前聊天窗口显示

改动：

1. 配置拆分出 `openaiChatModel` / `openaiImageModel`
2. `openai-harness.ts` 支持 `image_generation` 工具
3. 解析 `image_generation_call`
4. 保存图片文件
5. 新增 `image` 事件
6. 前端内联预览图片

### 第二阶段：打通聊天改图

目标：

- 用户上传图片后，聊天里自动改图

改动：

1. `MessageDispatchRequest` 增加 `attachmentIds`
2. 前端真正发送附件 ID
3. 服务端把附件图片转成 Responses `input_image`
4. 图片消息卡片支持“继续编辑”

### 第三阶段：补齐 Images API 能力层

目标：

- 官方 `images/generations` / `images/edits` 两个接口完整落地

改动：

1. `openai-image-service.ts`
2. 生成/编辑统一结果结构
3. 加入自动化测试与脚本验证

### 第四阶段：增强图片上下文连续性

目标：

- “把刚才那张图再改一下”无需用户手动重新附加

改动：

1. 最近图片候选解析
2. 自动隐式附图
3. 候选歧义时澄清

## 10. 相比直接照搬 codex 的优化点

本项目比 `codex` 更优的设计点应当是：

1. 不只保存图片文件，还保存图片消息语义。
2. 不只支持模型内建图像工具，还统一封装官方 Images API。
3. 不只在历史里记录结果，还把“本轮附带哪些图片”建模为显式输入。
4. 针对 Web 鉴权场景补齐 blob 预览链路。
5. 为后续“继续改图”设计前端入口，而不是只靠模型猜文件。

总结一下：

- `codex` 给我们的核心启发是“image_generation 是一等输出事件”。
- 当前项目的更优解是“图片既是一等输出事件，也是一等输入资产”。

## 11. 建议的具体改动清单

### shared

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/constants.ts`

新增：

- `attachmentIds`
- `ImageMessageEvent`
- 对应 SSE / payload 类型

### server

- `apps/server/src/config/env.ts`
- `apps/server/src/modules/system/system-settings-service.ts`
- `apps/server/src/modules/chat/openai-harness.ts`
- `apps/server/src/modules/chat/openai-harness-context.ts`
- `apps/server/src/modules/chat/chat-service.ts`
- `apps/server/src/core/turn/turn-types.ts`
- `apps/server/src/core/turn/session-turn-runtime.ts`
- `apps/server/src/modules/files/file-service.ts`
- 新增 `apps/server/src/modules/chat/openai-image-service.ts`

### web

- `apps/web/src/App.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/MessageItem.tsx`
- `apps/web/src/hooks/useSessionStream.ts`
- 新增图片预览 hook

## 12. 风险与注意事项

1. 不要把历史里的所有图片都转成 data URL 回灌给模型，否则 token 和请求体会爆炸。
2. `gpt-image-2` 与旧图片模型的参数能力并不完全一致，模型相关限制必须放在服务层集中处理。
3. 浏览器端图片 blob URL 要及时释放，避免长会话内存泄露。
4. 图片消息与普通文件消息必须分开，否则前端时间线会越来越难维护。
5. 先做“用户显式附图”的稳定链路，再做“自动引用上一张图”的智能链路。

## 13. 最终推荐

最优方案不是“给现有聊天加一个 if 命中生图关键词就调 `gpt-image-2`”。

最优方案是：

1. 保留现有聊天主模型。
2. 在 Responses 聊天链路中接入 `image_generation` 工具，实现聊天内自动生图/改图。
3. 在服务端额外实现 OpenAI `images/generations` 与 `images/edits` 的统一能力封装。
4. 给会话系统增加显式的图片输入与图片输出建模。
5. 在前端增加图片消息卡片与 blob 预览。

这样做既满足当前需求，也不会把后续多模态能力做成一次性的临时分支。
