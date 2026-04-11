import type { PlannerResult, RouterDecision } from '@skillchat/shared';
import type {
  ChatModelClient,
  ClassifyInput,
  PlanInput,
  ReplyInput,
  SkillReplyInput,
  ToolPlanningInput,
  ToolPlanningResult,
} from './model-client.js';

const splitIntoChunks = function* (text: string) {
  const parts = text.match(/.{1,24}/g) ?? [text];
  for (const part of parts) {
    yield part;
  }
};

const deriveTitle = (message: string) => {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > 24 ? `${compact.slice(0, 24)}...` : compact;
};

const buildGuidanceReply = (message: string) => {
  if (/(专业|志愿|大学|高考|选科|学校|就业|考研)/.test(message)) {
    return [
      '可以，但“好一点的专业”不能脱离你的现实条件单独讨论。',
      '先告诉我这几个关键信息：多少分、哪个省、选科组合或文理科、以后更看重就业还是兴趣、想去什么城市。',
      '如果你现在只想先听原则，我先给你一个不容易踩坑的顺序：先看就业确定性，再看城市机会，最后才看专业名字好不好听。',
      '普通家庭做选择，优先看中位数，不要只看网上最成功的那几个案例。',
    ].join('');
  }

  if (/(工作|职业|求职|跳槽|offer|面试|简历)/.test(message)) {
    return [
      '这个问题可以聊，但我不想空对空给你灌鸡汤。',
      '你先告诉我你现在的阶段、目标岗位、最担心的问题，我再按现状、选项和风险给你拆开说。',
    ].join('');
  }

  return [
    '我先帮你把问题收窄一点，这样回答才会靠谱。',
    '你可以直接补充你的目标、限制条件和最在意的结果，我会按可执行的方案给你建议。',
  ].join('');
};

const buildContextAwareReply = (message: string, context: string) => {
  if (/(专业|志愿|大学|高考|选科|学校|就业|考研)/.test(message)) {
    return [
      '我已经结合刚才检索和抓取到的资料做了整理，正文里不再直接铺原始网页内容。',
      buildGuidanceReply(message),
      '如果你需要出处，我再单独列链接给你。',
    ].join('');
  }

  if (/(文件|附件|上传|文档|pdf|word|excel|csv|表格|内容|看看|读取|总结|分析)/i.test(message) || /文件名：/.test(context)) {
    return [
      '我已经读取到相关文件内容了，接下来会直接给你整理后的结论，不展示原始文件正文。',
      '如果你要我按摘要、风险点、待办或结构化提纲来输出，可以继续指定。',
    ].join('');
  }

  if (/搜索关键词组合：|搜索命中结果|结果页分析:/.test(context)) {
    return [
      '我已经结合搜索结果和结果页内容做了整理。',
      '为了避免把抓取到的原文直接堆给你，正文只保留结论和建议；如果你需要来源，我再单独列给你。',
    ].join('');
  }

  return [
    '我已经拿到补充资料，会直接按结论给你回答，不再展示原始上下文。',
    '如果你需要出处或原文摘录，再单独告诉我。',
  ].join('');
};

const latestInfoPattern = /(最新|最近|今天|今年|当前|目前|数据|排名|分数线|政策|就业|薪资|新闻|搜一下|搜索|查一下|官网|网址|网页|链接)/;
const fileIntentPattern = /(文件|附件|上传|文档|pdf|word|excel|csv|表格|内容|看看|读取|总结|分析)/i;
const workspaceIntentPattern = /(工作区|目录|模板|脚本|本地文件|配置|日志|markdown|html|skill 文件|参考文件|参考资料|SKILL\.md)/i;
const skillResourceIntentPattern = /(skill 文件|SKILL\.md|参考文件|参考资料|references?|规则|提示词)/i;
const urlPattern = /https?:\/\/[^\s)]+/i;
const workspacePathPattern = /((?:[\w.-]+\/)*[\w.-]+\.(?:md|txt|json|jsonl|csv|html|htm|ts|tsx|js|jsx|py|yaml|yml|log|toml|ini|sql|css))/i;

const findMentionedFile = (message: string, files: ToolPlanningInput['files']) => {
  const lower = message.toLowerCase();
  return files.find((file) => lower.includes(file.name.toLowerCase()));
};

const findMentionedWorkspacePath = (message: string) => message.match(workspacePathPattern)?.[1];

export class RuleBasedModelClient implements ChatModelClient {
  async classify(input: ClassifyInput): Promise<RouterDecision> {
    const lower = input.message.toLowerCase();

    if (/张雪峰|雪峰视角|雪峰模式/.test(input.message)) {
      return {
        mode: 'skill',
        needClarification: false,
        selectedSkills: ['zhangxuefeng-perspective'],
        reason: '检测到张雪峰视角类请求',
      };
    }

    if (/(pdf|报告|周报|日报)/.test(lower)) {
      return {
        mode: 'skill',
        needClarification: false,
        selectedSkills: ['pdf'],
        reason: '检测到 PDF/报告类请求',
      };
    }

    if (/(xlsx|excel|表格|csv)/.test(lower)) {
      return {
        mode: 'skill',
        needClarification: false,
        selectedSkills: ['xlsx'],
        reason: '检测到 Excel/表格类请求',
      };
    }

    if (/(docx|word|文档|纪要|合同|方案)/.test(lower)) {
      return {
        mode: 'skill',
        needClarification: false,
        selectedSkills: ['docx'],
        reason: '检测到 Word/文档类请求',
      };
    }

    return {
      mode: 'chat',
      needClarification: false,
      selectedSkills: [],
      reason: '未命中 Skill 关键词，按普通对话处理',
    };
  }

  async plan(input: PlanInput): Promise<PlannerResult> {
    return {
      assistantMessage: `准备调用 ${input.skill.name} Skill 处理你的请求。`,
      toolCalls: [
        {
          skill: input.skill.name,
          action: 'run',
          arguments: {
            title: deriveTitle(input.message),
            prompt: input.message,
            files: input.files.map((file) => ({
              id: file.id,
              name: file.name,
              relativePath: file.relativePath,
              bucket: file.bucket,
            })),
          },
        },
      ],
    };
  }

  async planToolUse(input: ToolPlanningInput): Promise<ToolPlanningResult> {
    const toolNames = new Set(input.tools.map((tool) => tool.name));
    const toolCalls: ToolPlanningResult['toolCalls'] = [];
    const explicitUrl = input.message.match(urlPattern)?.[0];
    const mentionedFile = findMentionedFile(input.message, input.files);
    const mentionedWorkspacePath = findMentionedWorkspacePath(input.message);

    if (explicitUrl && toolNames.has('web_fetch')) {
      toolCalls.push({
        tool: 'web_fetch',
        arguments: {
          url: explicitUrl,
        },
      });
    }

    if (
      !explicitUrl &&
      toolNames.has('web_search') &&
      (
        latestInfoPattern.test(input.message) ||
        (input.skill?.name === 'zhangxuefeng-perspective' && /(专业|学校|院校|录取|就业|薪资|行业)/.test(input.message))
      )
    ) {
      toolCalls.push({
        tool: 'web_search',
        arguments: {
          query: input.message,
          maxResults: 5,
        },
      });
    }

    if (mentionedFile && toolNames.has('read_file')) {
      toolCalls.push({
        tool: 'read_file',
        arguments: {
          fileId: mentionedFile.id,
          maxChars: 6000,
        },
      });
    } else if (input.files.length > 0 && fileIntentPattern.test(input.message) && toolNames.has('list_files')) {
      toolCalls.push({
        tool: 'list_files',
        arguments: {},
      });
    }

    if (
      skillResourceIntentPattern.test(input.message) &&
      input.skill &&
      toolNames.has('list_skill_resources')
    ) {
      toolCalls.push({
        tool: mentionedWorkspacePath && toolNames.has('read_skill_resource_slice')
          ? 'read_skill_resource_slice'
          : 'list_skill_resources',
        arguments: mentionedWorkspacePath
          ? { resource: mentionedWorkspacePath.replace(/^references\//, '') }
          : {},
      });
    } else if (workspaceIntentPattern.test(input.message)) {
      if (mentionedWorkspacePath && toolNames.has('read_workspace_path_slice')) {
        toolCalls.push({
          tool: 'read_workspace_path_slice',
          arguments: {
            root: input.skill ? 'skill' : 'workspace',
            path: mentionedWorkspacePath,
            maxChars: 6000,
          },
        });
      } else if (toolNames.has('list_workspace_paths')) {
        toolCalls.push({
          tool: 'list_workspace_paths',
          arguments: {
            root: input.skill ? 'skill' : 'workspace',
            depth: 2,
          },
        });
      }
    }

    return {
      toolCalls: toolCalls.slice(0, 3),
    };
  }

  async *replyStream(input: ReplyInput): AsyncIterable<string> {
    let reply = buildGuidanceReply(input.message);

    if (/(你好|hello|hi)/i.test(input.message)) {
      reply = '你好，我可以帮你处理 PDF、Excel、Word 文档，也可以回答普通问题。';
    } else if (/(你能做什么|帮助|help)/i.test(input.message)) {
      reply = '我可以进行普通聊天，也可以调用内置 Skill 生成 PDF、Excel 和 Word 文件。你也可以先上传文件再让我处理。';
    } else if (input.context) {
      reply = buildContextAwareReply(input.message, input.context);
    }

    for (const chunk of splitIntoChunks(reply)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      yield chunk;
    }
  }

  async *skillReplyStream(input: SkillReplyInput): AsyncIterable<string> {
    if (input.skill.name === 'zhangxuefeng-perspective') {
      const reply = [
        '我跟你说，你这个问题别上来就谈理想，先看现实。',
        '先告诉我几个关键信息：多少分、哪个省、家里有没有相关资源、你以后想在哪个城市发展。',
        '没有这些信息，直接拍脑袋给建议，那不是负责，那是害人。',
        '但如果你就想先听个原则，我给你一句话：普通家庭做选择，先看就业中位数，再看城市机会，最后才谈兴趣。',
      ].join('');

      for (const chunk of splitIntoChunks(reply)) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        yield chunk;
      }
      return;
    }

    yield* this.replyStream({
      message: input.message,
      history: input.history,
      context: input.context,
    });
  }
}
