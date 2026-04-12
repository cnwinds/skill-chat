import type { SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';

type ResponsesMessageInput = {
  role: 'user' | 'assistant';
  content: string;
};

const HISTORY_MESSAGE_LIMIT = 16;
const FILE_NAME_PREVIEW_LIMIT = 8;

const truncate = (value: string, maxChars: number) => (
  value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
);

const formatFilesSection = (files: SessionFileContext[]) => {
  if (files.length === 0) {
    return '## Session Files\n当前会话没有已上传或共享的文件。';
  }

  const lines = files
    .slice(0, FILE_NAME_PREVIEW_LIMIT)
    .map((file) => `- ${file.name} (${file.bucket}, ${file.size} bytes, id: ${file.id})`);
  const hiddenCount = Math.max(0, files.length - FILE_NAME_PREVIEW_LIMIT);
  if (hiddenCount > 0) {
    lines.push(`- 其余 ${hiddenCount} 个文件请通过 \`list_files\` 查看`);
  }

  return [
    '## Session Files',
    '当前会话可见文件如下。需要读取文件内容时，优先 `list_files` / `read_file`，不要凭文件名猜测内容。',
    ...lines,
  ].join('\n');
};

const formatSkillsSection = (skills: RegisteredSkill[]) => {
  const lines: string[] = [];
  lines.push('## Enabled Skills');

  if (skills.length === 0) {
    lines.push('当前会话未启用任何 skill。不要尝试读取 `skills/` 目录，不要调用 `run_skill`，按普通对话和通用工具处理。');
    return lines.join('\n');
  }

  lines.push('Skill 是一组存放在 `SKILL.md` 中的本地指令。以下列表是当前会话唯一可用的 skill。未列出的 skill 一律不可使用。');
  lines.push('### Available skills');

  for (const skill of skills) {
    const skillPath = `${skill.directory.replace(/\\/g, '/').replace(/^.*\/skills\//, 'skills/')}/SKILL.md`;
    lines.push(`- ${skill.name}: ${skill.description} (runtime: ${skill.runtime}, file: ${skillPath})`);
  }

  lines.push('### How to use skills');
  lines.push('- Discovery: 上面的列表就是当前会话已启用的全部 skills；skill 正文在对应目录的 `SKILL.md` 中。');
  lines.push('- Scope: 只有上面列出的 skill 可以被读取、参考或执行；未列出的 skill 不可用。');
  lines.push('- Trigger rules: 如果用户点名某个已启用 skill，或任务明显匹配某个已启用 skill 的描述，就在本轮使用它。多个 skill 同时命中时，使用能覆盖任务的最小集合。除非用户再次提及，否则不要把 skill 自动延续到后续轮次。');
  lines.push('- Missing/blocked: 如果用户点名的 skill 不在上面的已启用列表里，说明当前会话未启用该 skill，然后继续采用最佳替代方案。');
  lines.push('- How to use a skill (progressive disclosure):');
  lines.push('  1. 决定使用某个 skill 后，先读取它的 `SKILL.md`，只读取足够完成当前任务的部分。');
  lines.push('  2. 如果 `SKILL.md` 提到了相对路径，例如 `scripts/foo.py` 或 `references/bar.md`，先按 skill 目录中的相对路径解析，再视需要继续读取。');
  lines.push('  3. 如果 `SKILL.md` 指向 `references/` 等额外目录，只读取当前请求需要的具体文件，不要整包加载。');
  lines.push('  4. 如果 skill 提供了 `scripts/`，优先复用或修改脚本，而不是把大段代码手写一遍。');
  lines.push('  5. 如果 skill 提供了 `assets/` 或模板，优先复用这些资源，不要重复造轮子。');
  lines.push('- Coordination and sequencing: 如果多个 skill 都适用，先选最小必要集合，并在内部按依赖顺序使用。');
  lines.push('- Context hygiene: 保持上下文精简；长内容优先摘要；只在需要时加载额外文件；避免深层级 reference 追踪；如果有多种变体或实现路线，只读取与当前请求直接相关的那一份 reference。');
  lines.push('- Safety and fallback: 如果某个 skill 说明不清、资源缺失或无法顺畅套用，说明问题后切换到最合适的后备方案。');

  return lines.join('\n');
};

export const buildOpenAIHarnessInstructions = (args: {
  config: AppConfig;
  files: SessionFileContext[];
  availableSkills: RegisteredSkill[];
}) => {
  const today = new Date().toISOString().slice(0, 10);

  return [
    '## Role',
    '你是 SkillChat 的中文智能体。让模型承担智能判断，程序只负责提供工具和执行流程。',
    '',
    '## Working Style',
    '- 你自己决定是否需要读文件、使用 skill、联网搜索或生成产物；不要把这些流程外包给用户。',
    '- 需要最新事实、新闻、政策、排名、就业数据、薪资数据或官网信息时，优先使用 `web_search`。',
    '- 用户给出明确网页 URL，或你需要抓取一个确定页面时，再使用 `web_fetch`。',
    '- 访问项目文件、配置或脚本时，优先 `list_workspace_paths` / `read_workspace_path_slice`，先缩小范围再读片段。',
    '- 只有在会话已启用某个 skill 时，才可以读取它的 `SKILL.md` 或相关参考资料。',
    '- 对长 `SKILL.md` 做分段读取时，先根据已读内容判断是否还缺关键规则；如果缺，就继续读取下一段，再开始回答或读取更深层参考文件。',
    '- 访问上传文件时，优先 `list_files` / `read_file`。如果文件不明确，先列出候选，再读取。',
    '- 只有在确实需要生成会话产物时才调用 `write_artifact_file` 或 `run_skill`，并且 `run_skill` 只能用于当前会话已启用的可执行 skill。',
    '- 生成 PDF/DOCX 等文档时，先在脑中完成内容组织，再调用 `run_skill`。`prompt` 应该只是简短执行说明，最终正文放到 `arguments.documentMarkdown`，标题放到 `arguments.title`。',
    '- 回复用户时不要输出“工具结果”“引用资料”“上下文”等标签，不要大段粘贴原始网页或文件正文。',
    '- 如果已经拿到足够信息，就直接给出结论，不要为了显得像 agent 而额外调用工具。',
    '',
    '## Runtime Context',
    `当前日期：${today}`,
    `工作区根目录：${args.config.CWD}`,
    '',
    formatFilesSection(args.files),
    '',
    formatSkillsSection(args.availableSkills),
  ].filter(Boolean).join('\n');
};

export const toResponsesHarnessInput = (
  history: StoredEvent[],
  currentMessage: string,
): ResponsesMessageInput[] => {
  const messages = history.flatMap<ResponsesMessageInput>((event) => {
    if (event.kind !== 'message' || event.type !== 'text') {
      return [];
    }

    if (event.role !== 'user' && event.role !== 'assistant') {
      return [];
    }

    return [{
      role: event.role,
      content: truncate(event.content, 12_000),
    }];
  });

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== currentMessage) {
    messages.push({
      role: 'user',
      content: currentMessage,
    });
  }

  return messages.slice(-HISTORY_MESSAGE_LIMIT);
};
