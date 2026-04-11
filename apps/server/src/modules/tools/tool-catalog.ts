import type { AssistantToolDefinition } from '../../core/llm/model-client.js';

export const buildAssistantToolCatalog = (options: {
  includeSkillTools?: boolean;
} = {}): AssistantToolDefinition[] => {
  const definitions: AssistantToolDefinition[] = [
    {
      name: 'web_search',
      description: '搜索公开网页的最新信息，适合新闻、政策、排名、分数线、就业和薪资数据。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词' },
          maxResults: { type: 'number', description: '返回结果数量，默认 5，最大 8' },
        },
        required: ['query'],
      },
    },
    {
      name: 'web_fetch',
      description: '访问一个明确的网页 URL，并提取可读正文摘要。',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '需要访问的 http/https 地址' },
          maxChars: { type: 'number', description: '正文最大字符数，默认 4000' },
        },
        required: ['url'],
      },
    },
    {
      name: 'list_files',
      description: '列出当前会话和共享空间中的文件，便于后续读取。',
      inputSchema: {
        type: 'object',
        properties: {
          bucket: { type: 'string', enum: ['uploads', 'outputs', 'shared', 'all'] },
        },
      },
    },
    {
      name: 'read_file',
      description: '读取当前会话或共享区里的文本文件内容，可通过 fileId 或 fileName 指定。',
      inputSchema: {
        type: 'object',
        properties: {
          fileId: { type: 'string', description: '文件 id，优先级高于 fileName' },
          fileName: { type: 'string', description: '文件名或部分文件名' },
          startLine: { type: 'number', description: '起始行号，可选' },
          endLine: { type: 'number', description: '结束行号，可选' },
          maxChars: { type: 'number', description: '最多读取多少字符，默认 6000' },
        },
      },
    },
    {
      name: 'list_workspace_paths',
      description: '列出受控工作区、当前会话目录或激活 Skill 目录中的文件与子目录。',
      inputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string', enum: ['workspace', 'session', 'skill'] },
          path: { type: 'string', description: '相对于根目录的子路径' },
          depth: { type: 'number', description: '目录展开深度，默认 2，最大 4' },
          offset: { type: 'number', description: '分页起始位置' },
          limit: { type: 'number', description: '分页数量，默认 40，最大 120' },
        },
      },
    },
    {
      name: 'read_workspace_path_slice',
      description: '读取受控工作区、当前会话目录或激活 Skill 目录中的文本文件片段。',
      inputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string', enum: ['workspace', 'session', 'skill'] },
          path: { type: 'string', description: '相对于根目录的文件路径' },
          startLine: { type: 'number', description: '起始行号，可选' },
          endLine: { type: 'number', description: '结束行号，可选' },
          maxChars: { type: 'number', description: '最多返回多少字符，默认 6000' },
        },
        required: ['path'],
      },
    },
    {
      name: 'write_artifact_file',
      description: '将文本内容写入当前会话的 outputs 目录，生成可下载产物。',
      inputSchema: {
        type: 'object',
        properties: {
          fileName: { type: 'string', description: '要生成的文件名' },
          content: { type: 'string', description: '要写入的文本内容' },
          mimeType: { type: 'string', description: '文件 MIME 类型，可选' },
          subdir: { type: 'string', description: 'outputs 下的子目录，可选' },
        },
        required: ['fileName', 'content'],
      },
    },
  ];

  if (options.includeSkillTools) {
    definitions.push(
      {
        name: 'list_skill_resources',
        description: '列出激活 Skill 或指定 Skill 的 SKILL.md 与 references 文件。',
        inputSchema: {
          type: 'object',
          properties: {
            skillName: { type: 'string', description: 'Skill 名称，可选；省略时使用当前激活 Skill' },
          },
        },
      },
      {
        name: 'read_skill_resource_slice',
        description: '读取激活 Skill 或指定 Skill 的 SKILL.md / reference 文件片段。',
        inputSchema: {
          type: 'object',
          properties: {
            skillName: { type: 'string', description: 'Skill 名称，可选；省略时使用当前激活 Skill' },
            resource: { type: 'string', description: '资源名，默认 SKILL.md 或 reference 文件名' },
            maxChars: { type: 'number', description: '最多返回多少字符，默认 6000' },
          },
        },
      },
    );
  }

  return definitions;
};
