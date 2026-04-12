import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { FileRecord, StoredEvent } from '@skillchat/shared';
import { cn, formatBytes } from '../lib/utils';
import type { ToolTraceDisplayEvent } from '../lib/timeline';

type Props = {
  event:
    | StoredEvent
    | ToolTraceDisplayEvent
    | { kind: 'pending_text'; content: string };
  onDownload?: (file: FileRecord) => void;
  downloading?: boolean;
  canExpandToolTrace?: boolean;
};

const formatSkillPathLabel = (path: string) => {
  const normalizedPath = path.replace(/\\/g, '/');
  const skillMatch = normalizedPath.match(/^skills\/([^/]+)\/SKILL\.md$/i);
  if (skillMatch) {
    return `${skillMatch[1]} / SKILL.md`;
  }

  const referenceMatch = normalizedPath.match(/^skills\/([^/]+)\/references\/(.+)$/i);
  if (referenceMatch) {
    return `${referenceMatch[1]} / references/${referenceMatch[2]}`;
  }

  return normalizedPath;
};

const formatToolName = (tool: string, args?: Record<string, unknown>) => {
  if (tool !== 'read_workspace_path_slice') {
    return tool;
  }

  const path = typeof args?.path === 'string' ? args.path : '';
  if (/\/SKILL\.md$/i.test(path)) {
    return '读取 Skill';
  }
  if (/\/references\//i.test(path)) {
    return '读取参考资料';
  }
  return '读取工作区文件';
};

const formatToolMessage = (tool: string, message: string, args?: Record<string, unknown>) => {
  if (tool !== 'read_workspace_path_slice') {
    return message;
  }

  const path = typeof args?.path === 'string' ? args.path : '';
  if (!path) {
    return message;
  }

  const label = formatSkillPathLabel(path);
  if (/\/SKILL\.md$/i.test(path)) {
    return `已读取 Skill 定义：${label}`;
  }
  if (/\/references\//i.test(path)) {
    return `已读取参考资料：${label}`;
  }
  if (message.startsWith('已读取')) {
    return `已读取工作区文件：${label}`;
  }
  return message;
};

const formatToolArguments = (tool: string, args?: Record<string, unknown>) => {
  if (!args) {
    return '';
  }

  if (tool !== 'read_workspace_path_slice') {
    return JSON.stringify(args, null, 2);
  }

  const formattedArgs = { ...args };
  if (typeof formattedArgs.path === 'string') {
    formattedArgs.path = formatSkillPathLabel(formattedArgs.path);
  }
  return JSON.stringify(formattedArgs, null, 2);
};

const toolStatusLabel: Record<ToolTraceDisplayEvent['status'], string> = {
  queued: '排队中',
  running: '执行中',
  success: '已完成',
  failed: '失败',
};

const getElapsedSeconds = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - created) / 1000));
};

const formatElapsedDuration = (elapsedSeconds: number) => {
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}秒`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}分钟${seconds}秒`;
};

const ThinkingBubble = ({ createdAt, content }: { createdAt: string; content: string }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => getElapsedSeconds(createdAt));
  const elapsedLabel = formatElapsedDuration(elapsedSeconds);

  useEffect(() => {
    setElapsedSeconds(getElapsedSeconds(createdAt));
    const timer = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(createdAt));
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [createdAt]);

  return (
    <article className="message-row assistant">
      <div
        className="message-bubble assistant thinking-inline"
        title={content}
        aria-label={`正在思考，已持续 ${elapsedLabel}`}
      >
        {`正在思考(${elapsedLabel})`}
      </div>
    </article>
  );
};

export const MessageItem = ({ event, onDownload, downloading = false, canExpandToolTrace = true }: Props) => {
  if (event.kind === 'pending_text') {
    return (
      <article className="message-row assistant">
        <div className="message-bubble assistant pending">
          <ReactMarkdown>{event.content}</ReactMarkdown>
        </div>
      </article>
    );
  }

  if (event.kind === 'message') {
    return (
      <article className={cn('message-row', event.role === 'user' ? 'user' : 'assistant')}>
        <div className={cn('message-bubble', event.role === 'user' ? 'user' : 'assistant')}>
          <ReactMarkdown>{event.content}</ReactMarkdown>
        </div>
      </article>
    );
  }

  if (event.kind === 'thinking') {
    return <ThinkingBubble createdAt={event.createdAt} content={event.content} />;
  }

  if (event.kind === 'tool_trace') {
    const displayTool = formatToolName(event.tool, event.arguments);
    const displayMessage = formatToolMessage(event.tool, event.message, event.arguments);
    const displayArguments = formatToolArguments(event.tool, event.arguments);
    const hasDetails = Boolean(
      (event.arguments && Object.keys(event.arguments).length > 0) ||
      event.resultContent ||
      (typeof event.percent === 'number' && event.status === 'running'),
    );

    const summaryContent = (
      <div className="tool-trace-summary">
        <div className="tool-trace-main">
          <strong>{displayTool}</strong>
          <span className={cn('tool-trace-badge', `is-${event.status}`)}>{toolStatusLabel[event.status]}</span>
        </div>
        <div className="tool-trace-message">{displayMessage}</div>
      </div>
    );

    if (!canExpandToolTrace || !hasDetails) {
      return (
        <article className={cn('tool-trace-card', 'is-static', `is-${event.status}`)}>
          <div className="tool-trace-card-static">
            {summaryContent}
          </div>
        </article>
      );
    }

    return (
      <article className={cn('tool-trace-card', `is-${event.status}`)}>
        <details>
          <summary className="tool-trace-summary">
            <div className="tool-trace-main">
              <strong>{displayTool}</strong>
              <span className={cn('tool-trace-badge', `is-${event.status}`)}>{toolStatusLabel[event.status]}</span>
            </div>
            <div className="tool-trace-message">{displayMessage}</div>
          </summary>
          <div className="tool-trace-body">
            {event.arguments && Object.keys(event.arguments).length > 0 ? (
              <div className="tool-trace-section">
                <div className="tool-trace-section-title">参数</div>
                <pre className="status-pre compact">{displayArguments}</pre>
              </div>
            ) : null}
            {event.resultContent ? (
              <div className="tool-trace-section">
                <div className="tool-trace-section-title">返回结果</div>
                <pre className="status-pre compact tool-result-pre">{event.resultContent}</pre>
              </div>
            ) : null}
            {typeof event.percent === 'number' && event.status === 'running' ? (
              <div className="progress-bar compact">
                <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, event.percent))}%` }} />
              </div>
            ) : null}
          </div>
        </details>
      </article>
    );
  }

  if (event.kind === 'tool_call') {
    return (
      <article className="status-card">
        <div className="status-label">工具调用</div>
        <strong>{event.skill}</strong>
        <pre className="status-pre">{JSON.stringify(event.arguments, null, 2)}</pre>
      </article>
    );
  }

  if (event.kind === 'tool_progress') {
    return (
      <article className="status-card accent">
        <div className="status-label">工具进度</div>
        <strong>{event.skill}</strong>
        <div>{event.message}</div>
        {typeof event.percent === 'number' ? (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, event.percent))}%` }} />
          </div>
        ) : null}
      </article>
    );
  }

  if (event.kind === 'tool_result') {
    return (
      <article className="status-card success">
        <div className="status-label">工具结果</div>
        <strong>{event.skill}</strong>
        <div>{event.message}</div>
      </article>
    );
  }

  if (event.kind === 'file') {
    return (
      <article className="file-card">
        <div>
          <div className="file-name">{event.file.displayName}</div>
          <div className="file-meta">
            {event.file.mimeType ?? 'application/octet-stream'} · {formatBytes(event.file.size)}
          </div>
        </div>
        <button type="button" className="subtle-button" onClick={() => onDownload?.(event.file)} disabled={downloading}>
          下载
        </button>
      </article>
    );
  }

  return (
    <article className="status-card danger">
      <div className="status-label">错误</div>
      <div>{event.message}</div>
    </article>
  );
};
