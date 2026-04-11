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
  if (skills.length === 0) {
    return '';
  }

  const lines: string[] = [];
  lines.push('## Skills');
  lines.push('Skill 是一组存放在 `SKILL.md` 中的本地指令。以下列表是当前会话可用 skill。');
  lines.push('### Available skills');

  for (const skill of skills) {
    const skillPath = `${skill.directory.replace(/\\/g, '/').replace(/^.*\/skills\//, 'skills/')}/SKILL.md`;
    lines.push(`- ${skill.name}: ${skill.description} (runtime: ${skill.runtime}, file: ${skillPath})`);
  }

  lines.push('### How to use skills');
  lines.push('- 如果用户点名某个 skill，或任务明显匹配某个 skill 的描述，就在本轮使用它。');
  lines.push('- 使用 skill 时，先读取对应的 `SKILL.md`，只读取完成当前任务所需的部分。');
  lines.push('- 如果 `SKILL.md` 提到了 `references/`、脚本、模板或其他文件，再按需逐步读取，不要一次性加载全部参考资料。');
  lines.push('- chat 类型 skill 通过读取其说明和参考资料来获得角色、语气和回答工作流。');
  lines.push('- python/node 类型 skill 如果需要生成 PDF/XLSX/DOCX 等产物，可以在理解 `SKILL.md` 后调用 `run_skill`。');
  lines.push('- 调用文档类 skill（例如 pdf/docx）时，必须把最终成稿内容放进 `run_skill.arguments`，优先使用 `title`、`summary`、`documentMarkdown` 等字段；不要把“请生成”“文档要求”“输出约束”这类任务说明直接当正文传给 skill。');
  lines.push('- 不要把 skill 当成自动预载上下文；先确认需要，再读取。');

  return lines.join('\n');
};

const serializeActivatedSkill = (skill: RegisteredSkill) => {
  const relativeSkillPath = `${skill.directory.replace(/\\/g, '/').replace(/^.*\/skills\//, 'skills/')}/SKILL.md`;
  return [
    '<skill>',
    `<name>${skill.name}</name>`,
    `<path>${relativeSkillPath}</path>`,
    skill.rawMarkdown ?? skill.markdown,
    '</skill>',
  ].join('\n');
};

const formatExplicitActivatedSkillsSection = (skills: RegisteredSkill[]) => {
  if (skills.length === 0) {
    return '';
  }

  return [
    '## Explicitly Activated Skills',
    '以下 skill 已在会话启动前被显式激活。它们等价于用户在本轮前已经明确选择了这些 skill，你应优先遵循这些 skill 的指令。',
    ...skills.map(serializeActivatedSkill),
  ].join('\n\n');
};

export const buildOpenAIHarnessInstructions = (args: {
  config: AppConfig;
  files: SessionFileContext[];
  skills: RegisteredSkill[];
  activatedSkills?: RegisteredSkill[];
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
    '- 访问项目文件、skill 文件、参考资料、配置或脚本时，优先 `list_workspace_paths` / `read_workspace_path_slice`，先缩小范围再读片段。',
    '- 访问上传文件时，优先 `list_files` / `read_file`。如果文件不明确，先列出候选，再读取。',
    '- 只有在确实需要生成会话产物时才调用 `write_artifact_file` 或 `run_skill`。',
    '- 生成 PDF/DOCX 等文档时，先在脑中完成内容组织，再调用 `run_skill`。`prompt` 应该只是简短执行说明，最终正文放到 `arguments.documentMarkdown`，标题放到 `arguments.title`。',
    '- 回复用户时不要输出“工具结果”“引用资料”“上下文”等标签，不要大段粘贴原始网页或文件正文。',
    '- 如果已经拿到足够信息，就直接给出结论，不要为了显得像 agent 而额外调用工具。',
    '',
    '## Runtime Context',
    `当前日期：${today}`,
    `工作区根目录：${args.config.CWD}`,
    '项目内 skills 目录位于 `skills/`。',
    '',
    formatFilesSection(args.files),
    '',
    formatExplicitActivatedSkillsSection(args.activatedSkills ?? []),
    '',
    formatSkillsSection(args.skills),
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
