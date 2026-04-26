import { useMemo, useState } from 'react';
import { List, Search } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
      <div className="border-b border-border px-3 pb-3">
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
        onClick={() => setOpen(true)}
        aria-label={`打开问题时间线，共 ${questions.length} 个提问`}
        className={cn(
          'absolute right-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/95 px-3 py-2 text-xs text-foreground shadow-md backdrop-blur transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          'bottom-4 lg:bottom-auto lg:top-4',
        )}
      >
        <List className="h-3.5 w-3.5" />
        <span>问题 {questions.length}</span>
      </button>

      {isDesktop ? (
        open ? (
          <aside className="absolute bottom-4 right-4 top-14 z-30 hidden w-[min(360px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-border bg-surface shadow-lg lg:flex lg:flex-col">
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm font-semibold">问题时间线</div>
                <div className="text-2xs text-foreground-muted">
                  点击任意提问定位到原位置
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-2xs text-foreground-muted hover:bg-surface-hover hover:text-foreground"
              >
                收起
              </button>
            </div>
            <QuestionTimelineList
              questions={questions}
              activeQuestionId={activeQuestionId}
              onSelectQuestion={handleSelectQuestion}
            />
          </aside>
        ) : null
      ) : (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[72dvh] rounded-t-2xl p-0"
            showClose
          >
            <SheetHeader className="pb-2">
              <SheetTitle>问题时间线</SheetTitle>
              <SheetDescription>快速浏览提问，点击后回到聊天位置。</SheetDescription>
            </SheetHeader>
            <QuestionTimelineList
              questions={questions}
              activeQuestionId={activeQuestionId}
              onSelectQuestion={handleSelectQuestion}
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
};

export default QuestionTimelineControl;
