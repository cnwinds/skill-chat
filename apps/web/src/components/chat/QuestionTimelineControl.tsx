import { useMemo, useState } from 'react';
import { MessageCircleQuestionMark, Search } from 'lucide-react';
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
}: QuestionTimelineControlProps) => {
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
      <div className="border-b border-border px-3 py-3">
        <label className="relative block">
          <span className="sr-only">搜索提问内容</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索提问内容"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm text-foreground outline-none placeholder:text-foreground-muted focus:border-accent"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filteredQuestions.length > 0 ? (
          <div className="relative flex flex-col gap-1 before:absolute before:bottom-2 before:left-[1.15rem] before:top-2 before:w-px before:bg-border">
            {filteredQuestions.map((question) => {
              const isActive = question.id === activeQuestionId;
              return (
                <button
                  key={question.id}
                  type="button"
                  onClick={() => onSelectQuestion(question.id)}
                  className={cn(
                    'relative flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    isActive && 'bg-accent/10',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border bg-surface text-2xs font-medium',
                      isActive
                        ? 'border-accent text-accent'
                        : 'border-border text-foreground-muted',
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
    if (!isDesktop) {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={`切换问题定位列表，共 ${questions.length} 个提问`}
        className={cn(
          'absolute right-4 z-40 inline-flex h-9 min-w-14 items-center justify-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 text-xs font-medium text-foreground shadow-md backdrop-blur transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          open && 'border-accent bg-surface-hover',
          'bottom-4 lg:bottom-auto lg:top-4',
        )}
      >
        <MessageCircleQuestionMark className="h-3.5 w-3.5" />
        <span>{questions.length}</span>
      </button>

      {open ? (
        <aside
          className={cn(
            'absolute z-30 flex overflow-hidden rounded-2xl border border-border bg-surface shadow-lg',
            'inset-x-3 bottom-16 max-h-[58dvh] flex-col lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-14 lg:max-h-none lg:w-[min(360px,calc(100%-2rem))]',
          )}
        >
          <QuestionTimelineList
            questions={questions}
            activeQuestionId={activeQuestionId}
            onSelectQuestion={handleSelectQuestion}
          />
        </aside>
      ) : null}
    </>
  );
};

export default QuestionTimelineControl;
