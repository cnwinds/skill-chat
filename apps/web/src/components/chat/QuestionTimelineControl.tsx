import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

export type QuestionTimelineEntry = {
  id: string;
  index: number;
  content: string;
  createdAt: string;
};

export interface QuestionTimelineControlProps {
  questions: QuestionTimelineEntry[];
  activeQuestionId: string | null;
  onSelectQuestion: (questionId: string) => void;
}

// Matches docs/prompt-explorer-prototype.html.
const DURATION = 'duration-[260ms]';
const CONTENT_DURATION = 'duration-[180ms]';
const EASING = 'ease-[cubic-bezier(0.22,1,0.36,1)]';
const PANEL_WIDTH = 'w-[min(440px,calc(100vw-2rem))]';

const truncateQuestion = (content: string) => {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 72) {
    return normalized;
  }
  return `${normalized.slice(0, 72)}...`;
};

const formatQuestionTime = (createdAt: string) => {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const QuestionTimelineList = ({
  questions,
  activeQuestionId,
  onSelectQuestion,
  open,
}: QuestionTimelineControlProps & { open: boolean }) => {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredQuestions = useMemo(
    () =>
      normalizedQuery
        ? questions.filter((question) => question.content.toLowerCase().includes(normalizedQuery))
        : questions,
    [normalizedQuery, questions],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="py-3.5 pl-3.5 pr-[62px]">
        <label
          className={cn(
            'relative block transition-opacity motion-reduce:transition-none',
            CONTENT_DURATION,
            EASING,
            open ? 'opacity-100 delay-100' : 'opacity-0 delay-0',
          )}
        >
          <span className="sr-only">搜索提问内容</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索提问内容"
            className="h-10 w-full rounded-[10px] border-0 bg-surface-hover pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-foreground-muted focus:ring-2 focus:ring-accent"
          />
        </label>
      </div>
      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-1.5 transition-opacity motion-reduce:transition-none',
          CONTENT_DURATION,
          EASING,
          open ? 'opacity-100 delay-100' : 'opacity-0 delay-0',
        )}
      >
        {filteredQuestions.length > 0 ? (
          <div className="flex flex-col">
            {filteredQuestions.map((question) => {
              const isActive = question.id === activeQuestionId;
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => onSelectQuestion(question.id)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-md px-0 py-2.5 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isActive && 'bg-accent/10',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 w-4 shrink-0 text-sm tabular-nums text-foreground-muted',
                      isActive && 'text-accent',
                    )}
                  >
                    {question.index}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-5 text-foreground">
                      {truncateQuestion(question.content)}
                    </span>
                    <span className="mt-0.5 block text-2xs text-foreground-muted">
                      {formatQuestionTime(question.createdAt)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-3 py-8 text-center text-sm text-foreground-muted">
            没有匹配的提问
          </div>
        )}
      </div>
    </div>
  );
};

export const QuestionTimelineControl = ({
  questions,
  activeQuestionId,
  onSelectQuestion,
}: QuestionTimelineControlProps) => {
  const [open, setOpen] = useState(false);
  const isDesktop = useIsDesktop();

  if (questions.length < 2) {
    return null;
  }

  const handleSelectQuestion = (questionId: string) => {
    onSelectQuestion(questionId);
    // On narrow viewports the panel covers most of the chat surface, so close
    // it after a selection lets the user see the result. On desktop the panel
    // sits beside the chat content and can stay open for browsing.
    if (!isDesktop) {
      setOpen(false);
    }
  };

  return (
    <div className="absolute bottom-6 right-6 top-6 z-30 w-0">
      <aside
        aria-label={`问题定位列表，共 ${questions.length} 个提问`}
        aria-hidden={!open}
        // React 19 supports `inert` as a boolean attribute.
        inert={!open}
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-lg',
          'transition-[width,opacity] motion-reduce:transition-none',
          DURATION,
          EASING,
          open ? `${PANEL_WIDTH} opacity-100` : 'pointer-events-none w-0 opacity-0',
        )}
      >
        <QuestionTimelineList
          questions={questions}
          activeQuestionId={activeQuestionId}
          onSelectQuestion={handleSelectQuestion}
          open={open}
        />
      </aside>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`切换问题定位列表，共 ${questions.length} 个提问`}
        className={cn(
          'absolute right-[14px] top-[14px] z-40 flex h-10 w-10 items-center justify-center rounded-full border text-foreground shadow-md backdrop-blur',
          'transition-[background-color,border-color] hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          DURATION,
          EASING,
          open ? 'border-border-strong bg-surface-hover' : 'border-border bg-surface/95',
        )}
      >
        <span className="relative block h-full w-full">
          {/* Count: visible when closed; rotates out and shrinks when opening. */}
          <span
            aria-hidden={open}
            className={cn(
              'absolute inset-0 flex items-center justify-center text-sm font-semibold tabular-nums',
              'transition-[transform,opacity] motion-reduce:transition-none',
              DURATION,
              EASING,
              open
                ? 'rotate-90 scale-50 opacity-0'
                : 'rotate-0 scale-100 opacity-100',
            )}
          >
            {questions.length}
          </span>
          {/* Close glyph: visible when open; rotates in from -90°. */}
          <span
            aria-hidden={!open}
            className={cn(
              'absolute inset-0 flex items-center justify-center',
              'transition-[transform,opacity] motion-reduce:transition-none',
              DURATION,
              EASING,
              open
                ? 'rotate-0 scale-100 opacity-100'
                : '-rotate-90 scale-50 opacity-0',
            )}
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </span>
        </span>
      </button>
    </div>
  );
};

export default QuestionTimelineControl;
