import type { SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';
import type { SessionContextState } from './session-context-store.js';
import {
  buildDynamicFileSection,
  buildResponsesHistoryInput,
  type ContextInjectionStrategy,
  type ResponsesMessageInput,
} from './openai-harness-context.js';

const toSessionToolPath = (relativePath: string) => {
  const normalized = relativePath.replace(/\\/g, '/');
  const sessionMatch = normalized.match(/^sessions\/[^/]+\/(.+)$/);
  return sessionMatch?.[1] ?? normalized;
};

const formatFilesSection = (files: SessionFileContext[]) => {
  return buildDynamicFileSection(files, toSessionToolPath);
};

const formatSkillsSection = (skills: RegisteredSkill[]) => {
  const lines: string[] = [];
  lines.push('## Enabled Skills');

  if (skills.length === 0) {
    lines.push('当前会话未启用任何 skill。不要尝试读取 `skills/` 目录，也不要执行 `skills/*/scripts` 下的脚本，按普通对话和通用工具处理。');
    return lines.join('\n');
  }

  lines.push('Skill 是一组存放在 `SKILL.md` 中的本地指令。以下列表是当前会话唯一可用的 skill。未列出的 skill 一律不可使用。');
  lines.push('### Available skills');

  for (const skill of skills) {
    const skillPath = `${skill.directory.replace(/\\/g, '/').replace(/^.*\/skills\//, 'skills/')}/SKILL.md`;
    lines.push(`- ${skill.name}: ${skill.description} (file: ${skillPath})`);
  }

  lines.push('### How to use skills');
  lines.push('- Discovery: 上面的列表就是当前会话已启用的全部 skills；skill 正文在对应目录的 `SKILL.md` 中。');
  lines.push('- Scope: 只有上面列出的 skill 可以被读取、参考或使用其目录中的脚本；未列出的 skill 不可用。');
  lines.push('- Trigger rules: 如果用户点名某个已启用 skill，或任务明显匹配某个已启用 skill 的描述，就在本轮使用它。多个 skill 同时命中时，使用能覆盖任务的最小集合。除非用户再次提及，否则不要把 skill 自动延续到后续轮次。');
  lines.push('- Missing/blocked: 如果用户点名的 skill 不在上面的已启用列表里，说明当前会话未启用该 skill，然后继续采用最佳替代方案。');
  lines.push('- How to use a skill (progressive disclosure):');
  lines.push('  1. 决定使用某个 skill 后，先读取它的 `SKILL.md`，只读取足够完成当前任务的部分。');
  lines.push('  2. 如果 `SKILL.md` 提到了相对路径，例如 `scripts/foo.py` 或 `references/bar.md`，先按 skill 目录中的相对路径解析，再视需要继续读取。');
  lines.push('  3. 如果 `SKILL.md` 指向 `references/` 等额外目录，只读取当前请求需要的具体文件，不要整包加载。');
  lines.push('  4. 如果 skill 提供了 `scripts/`，先读取 `SKILL.md` 中与脚本有关的说明；确实需要执行时，再用 `run_workspace_script` 传显式 `path` 与 `args`，按原生命令行运行，不要假设存在默认 `run.py` 入口。');
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
  const roleDescription = '你是 SkillChat 的中文智能体。让模型承担智能判断，程序只负责提供工具和执行流程。';
  const workingStyle = [
    '- 你自己决定是否需要读文件、使用 skill、联网搜索或生成产物；不要把这些流程外包给用户。',
    '- Skill 是本地说明书，不是特殊流程节点。需要使用某个 skill 时，先读取 `SKILL.md`，再按需读取它指向的具体文件。',
    '- 只有在会话已启用某个 skill 时，才可以读取它的说明或使用它相关的脚本与资源。',
    '- 需要最新信息时可以使用联网能力；需要会话或工作区信息时可以使用文件与路径工具；是否调用、调用顺序和调用次数由你自行判断。',
    '- 如果工具已经返回足够信息，就直接组织结论，不要继续堆叠无意义的调用。',
    '- 不要原样转储工具输出、网页正文或大段文件原文；把它们整理成自然答复。',
    '- 如果已经拿到足够信息，就直接给出结论，不要为了显得像 agent 而额外调用工具。',
  ].join('\n');

  const template = [
    '## Role',
    '{role_description}',
    '',
    '## Working Style',
    '{working_style}',
    '',
    '## Runtime Context',
    '当前日期：{today}',
    '工作区根目录：{cwd}',
    '',
    '{files_section}',
    '',
    '{skills_section}',
  ].join('\n');

  return template
    .replace('{role_description}', roleDescription)
    .replace('{working_style}', workingStyle)
    .replace('{today}', today)
    .replace('{cwd}', args.config.CWD)
    .replace('{files_section}', formatFilesSection(args.files))
    .replace('{skills_section}', formatSkillsSection(args.availableSkills));
};

export const toResponsesHarnessInput = (
  history: StoredEvent[],
  currentMessage: string,
  options: {
    config?: AppConfig;
    contextState?: SessionContextState | null;
    injectionStrategy?: ContextInjectionStrategy;
  } = {},
): ResponsesMessageInput[] => {
  return buildResponsesHistoryInput({
    config: options.config,
    history,
    currentMessage,
    contextState: options.contextState,
    injectionStrategy: options.injectionStrategy,
  }).input;
};
