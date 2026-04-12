import fs from 'node:fs/promises';
import dns from 'node:dns';
import { lookup as dnsLookup } from 'node:dns/promises';
import { z } from 'zod';
import type { FileRecord, SessionFileContext } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { FileService } from '../files/file-service.js';
import { isOpenAIResponsesRecord, streamOpenAIResponsesEvents } from '../../core/llm/openai-responses.js';
import { assertPathInside, sanitizeFilename } from '../../core/storage/fs-utils.js';
import { getUserRoot, resolveUserPath } from '../../core/storage/paths.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';
import {
  ensureArtifactPath,
  formatListedWorkspaceEntries,
  isTextLikePath,
  listWorkspaceEntries,
  readTextSlice,
  resolveUserVisiblePath,
  resolveWorkspaceRoot,
  resolveWorkspacePath,
  type WorkspaceRootName,
} from './resource-access.js';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type SearchMatch = SearchResult & {
  query: string;
  provider: string;
};

type SearchPageAnalysis = SearchMatch & {
  finalUrl?: string;
  excerpt?: string;
  fetchError?: string;
};

type NativeWebSearchAction = {
  type?: string;
  query?: string;
  queries?: string[];
  url?: string;
  pattern?: string;
};

type PlannedAssistantToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

export interface ExecutedAssistantToolResult {
  tool: string;
  arguments: Record<string, unknown>;
  summary: string;
  content: string;
  context?: string;
  artifacts?: FileRecord[];
}

const TOOL_TIMEOUT_MS = 15_000;
const NATIVE_WEB_SEARCH_TIMEOUT_MS = 45_000;
const API_RETRY_LIMIT = 5;
const API_RETRY_DELAY_MS = 1_000;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const privateIpv4Pattern = /^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/;
const searchNoisePattern = /帮我|帮忙|麻烦|请问|请|一下|一下子|给我|我想知道|我想了解|我想问|想知道|想了解|想问|能不能|可以|有没有|怎么|怎样|如何|怎么样|是什么|说说|讲讲|看看|查一下|搜一下|搜一搜|推荐|分析|介绍|总结/gi;
const trackingParamPattern = /^(utm_|spm$|from$|src$|source$|ref$|referer$|campaign$|yclid$|gclid$|fbclid$)/i;
const SEARCH_QUERY_LIMIT = 4;
const SEARCH_RESULT_LIMIT = 8;
const SEARCH_FETCH_LIMIT = 4;
const SEARCH_PAGE_EXCERPT_CHARS = 1_600;
const MODEL_CONTEXT_EXCERPT_CHARS = 900;

export const networkResolver = {
  lookup: dnsLookup,
  getDefaultResultOrder: () => dns.getDefaultResultOrder(),
  setDefaultResultOrder: (order: ReturnType<typeof dns.getDefaultResultOrder>) => dns.setDefaultResultOrder(order),
};

const webSearchSchema = z.object({
  query: z.string().trim().min(2, 'query 不能为空'),
  maxResults: z.coerce.number().int().min(1).max(8).optional().default(5),
});

const webFetchSchema = z.object({
  url: z.string().trim().url('url 不合法'),
  maxChars: z.coerce.number().int().min(400).max(12_000).optional().default(4_000),
});

const listFilesSchema = z.object({
  bucket: z.enum(['uploads', 'outputs', 'shared', 'all']).optional().default('all'),
});

const readFileSchema = z.object({
  fileId: z.string().trim().min(1).optional(),
  fileName: z.string().trim().min(1).optional(),
  startLine: z.coerce.number().int().positive().optional(),
  endLine: z.coerce.number().int().positive().optional(),
  maxChars: z.coerce.number().int().min(400).max(12_000).optional().default(6_000),
}).refine((value) => value.fileId || value.fileName, {
  message: 'fileId 或 fileName 至少提供一个',
});

const listWorkspacePathsSchema = z.object({
  root: z.enum(['workspace', 'session', 'skill']).optional().default('workspace'),
  path: z.string().trim().optional().default(''),
  depth: z.coerce.number().int().min(0).max(4).optional().default(2),
  offset: z.coerce.number().int().min(0).optional().default(0),
  limit: z.coerce.number().int().min(1).max(120).optional().default(40),
});

const readWorkspacePathSliceSchema = z.object({
  root: z.enum(['workspace', 'session', 'skill']).optional().default('workspace'),
  path: z.string().trim().min(1, 'path 不能为空'),
  startLine: z.coerce.number().int().positive().optional(),
  endLine: z.coerce.number().int().positive().optional(),
  maxChars: z.coerce.number().int().min(400).max(12_000).optional().default(6_000),
});

const listSkillResourcesSchema = z.object({
  skillName: z.string().trim().min(1).optional(),
});

const readSkillResourceSliceSchema = z.object({
  skillName: z.string().trim().min(1).optional(),
  resource: z.string().trim().min(1).optional().default('SKILL.md'),
  maxChars: z.coerce.number().int().min(400).max(12_000).optional().default(6_000),
});

const writeArtifactFileSchema = z.object({
  fileName: z.string().trim().min(1, 'fileName 不能为空'),
  content: z.string().min(1, 'content 不能为空'),
  mimeType: z.string().trim().optional(),
  subdir: z.string().trim().optional(),
});

const decodeHtmlEntities = (input: string) =>
  input
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');

const stripTags = (input: string) => decodeHtmlEntities(input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
const normalizeWhitespace = (input: string) => input.replace(/\n{3,}/g, '\n\n').trim();
const stripScriptsAndStyles = (input: string) => input
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ');
const truncate = (input: string, maxChars: number) => (input.length > maxChars ? `${input.slice(0, maxChars)}...` : input);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const resolveDuckDuckGoUrl = (href: string) => {
  const normalized = href.startsWith('//') ? `https:${href}` : href;
  try {
    const parsed = new URL(normalized);
    const redirectTarget = parsed.searchParams.get('uddg');
    return redirectTarget ? decodeURIComponent(redirectTarget) : normalized;
  } catch {
    return href;
  }
};

const isBlockedHostname = (hostname: string) => {
  const lower = hostname.toLowerCase();
  return (
    lower === 'localhost' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    privateIpv4Pattern.test(lower)
  );
};

const assertPublicHttpUrl = (input: string) => {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https 网页地址');
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error('不允许访问本地或内网地址');
  }

  return url;
};

const canonicalizeUrl = (input: string) => {
  try {
    const url = new URL(input);
    url.hash = '';
    const entries = [...url.searchParams.entries()];
    url.search = '';
    for (const [key, value] of entries) {
      if (!trackingParamPattern.test(key)) {
        url.searchParams.append(key, value);
      }
    }
    return url.toString();
  } catch {
    return input;
  }
};

const buildSearchQueries = (rawQuery: string) => {
  const compact = normalizeWhitespace(rawQuery.replace(/\s+/g, ' '));
  const core = normalizeWhitespace(
    compact
      .replace(/[?？!！,，。；;：“”"'`~·（）()【】\[\]]/g, ' ')
      .replace(searchNoisePattern, ' ')
      .replace(/\s+/g, ' '),
  );

  const queries = [
    compact,
    core && core !== compact ? core : '',
  ];

  return queries
    .map((query) => normalizeWhitespace(query))
    .filter((query, index, array) => query.length >= 2 && array.indexOf(query) === index)
    .slice(0, SEARCH_QUERY_LIMIT);
};

const formatFileList = (files: SessionFileContext[]) =>
  files.map((file) => [
    `- ${file.name}`,
    `  id: ${file.id}`,
    `  bucket: ${file.bucket}`,
    `  mimeType: ${file.mimeType ?? 'application/octet-stream'}`,
    `  size: ${file.size}`,
    `  path: ${file.relativePath}`,
  ].join('\n')).join('\n');

const findFilesByName = (files: SessionFileContext[], fileName: string) => {
  const lower = fileName.toLowerCase();
  const exact = files.filter((file) => file.name.toLowerCase() === lower);
  if (exact.length > 0) {
    return exact;
  }
  return files.filter((file) => file.name.toLowerCase().includes(lower));
};

const readCauseCode = (error: unknown) => {
  if (typeof error !== 'object' || !error || !('cause' in error)) {
    return null;
  }

  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause !== 'object' || !cause || !('code' in cause)) {
    return null;
  }

  return String((cause as { code?: unknown }).code ?? '');
};

const shouldRetryWithIpv4 = (error: unknown) => readCauseCode(error) === 'UND_ERR_CONNECT_TIMEOUT';

const hostHasDualStackAddresses = async (hostname: string) => {
  try {
    const records = await networkResolver.lookup(hostname, { all: true });
    const families = new Set(records.map((record) => record.family));
    return families.has(4) && families.has(6);
  } catch {
    return false;
  }
};

const extractMetaContent = (html: string, key: string) => {
  const patterns = [
    new RegExp(`<meta[^>]+name=["']${key}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+property=["']${key}["'][^>]+content=["']([\\s\\S]*?)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+name=["']${key}["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([\\s\\S]*?)["'][^>]+property=["']${key}["'][^>]*>`, 'i'),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }

  return '';
};

const extractHtmlExcerpt = (html: string, maxChars: number) => {
  const sanitized = stripScriptsAndStyles(html);
  const title = stripTags(sanitized.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const description = extractMetaContent(sanitized, 'description') || extractMetaContent(sanitized, 'og:description');
  const body = stripTags(
    sanitized
      .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n'),
  );
  const excerpt = normalizeWhitespace(body).slice(0, maxChars);

  return [
    title ? `标题：${title}` : '',
    description ? `摘要：${description}` : '',
    excerpt ? `正文：\n${excerpt}` : '',
  ].filter(Boolean).join('\n\n');
};

const normalizeWorkspaceToolPath = (value?: string) => value
  ? value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  : '';

export class AssistantToolService {
  constructor(
    private readonly config: AppConfig,
    private readonly fileService: FileService,
  ) {}

  async execute(args: {
    userId: string;
    sessionId: string;
    call: PlannedAssistantToolCall;
    availableSkills?: RegisteredSkill[];
    skill?: RegisteredSkill;
  }): Promise<ExecutedAssistantToolResult> {
    switch (args.call.tool) {
      case 'web_search':
        return this.executeWebSearch(args.call.arguments);
      case 'web_fetch':
        return this.executeWebFetch(args.call.arguments);
      case 'list_files':
        return this.executeListFiles(args.userId, args.sessionId, args.call.arguments);
      case 'read_file':
        return this.executeReadFile(args.userId, args.sessionId, args.call.arguments);
      case 'list_workspace_paths':
        return this.executeListWorkspacePaths(
          args.userId,
          args.sessionId,
          args.call.arguments,
          args.availableSkills ?? [],
          args.skill,
        );
      case 'read_workspace_path_slice':
        return this.executeReadWorkspacePathSlice(
          args.userId,
          args.sessionId,
          args.call.arguments,
          args.availableSkills ?? [],
          args.skill,
        );
      case 'list_skill_resources':
        return this.executeListSkillResources(args.call.arguments, args.availableSkills ?? [], args.skill);
      case 'read_skill_resource_slice':
        return this.executeReadSkillResourceSlice(args.call.arguments, args.availableSkills ?? [], args.skill);
      case 'write_artifact_file':
        return this.executeWriteArtifactFile(args.userId, args.sessionId, args.call.arguments);
      default:
        throw new Error(`未知工具：${args.call.tool}`);
    }
  }

  private resolveTargetSkill(
    availableSkills: RegisteredSkill[],
    skill: RegisteredSkill | undefined,
    requestedName?: string,
  ) {
    if (requestedName) {
      const requestedSkill = availableSkills.find((item) => item.name === requestedName);
      if (!requestedSkill) {
        throw new Error(`当前会话未启用 Skill：${requestedName}`);
      }
      return requestedSkill;
    }

    if (skill) {
      return skill;
    }

    throw new Error('当前没有已启用的 Skill，请先指定 skillName');
  }

  private assertWorkspaceSkillPathAccess(
    root: WorkspaceRootName,
    requestedPath: string | undefined,
    availableSkills: RegisteredSkill[],
  ) {
    if (root !== 'workspace') {
      return;
    }

    const normalizedPath = normalizeWorkspaceToolPath(requestedPath);
    if (!normalizedPath) {
      return;
    }

    const segments = normalizedPath.split('/').filter(Boolean);
    if (segments[0] !== 'skills') {
      return;
    }

    if (segments.length === 1) {
      if (availableSkills.length === 0) {
        throw new Error('当前会话未启用任何 Skill，不能访问 skills 目录');
      }
      return;
    }

    const requestedSkillName = segments[1]!;
    if (!availableSkills.some((item) => item.name === requestedSkillName)) {
      throw new Error(`当前会话未启用 Skill：${requestedSkillName}`);
    }
  }

  private filterWorkspaceEntriesForSkillScope(
    requestedPath: string | undefined,
    entries: Awaited<ReturnType<typeof listWorkspaceEntries>>['entries'],
    availableSkills: RegisteredSkill[],
  ) {
    const normalizedBasePath = normalizeWorkspaceToolPath(requestedPath);
    const allowedSkillNames = new Set(availableSkills.map((skill) => skill.name));

    return entries.filter((entry) => {
      const fullPath = [normalizedBasePath, normalizeWorkspaceToolPath(entry.relativePath)]
        .filter(Boolean)
        .join('/');

      if (!fullPath.startsWith('skills')) {
        return true;
      }

      if (fullPath === 'skills') {
        return allowedSkillNames.size > 0;
      }

      const segments = fullPath.split('/');
      if (segments[0] !== 'skills') {
        return true;
      }

      const skillName = segments[1];
      return typeof skillName === 'string' && allowedSkillNames.has(skillName);
    });
  }

  private formatFetchError(url: string, error: unknown, action: string) {
    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    })();

    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return `${action}超时：${hostname}`;
    }

    const causeCode = readCauseCode(error);
    if (causeCode === 'UND_ERR_CONNECT_TIMEOUT') {
      return `${action}超时：${hostname}`;
    }
    if (causeCode === 'ECONNREFUSED') {
      return `${action}被拒绝：${hostname}`;
    }
    if (causeCode === 'ENOTFOUND') {
      return `${action}失败：无法解析域名 ${hostname}`;
    }

    if (error instanceof Error && error.message && error.message !== 'fetch failed') {
      return `${action}失败：${error.message}`;
    }

    return `${action}失败：${hostname}`;
  }

  private async fetchText(url: string, action: string, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
    const requestInit = {
      signal: AbortSignal.timeout(TOOL_TIMEOUT_MS),
      headers: {
        'user-agent': BROWSER_USER_AGENT,
        accept,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    } satisfies RequestInit;

    let response: Response;
    try {
      response = await fetch(url, requestInit);
    } catch (error) {
      const hostname = new URL(url).hostname;
      if (shouldRetryWithIpv4(error) && await hostHasDualStackAddresses(hostname)) {
        const previousOrder = networkResolver.getDefaultResultOrder();
        try {
          networkResolver.setDefaultResultOrder('ipv4first');
          response = await fetch(url, requestInit);
        } catch (retryError) {
          throw new Error(this.formatFetchError(url, retryError, action));
        } finally {
          networkResolver.setDefaultResultOrder(previousOrder);
        }
      } else {
        throw new Error(this.formatFetchError(url, error, action));
      }
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${action}失败：HTTP ${response.status} ${body.slice(0, 160)}`.trim());
    }

    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? '',
      finalUrl: response.url,
    };
  }

  private parseBingSearchResults(html: string, maxResults: number) {
    const blocks = [...html.matchAll(/<li class="b_algo"[\s\S]*?<\/li>/g)];
    const results: SearchResult[] = [];

    for (const block of blocks) {
      const content = block[0];
      const heading = content.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
      const href = heading?.[1];
      const title = stripTags(heading?.[2] ?? '');
      if (!href || !title) {
        continue;
      }

      const url = decodeHtmlEntities(href);
      if (!/^https?:\/\//i.test(url)) {
        continue;
      }

      const snippet = stripTags(
        content.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]
        ?? content.match(/<p[^>]*class="b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i)?.[1]
        ?? '',
      );

      results.push({
        title,
        url,
        snippet,
      });

      if (results.length >= maxResults) {
        break;
      }
    }

    return results;
  }

  private parseDuckDuckGoSearchResults(html: string, maxResults: number) {
    const titles = [...html.matchAll(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/class="result__snippet" href="[^"]+"[^>]*>([\s\S]*?)<\/a>/g)];
    const results: SearchResult[] = [];

    for (let index = 0; index < Math.min(maxResults, titles.length); index += 1) {
      const href = titles[index]?.[1];
      const title = stripTags(titles[index]?.[2] ?? '');
      if (!href || !title) {
        continue;
      }

      const url = resolveDuckDuckGoUrl(href);
      if (!/^https?:\/\//i.test(url)) {
        continue;
      }

      results.push({
        title,
        url,
        snippet: stripTags(snippets[index]?.[1] ?? ''),
      });
    }

    return results;
  }

  private async searchWithProviders(query: string, maxResults: number) {
    const attempts: string[] = [];
    const providers = [
      {
        name: 'Bing',
        url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-Hans`,
        parse: (html: string) => this.parseBingSearchResults(html, maxResults),
      },
      {
        name: 'DuckDuckGo',
        url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        parse: (html: string) => this.parseDuckDuckGoSearchResults(html, maxResults),
      },
    ];

    for (const provider of providers) {
      try {
        const response = await this.fetchText(provider.url, `访问 ${provider.name} 搜索`);
        const parsed = provider.parse(response.body).map<SearchMatch>((result) => ({
          ...result,
          query,
          provider: provider.name,
        }));
        if (parsed.length > 0) {
          return {
            query,
            results: parsed,
            attempts,
          };
        }
        attempts.push(`${provider.name} 对“${query}”未返回可解析结果`);
      } catch (error) {
        attempts.push(error instanceof Error ? `${error.message}（查询：${query}）` : `${provider.name} 搜索失败（查询：${query}）`);
      }
    }

    return {
      query,
      results: [] as SearchMatch[],
      attempts,
    };
  }

  private async fetchSearchResultPage(result: SearchMatch, maxChars: number): Promise<SearchPageAnalysis> {
    try {
      const url = assertPublicHttpUrl(result.url);
      const response = await this.fetchText(url.toString(), '抓取搜索结果页');
      const excerpt = response.contentType.includes('text/html')
        ? extractHtmlExcerpt(response.body, maxChars)
        : truncate(normalizeWhitespace(response.body), maxChars);

      return {
        ...result,
        finalUrl: response.finalUrl || url.toString(),
        excerpt,
      };
    } catch (error) {
      return {
        ...result,
        fetchError: error instanceof Error ? error.message : '抓取搜索结果页失败',
      };
    }
  }

  private describeNativeWebSearchAction(action: NativeWebSearchAction, index: number) {
    if (action.type === 'search') {
      const queries = Array.isArray(action.queries) && action.queries.length > 0
        ? action.queries
        : action.query
          ? [action.query]
          : [];
      return `${index + 1}. Search\n${queries.map((query, queryIndex) => `  ${queryIndex + 1}. ${query}`).join('\n')}`;
    }

    if (action.type === 'open_page') {
      return `${index + 1}. OpenPage\n  URL: ${action.url ?? '未提供'}`;
    }

    if (action.type === 'find_in_page') {
      return `${index + 1}. FindInPage\n  Pattern: ${action.pattern ?? '未提供'}\n  URL: ${action.url ?? '未提供'}`;
    }

    return `${index + 1}. ${action.type ?? 'Other'}\n  详情: ${JSON.stringify(action, null, 2)}`;
  }

  private async executeNativeWebSearch(input: z.infer<typeof webSearchSchema>): Promise<ExecutedAssistantToolResult> {
    if (!this.config.OPENAI_API_KEY) {
      throw new Error('OpenAI API key is not configured');
    }

    const suggestedQueries = buildSearchQueries(input.query);
    const instructions = [
      '你是 SkillChat 的联网搜索执行器。',
      '必须先调用 web_search，再给出中文结论。',
      '优先使用最新公开网页信息；如果问题涉及专业、院校、就业、薪资、政策、排名或分数线，优先权威与官方来源。',
      '不要说自己不能联网。',
      '最终输出格式：先给出简洁结论摘要，再列出来源链接，每行一个。',
      `原始问题：${input.query}`,
      suggestedQueries.length > 0
        ? `建议检索词（可按需组合、改写或扩展）：\n${suggestedQueries.map((query, index) => `${index + 1}. ${query}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');

    for (let attempt = 0; attempt < API_RETRY_LIMIT; attempt += 1) {
      try {
        const searchActions: NativeWebSearchAction[] = [];
        let finalText = '';

        for await (const event of streamOpenAIResponsesEvents({
          apiKey: this.config.OPENAI_API_KEY,
          baseUrl: this.config.OPENAI_BASE_URL,
          timeoutMs: Math.max(this.config.LLM_REQUEST_TIMEOUT_MS, NATIVE_WEB_SEARCH_TIMEOUT_MS),
          body: {
            model: this.config.OPENAI_MODEL,
            instructions,
            input: [
              {
                role: 'user',
                content: input.query,
              },
            ],
            tool_choice: 'required',
            tools: [
              {
                type: 'web_search',
              },
            ],
            max_output_tokens: this.config.TOOL_MAX_OUTPUT_TOKENS,
            text: {
              format: {
                type: 'text',
              },
              verbosity: 'medium',
            },
          },
        })) {
          if (event.event === 'response.output_text.delta' && isOpenAIResponsesRecord(event.data) && typeof event.data.delta === 'string') {
            finalText += event.data.delta;
            continue;
          }

          if (event.event !== 'response.output_item.done' || !isOpenAIResponsesRecord(event.data)) {
            continue;
          }

          const item = isOpenAIResponsesRecord(event.data.item) ? event.data.item : null;
          if (!item || item.type !== 'web_search_call' || !isOpenAIResponsesRecord(item.action)) {
            continue;
          }

          searchActions.push({
            type: typeof item.action.type === 'string' ? item.action.type : undefined,
            query: typeof item.action.query === 'string' ? item.action.query : undefined,
            queries: Array.isArray(item.action.queries)
              ? item.action.queries.filter((query): query is string => typeof query === 'string')
              : undefined,
            url: typeof item.action.url === 'string' ? item.action.url : undefined,
            pattern: typeof item.action.pattern === 'string' ? item.action.pattern : undefined,
          });
        }

        const normalizedText = normalizeWhitespace(finalText);
        if (!normalizedText) {
          throw new Error('OpenAI 原生 web_search 未返回可用结果');
        }

        const actionSection = searchActions.length > 0
          ? searchActions.map((action, index) => this.describeNativeWebSearchAction(action, index)).join('\n')
          : 'provider 未暴露可见的搜索动作细节';

        return {
          tool: 'web_search',
          arguments: input,
          summary: `已通过 OpenAI 原生 web_search 完成联网检索${searchActions.length > 0 ? `（${searchActions.length} 个搜索动作）` : ''}`,
          content: [
            `原始问题：${input.query}`,
            `执行方式：OpenAI Responses API 原生 web_search`,
            `模型：${this.config.OPENAI_MODEL}`,
            suggestedQueries.length > 0
              ? `建议检索词：\n${suggestedQueries.map((query, index) => `${index + 1}. ${query}`).join('\n')}`
              : '',
            `搜索动作：\n${actionSection}`,
            `联网搜索总结：\n${normalizedText}`,
          ].filter(Boolean).join('\n\n'),
          context: [
            '以下搜索信息仅供内部参考，用于组织结论；不要向用户原样复述，不要输出“引用资料”“工具结果”“上下文”等标签。',
            `原始问题：${input.query}`,
            `OpenAI 原生 web_search 动作：\n${actionSection}`,
            `联网搜索总结：\n${normalizedText}`,
          ].join('\n\n'),
        };
      } catch (error) {
        const shouldRetry = attempt < API_RETRY_LIMIT - 1;
        if (!shouldRetry) {
          throw error;
        }
        const retryDelayMs = this.config.NODE_ENV === 'test' ? 0 : API_RETRY_DELAY_MS * (attempt + 1);
        await wait(retryDelayMs);
      }
    }

    throw new Error('OpenAI 原生 web_search 未返回可用结果');
  }

  private async executeLegacyWebSearch(input: z.infer<typeof webSearchSchema>, reason?: Error): Promise<ExecutedAssistantToolResult> {
    const searchQueries = buildSearchQueries(input.query);
    const searchBatches = await Promise.all(searchQueries.map((query) => this.searchWithProviders(query, input.maxResults)));
    const attempts = searchBatches.flatMap((batch) => batch.attempts);

    const dedupedResults: SearchMatch[] = [];
    const seenUrls = new Set<string>();
    for (const result of searchBatches.flatMap((batch) => batch.results)) {
      const key = canonicalizeUrl(result.url);
      if (seenUrls.has(key)) {
        continue;
      }
      seenUrls.add(key);
      dedupedResults.push(result);
      if (dedupedResults.length >= Math.min(SEARCH_RESULT_LIMIT, input.maxResults + 3)) {
        break;
      }
    }

    if (dedupedResults.length === 0) {
      throw new Error(`网页搜索失败：${attempts.join('；')}`);
    }

    const pageCandidates = dedupedResults.slice(0, Math.min(SEARCH_FETCH_LIMIT, dedupedResults.length));
    const pageAnalyses = await Promise.all(pageCandidates.map((result) => this.fetchSearchResultPage(result, SEARCH_PAGE_EXCERPT_CHARS)));
    const pageAnalysisMap = new Map<string, SearchPageAnalysis>();
    for (const analysis of pageAnalyses) {
      pageAnalysisMap.set(canonicalizeUrl(analysis.url), analysis);
      if (analysis.finalUrl) {
        pageAnalysisMap.set(canonicalizeUrl(analysis.finalUrl), analysis);
      }
    }

    const resultSections = dedupedResults.map((result, index) => {
      const analysis = pageAnalysisMap.get(canonicalizeUrl(result.url));
      return [
        `${index + 1}. ${result.title}`,
        `命中查询: ${result.query}`,
        `搜索引擎: ${result.provider}`,
        `URL: ${result.url}`,
        result.snippet ? `搜索摘要: ${result.snippet}` : '',
        analysis?.finalUrl && analysis.finalUrl !== result.url ? `最终地址: ${analysis.finalUrl}` : '',
        analysis?.excerpt ? `结果页分析:\n${analysis.excerpt}` : '',
        analysis?.fetchError ? `结果页抓取失败: ${analysis.fetchError}` : '',
      ].filter(Boolean).join('\n');
    });

    const modelContextSections = dedupedResults
      .slice(0, Math.min(SEARCH_FETCH_LIMIT, dedupedResults.length))
      .map((result, index) => {
        const analysis = pageAnalysisMap.get(canonicalizeUrl(result.url));
        return [
          `${index + 1}. ${result.title}`,
          `命中查询: ${result.query}`,
          `链接: ${analysis?.finalUrl || result.url}`,
          result.snippet ? `搜索摘要: ${truncate(result.snippet, 220)}` : '',
          analysis?.excerpt ? `页面关键信息: ${truncate(analysis.excerpt, MODEL_CONTEXT_EXCERPT_CHARS)}` : '',
        ].filter(Boolean).join('\n');
      });

    const successFetchCount = pageAnalyses.filter((analysis) => Boolean(analysis.excerpt)).length;
    const degradeNote = reason ? `OpenAI 原生 web_search 不可用，已退回本地搜索：${reason.message}` : '';
    const content = [
      `原始问题：${input.query}`,
      degradeNote,
      `搜索关键词组合：\n${searchQueries.map((query, index) => `${index + 1}. ${query}`).join('\n')}`,
      `分查询命中情况：\n${searchBatches.map((batch, index) => `${index + 1}. ${batch.query} -> ${batch.results.length} 条`).join('\n')}`,
      `搜索命中结果（去重后 ${dedupedResults.length} 条）：`,
      ...resultSections,
      attempts.length > 0 ? `搜索备注：\n${attempts.map((item) => `- ${item}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n');

    return {
      tool: 'web_search',
      arguments: input,
      summary: `${reason ? '原生搜索失败，已退回本地搜索；' : ''}检索到 ${dedupedResults.length} 条去重结果，已抓取 ${successFetchCount} 个结果页`,
      content,
      context: [
        '以下搜索信息仅供内部参考，用于组织结论；不要向用户原样复述，不要输出“引用资料”“工具结果”“上下文”等标签。',
        reason ? `OpenAI 原生 web_search 不可用：${reason.message}` : '',
        `原始问题：${input.query}`,
        `使用的查询组合：${searchQueries.join('；')}`,
        ...modelContextSections,
      ].filter(Boolean).join('\n\n'),
    };
  }

  private async executeWebSearch(rawArguments: Record<string, unknown>): Promise<ExecutedAssistantToolResult> {
    const input = webSearchSchema.parse(rawArguments);
    try {
      return await this.executeNativeWebSearch(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      throw new Error(`原生联网搜索失败：${message}`);
    }
  }

  private async executeWebFetch(rawArguments: Record<string, unknown>): Promise<ExecutedAssistantToolResult> {
    const input = webFetchSchema.parse(rawArguments);
    const url = assertPublicHttpUrl(input.url);
    const response = await this.fetchText(url.toString(), '访问网页');
    const excerpt = response.contentType.includes('text/html')
      ? extractHtmlExcerpt(response.body, input.maxChars)
      : normalizeWhitespace(response.body).slice(0, input.maxChars);

    return {
      tool: 'web_fetch',
      arguments: input,
      summary: `已抓取网页 ${url.hostname}`,
      content: [
        `网页地址：${response.finalUrl || url.toString()}`,
        `网页正文预览：\n${excerpt}`,
      ].join('\n\n'),
    };
  }

  private async executeListFiles(
    userId: string,
    sessionId: string,
    rawArguments: Record<string, unknown>,
  ): Promise<ExecutedAssistantToolResult> {
    const input = listFilesSchema.parse(rawArguments);
    const files = this.fileService.getFileContext(userId, sessionId)
      .filter((file) => input.bucket === 'all' || file.bucket === input.bucket);

    return {
      tool: 'list_files',
      arguments: input,
      summary: `当前可用文件 ${files.length} 个`,
      content: files.length > 0
        ? `当前会话可用文件如下：\n${formatFileList(files)}`
        : '当前会话没有可读取的文件。',
      context: files.length > 0 ? formatFileList(files) : '当前会话没有可读取的文件。',
    };
  }

  private async executeReadFile(
    userId: string,
    sessionId: string,
    rawArguments: Record<string, unknown>,
  ): Promise<ExecutedAssistantToolResult> {
    const input = readFileSchema.parse(rawArguments);
    const files = this.fileService.getFileContext(userId, sessionId);

    let target = input.fileId
      ? files.find((file) => file.id === input.fileId)
      : undefined;

    if (!target && input.fileName) {
      const matches = findFilesByName(files, input.fileName);
      if (matches.length > 1) {
        return {
          tool: 'read_file',
          arguments: input,
          summary: `匹配到 ${matches.length} 个候选文件`,
          content: `文件名不够明确，请改用 fileId。候选文件如下：\n${formatFileList(matches)}`,
        };
      }
      target = matches[0];
    }

    if (!target) {
      return {
        tool: 'read_file',
        arguments: input,
        summary: '未找到目标文件',
        content: '没有找到符合条件的文件，请先调用 list_files 查看当前会话里的文件。',
      };
    }

    const userRoot = getUserRoot(this.config, userId);
    const absolutePath = resolveUserPath(this.config, userId, target.relativePath);
    assertPathInside(userRoot, absolutePath);
    const fileStat = await fs.stat(absolutePath);

    if (!isTextLikePath(target.name, target.mimeType)) {
      return {
        tool: 'read_file',
        arguments: input,
        summary: `文件 ${target.name} 不支持直接文本读取`,
        content: [
          `文件名：${target.name}`,
          `文件 id：${target.id}`,
          `mimeType：${target.mimeType ?? 'application/octet-stream'}`,
          `大小：${fileStat.size}`,
          '当前只支持直接读取文本类文件；二进制文件可先转换为文本或让系统基于文件元数据继续处理。',
        ].join('\n'),
      };
    }

    const slice = await readTextSlice({
      filePath: absolutePath,
      startLine: input.startLine,
      endLine: input.endLine,
      maxChars: input.maxChars,
    });

    return {
      tool: 'read_file',
      arguments: input,
      summary: `已读取文件 ${target.name}${slice.range ? `（${slice.range.startLine}-${slice.range.endLine} 行）` : ''}`,
      content: [
        `文件名：${target.name}`,
        `文件 id：${target.id}`,
        `相对路径：${target.relativePath}`,
        slice.range ? `行范围：${slice.range.startLine}-${slice.range.endLine}` : '',
        slice.truncated ? '说明：内容过长，已截断显示' : '',
        '文件内容：',
        slice.excerpt,
      ].filter(Boolean).join('\n\n'),
      context: slice.excerpt,
    };
  }

  private async executeListWorkspacePaths(
    userId: string,
    sessionId: string,
    rawArguments: Record<string, unknown>,
    availableSkills: RegisteredSkill[],
    skill?: RegisteredSkill,
  ): Promise<ExecutedAssistantToolResult> {
    const input = listWorkspacePathsSchema.parse(rawArguments);
    this.assertWorkspaceSkillPathAccess(input.root as WorkspaceRootName, input.path, availableSkills);
    const descriptor = resolveWorkspaceRoot({
      config: this.config,
      userId,
      sessionId,
      root: input.root as WorkspaceRootName,
      skill,
    });
    const listed = await listWorkspaceEntries({
      descriptor,
      requestedPath: input.path,
      depth: input.depth,
      offset: input.offset,
      limit: input.limit,
    });
    const visibleEntries = input.root === 'workspace'
      ? this.filterWorkspaceEntriesForSkillScope(input.path, listed.entries, availableSkills)
      : listed.entries;

    return {
      tool: 'list_workspace_paths',
      arguments: input,
      summary: `${descriptor.label} 命中 ${visibleEntries.length} 项${listed.hasMore ? '（已分页）' : ''}`,
      content: [
        `根目录：${descriptor.label}`,
        `根路径：${descriptor.absoluteRoot}`,
        input.path ? `子路径：${input.path}` : '',
        `总条目：${input.root === 'workspace' ? visibleEntries.length : listed.total}`,
        listed.hasMore ? `分页：offset=${input.offset}, limit=${input.limit}` : '',
        visibleEntries.length > 0 ? `目录内容：\n${formatListedWorkspaceEntries(visibleEntries)}` : '目录为空。',
      ].filter(Boolean).join('\n\n'),
      context: visibleEntries.map((entry) => `${entry.kind}:${entry.relativePath}`).join('\n'),
    };
  }

  private async executeReadWorkspacePathSlice(
    userId: string,
    sessionId: string,
    rawArguments: Record<string, unknown>,
    availableSkills: RegisteredSkill[],
    skill?: RegisteredSkill,
  ): Promise<ExecutedAssistantToolResult> {
    const input = readWorkspacePathSliceSchema.parse(rawArguments);
    this.assertWorkspaceSkillPathAccess(input.root as WorkspaceRootName, input.path, availableSkills);
    const descriptor = resolveWorkspaceRoot({
      config: this.config,
      userId,
      sessionId,
      root: input.root as WorkspaceRootName,
      skill,
    });
    const absolutePath = resolveWorkspacePath(descriptor, input.path);
    const stat = await fs.stat(absolutePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        throw new Error(`路径不存在：${input.path}`);
      }
      throw error;
    });

    if (stat.isDirectory()) {
      return {
        tool: 'read_workspace_path_slice',
        arguments: input,
        summary: '目标路径是目录，无法直接读取',
        content: `目标 ${input.path} 是目录，请先用 list_workspace_paths 查看其下内容。`,
      };
    }

    if (!isTextLikePath(absolutePath)) {
      return {
        tool: 'read_workspace_path_slice',
        arguments: input,
        summary: `文件 ${input.path} 不支持直接文本读取`,
        content: `路径 ${input.path} 不是可直接读取的文本文件，请改为读取文本类文件或通过 Skill 处理。`,
      };
    }

    const slice = await readTextSlice({
      filePath: absolutePath,
      startLine: input.startLine,
      endLine: input.endLine,
      maxChars: input.maxChars,
    });

    return {
      tool: 'read_workspace_path_slice',
      arguments: input,
      summary: `已读取 ${descriptor.label} / ${input.path}${slice.range ? `（${slice.range.startLine}-${slice.range.endLine} 行）` : ''}`,
      content: [
        `根目录：${descriptor.label}`,
        `路径：${input.path}`,
        `可见路径：${resolveUserVisiblePath(this.config, userId, absolutePath)}`,
        slice.range ? `行范围：${slice.range.startLine}-${slice.range.endLine}` : '',
        slice.truncated ? '说明：内容过长，已截断显示' : '',
        '文件内容：',
        slice.excerpt,
      ].filter(Boolean).join('\n\n'),
      context: slice.excerpt,
    };
  }

  private async executeListSkillResources(
    rawArguments: Record<string, unknown>,
    availableSkills: RegisteredSkill[],
    activeSkill?: RegisteredSkill,
  ): Promise<ExecutedAssistantToolResult> {
    const input = listSkillResourcesSchema.parse(rawArguments);
    const skill = this.resolveTargetSkill(availableSkills, activeSkill, input.skillName);
    const references = skill.referencesContent.map((item) => item.name);

    return {
      tool: 'list_skill_resources',
      arguments: input,
      summary: `${skill.name} 共有 ${references.length + 1} 个可读资源`,
      content: [
        `技能：${skill.name}`,
        '资源列表：',
        '- SKILL.md',
        ...references.map((name) => `- references/${name}`),
      ].join('\n'),
      context: [
        `skill:${skill.name}`,
        'resource:SKILL.md',
        ...references.map((name) => `resource:references/${name}`),
      ].join('\n'),
    };
  }

  private async executeReadSkillResourceSlice(
    rawArguments: Record<string, unknown>,
    availableSkills: RegisteredSkill[],
    activeSkill?: RegisteredSkill,
  ): Promise<ExecutedAssistantToolResult> {
    const input = readSkillResourceSliceSchema.parse(rawArguments);
    const skill = this.resolveTargetSkill(availableSkills, activeSkill, input.skillName);
    const resource = input.resource === 'SKILL.md' ? 'SKILL.md' : input.resource.replace(/^references\//, '');

    if (resource === 'SKILL.md') {
      const excerpt = truncate(skill.markdown, input.maxChars);
      return {
        tool: 'read_skill_resource_slice',
        arguments: input,
        summary: `已读取 ${skill.name} / SKILL.md`,
        content: [
          `技能：${skill.name}`,
          '路径：SKILL.md',
          skill.markdown.length > input.maxChars ? '说明：内容过长，已截断显示' : '',
          '内容：',
          excerpt,
        ].filter(Boolean).join('\n\n'),
        context: excerpt,
      };
    }

    const reference = skill.referencesContent.find((item) => item.name === resource);
    if (!reference) {
      throw new Error(`Skill ${skill.name} 中不存在资源：${input.resource}`);
    }

    const excerpt = truncate(reference.content, input.maxChars);
    return {
      tool: 'read_skill_resource_slice',
      arguments: input,
      summary: `已读取 ${skill.name} / references/${reference.name}`,
      content: [
        `技能：${skill.name}`,
        `路径：references/${reference.name}`,
        reference.content.length > input.maxChars ? '说明：内容过长，已截断显示' : '',
        '内容：',
        excerpt,
      ].filter(Boolean).join('\n\n'),
      context: excerpt,
    };
  }

  private async executeWriteArtifactFile(
    userId: string,
    sessionId: string,
    rawArguments: Record<string, unknown>,
  ): Promise<ExecutedAssistantToolResult> {
    const input = writeArtifactFileSchema.parse(rawArguments);
    const fileName = sanitizeFilename(input.fileName);
    const absolutePath = await ensureArtifactPath(this.config, userId, sessionId, fileName, input.subdir);
    await fs.writeFile(absolutePath, input.content, 'utf8');

    const fileRecord = await this.fileService.recordGeneratedFile({
      userId,
      sessionId,
      absolutePath,
      displayName: fileName,
    });

    return {
      tool: 'write_artifact_file',
      arguments: {
        ...input,
        fileName,
      },
      summary: `已写入产物 ${fileRecord.displayName}`,
      content: [
        `文件名：${fileRecord.displayName}`,
        `相对路径：${fileRecord.relativePath}`,
        `下载地址：${fileRecord.downloadUrl}`,
        '写入内容预览：',
        truncate(input.content, 2_000),
      ].join('\n\n'),
      context: `artifact:${fileRecord.displayName}\npath:${fileRecord.relativePath}`,
      artifacts: [fileRecord],
    };
  }
}
