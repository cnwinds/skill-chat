import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent as ReactPointerEvent } from 'react';
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

const DURATION = 'duration-[180ms]';
const EASING = 'ease-[cubic-bezier(0.22,1,0.36,1)]';
const PANEL_WIDTH = 'w-[min(360px,calc(100vw-1rem))]';
const COLLAPSED_WIDTH = 'w-[var(--question-timeline-collapsed-width)]';
const QUESTION_ROW_COLUMNS =
  'grid-cols-[minmax(0,1fr)_var(--question-timeline-tick-slot-width)]';
const ROW_HEIGHT_PX = 36;
const MAX_CONTROL_HEIGHT_PX = 420;
const MIN_CONTROL_HEIGHT_PX = ROW_HEIGHT_PX * 5;
const CONTROL_VERTICAL_MARGIN_PX = 48;
const CONTROL_VERTICAL_PADDING_PX = 4;
const MIN_RAIL_SLOTS = 5;
const MAX_RAIL_SLOTS = 11;

const normalizeQuestion = (content: string) => content.replace(/\s+/g, ' ').trim();

const truncateQuestion = (content: string) => {
  const normalized = normalizeQuestion(content);
  if (normalized.length <= 44) {
    return normalized;
  }
  return `${normalized.slice(0, 44)}...`;
};

const measureScrollbarWidth = () => {
  if (typeof document === 'undefined') {
    return 0;
  }

  const probe = document.createElement('div');
  probe.style.position = 'absolute';
  probe.style.top = '-9999px';
  probe.style.width = '100px';
  probe.style.height = '100px';
  probe.style.overflow = 'scroll';
  probe.style.pointerEvents = 'none';
  probe.style.opacity = '0';
  document.body.appendChild(probe);
  const width = Math.max(0, probe.offsetWidth - probe.clientWidth);
  document.body.removeChild(probe);
  return width;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getViewportStartIndex = <T extends { id: string }>({
  activeId,
  maxSlots,
  questions,
}: {
  activeId: string | null;
  maxSlots: number;
  questions: T[];
}) => {
  const total = questions.length;
  if (total <= maxSlots) {
    return 0;
  }

  const activeIndex = questions.findIndex(
    (question) => activeId !== null && question.id === activeId,
  );
  if (activeIndex < 0) {
    return 0;
  }

  const middleOffset = Math.floor((maxSlots - 1) / 2);
  return clamp(activeIndex - middleOffset, 0, total - maxSlots);
};

export const QuestionTimelineControl = ({
  questions,
  activeQuestionId,
  onSelectQuestion,
}: QuestionTimelineControlProps) => {
  const [open, setOpen] = useState(false);
  const [gestureActive, setGestureActive] = useState(false);
  const [gestureQuestionId, setGestureQuestionId] = useState<string | null>(null);
  const [controlHeightPx, setControlHeightPx] = useState(MAX_CONTROL_HEIGHT_PX);
  const [scrollbarWidthPx, setScrollbarWidthPx] = useState(() => measureScrollbarWidth());
  const [panelScrollState, setPanelScrollState] = useState({
    canScrollDown: false,
    canScrollUp: false,
  });
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const questionRowRefs = useRef(new Map<string, HTMLButtonElement>());
  const gestureRef = useRef<{ pointerId: number; selectedId: string } | null>(null);
  const isDesktop = useIsDesktop();
  const displayQuestions = useMemo(
    () =>
      questions.map((question) => ({
        ...question,
        label:
          truncateQuestion(question.content) ||
          `\u7b2c ${question.index} \u4e2a\u63d0\u95ee`,
      })),
    [questions],
  );
  const visualActiveQuestionId = gestureQuestionId ?? activeQuestionId;
  const railSlots = clamp(
    Math.floor(controlHeightPx / ROW_HEIGHT_PX),
    MIN_RAIL_SLOTS,
    MAX_RAIL_SLOTS,
  );
  const visibleSlotCount = Math.min(displayQuestions.length, railSlots);
  const hasScrollableOverflow = displayQuestions.length > visibleSlotCount;
  const scrollbarCompensationPx = open && hasScrollableOverflow ? scrollbarWidthPx : 0;
  const controlVisibleHeightPx =
    visibleSlotCount * ROW_HEIGHT_PX + CONTROL_VERTICAL_PADDING_PX * 2;
  const panelAlignedFirstIndex = useMemo(
    () =>
      getViewportStartIndex({
        activeId: visualActiveQuestionId,
        maxSlots: visibleSlotCount,
        questions: displayQuestions,
      }),
    [displayQuestions, visibleSlotCount, visualActiveQuestionId],
  );

  useEffect(() => {
    const refreshScrollbarWidth = () => {
      const nextWidth = measureScrollbarWidth();
      setScrollbarWidthPx((current) => (current === nextWidth ? current : nextWidth));
    };

    refreshScrollbarWidth();
    window.addEventListener('resize', refreshScrollbarWidth);
    return () => window.removeEventListener('resize', refreshScrollbarWidth);
  }, []);

  const bindQuestionRow = useCallback(
    (questionId: string) => (node: HTMLButtonElement | null) => {
      if (node) {
        questionRowRefs.current.set(questionId, node);
        return;
      }
      questionRowRefs.current.delete(questionId);
    },
    [],
  );

  const findQuestionIdByY = useCallback((clientY: number) => {
    let nearest: { id: string; distance: number } | null = null;

    for (const question of displayQuestions) {
      const node = questionRowRefs.current.get(question.id);
      if (!node) {
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return question.id;
      }

      const centerY = rect.top + rect.height / 2;
      const distance = Math.abs(clientY - centerY);
      if (!nearest || distance < nearest.distance) {
        nearest = { id: question.id, distance };
      }
    }

    return nearest?.id ?? null;
  }, [displayQuestions]);

  const updatePanelScrollState = useCallback(() => {
    const node = panelScrollRef.current;
    if (!node || !open) {
      setPanelScrollState((current) =>
        current.canScrollDown || current.canScrollUp
          ? { canScrollDown: false, canScrollUp: false }
          : current,
      );
      return;
    }

    const canScrollUp = node.scrollTop > 1;
    const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setPanelScrollState((current) =>
      current.canScrollDown === canScrollDown && current.canScrollUp === canScrollUp
        ? current
        : { canScrollDown, canScrollUp },
    );
  }, [open]);

  useEffect(() => {
    const measureControlHeight = () => {
      const parentHeight =
        rootRef.current?.parentElement?.getBoundingClientRect().height ??
        (typeof window === 'undefined' ? MAX_CONTROL_HEIGHT_PX : window.innerHeight);
      const nextHeight = clamp(
        parentHeight - CONTROL_VERTICAL_MARGIN_PX,
        MIN_CONTROL_HEIGHT_PX,
        MAX_CONTROL_HEIGHT_PX,
      );
      setControlHeightPx((current) => (current === nextHeight ? current : nextHeight));
    };

    measureControlHeight();

    const parent = rootRef.current?.parentElement ?? null;
    const observer =
      parent && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(measureControlHeight)
        : null;
    if (parent && observer) {
      observer.observe(parent);
    }
    window.addEventListener('resize', measureControlHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureControlHeight);
    };
  }, []);

  useEffect(() => {
    if (!open || isDesktop || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isDesktop, open]);

  useLayoutEffect(() => {
    const scrollNode = panelScrollRef.current;
    if (scrollNode) {
      const maxScrollTop = Math.max(0, scrollNode.scrollHeight - scrollNode.clientHeight);
      const nextScrollTop = clamp(panelAlignedFirstIndex * ROW_HEIGHT_PX, 0, maxScrollTop);
      if (Math.abs(scrollNode.scrollTop - nextScrollTop) > 1) {
        scrollNode.scrollTop = nextScrollTop;
      }
    }

    updatePanelScrollState();
  }, [
    controlVisibleHeightPx,
    displayQuestions.length,
    open,
    panelAlignedFirstIndex,
    updatePanelScrollState,
  ]);

  useEffect(() => {
    if (!gestureActive || typeof document === 'undefined') {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const nextId = findQuestionIdByY(event.clientY);
      if (!nextId || nextId === gesture.selectedId) {
        return;
      }

      gesture.selectedId = nextId;
      setGestureQuestionId(nextId);
    };

    const finishGesture = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      event.preventDefault();
      const selectedId = gesture.selectedId;
      gestureRef.current = null;
      setGestureActive(false);
      setGestureQuestionId(null);
      setOpen(false);
      onSelectQuestion(selectedId);
    };

    const cancelGesture = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      gestureRef.current = null;
      setGestureActive(false);
      setGestureQuestionId(null);
      setOpen(false);
    };

    document.addEventListener('pointermove', handlePointerMove, { passive: false });
    document.addEventListener('pointerup', finishGesture, { passive: false });
    document.addEventListener('pointercancel', cancelGesture);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', finishGesture);
      document.removeEventListener('pointercancel', cancelGesture);
    };
  }, [findQuestionIdByY, gestureActive, onSelectQuestion]);

  if (questions.length < 2) {
    return null;
  }

  const handleSelectQuestion = (questionId: string) => {
    onSelectQuestion(questionId);
    if (!isDesktop) {
      setOpen(false);
    }
  };

  const handleQuestionClick = (questionId: string) => {
    if (!isDesktop && !open) {
      return;
    }
    handleSelectQuestion(questionId);
  };

  const handleQuestionPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    questionId: string,
  ) => {
    if (isDesktop) {
      return;
    }

    event.preventDefault();
    gestureRef.current = {
      pointerId: event.pointerId,
      selectedId: questionId,
    };
    setGestureActive(true);
    setGestureQuestionId(questionId);
    setOpen(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false);
    }
  };

  return (
    <div
      ref={rootRef}
      role="navigation"
      aria-label={`\u63d0\u95ee\u5b9a\u4f4d\uff0c\u5171 ${questions.length} \u4e2a\u63d0\u95ee`}
      className="question-timeline-control absolute right-2 top-1/2 z-30 -translate-y-1/2 lg:right-5"
      onMouseEnter={() => {
        if (isDesktop) {
          setOpen(true);
        }
      }}
      onMouseLeave={() => {
        if (isDesktop) {
          setOpen(false);
        }
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
        }
      }}
    >
      <aside
        aria-label={`\u95ee\u9898\u5b9a\u4f4d\u5217\u8868\uff0c\u5171 ${questions.length} \u4e2a\u63d0\u95ee`}
        data-state={open ? 'open' : 'collapsed'}
        className={cn(
          'relative flex flex-col overflow-hidden rounded-[14px] border py-1 backdrop-blur transition-[width,background-color,border-color,box-shadow] motion-reduce:transition-none',
          DURATION,
          EASING,
          open
            ? 'border-border bg-surface/95 shadow-xl'
            : 'border-transparent bg-transparent shadow-none',
          open ? PANEL_WIDTH : COLLAPSED_WIDTH,
        )}
        style={{ height: controlVisibleHeightPx }}
      >
        <div
          className={cn(
            'pointer-events-none absolute left-4 right-4 top-0 z-10 h-px bg-foreground-muted/25 transition-opacity',
            open && panelScrollState.canScrollUp ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          ref={panelScrollRef}
          className={cn(
            'question-timeline-scroll min-h-0 flex-1 overflow-x-hidden overscroll-contain',
            open ? 'overflow-y-auto' : 'overflow-y-hidden',
          )}
          onScroll={updatePanelScrollState}
        >
          {displayQuestions.map((question) => {
            const isCurrent = question.id === activeQuestionId;
            const isActive = question.id === visualActiveQuestionId;

            return (
              <button
                key={question.id}
                ref={bindQuestionRow(question.id)}
                type="button"
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`\u5b9a\u4f4d\u5230\u7b2c ${question.index} \u4e2a\u63d0\u95ee\uff1a${question.label}`}
                onPointerDown={(event) => handleQuestionPointerDown(event, question.id)}
                onClick={() => handleQuestionClick(question.id)}
                className={cn(
                  'group/question grid h-9 w-full touch-none select-none items-center rounded-md text-left transition-[background-color,padding,gap] motion-reduce:transition-none',
                  QUESTION_ROW_COLUMNS,
                  open ? 'gap-3 pl-4 pr-1' : 'gap-0 pl-0 pr-0',
                  open &&
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  !open && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  open && isActive && 'bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 truncate text-sm leading-5 transition-[opacity,transform,color] motion-reduce:transition-none',
                    open ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
                    isActive
                      ? 'text-foreground'
                      : 'text-foreground-muted group-hover/question:text-foreground',
                  )}
                >
                  {question.label}
                </span>
                <span
                  className="question-timeline-tick-slot flex h-full items-center justify-end"
                  style={
                    open && scrollbarCompensationPx > 0
                      ? { transform: `translateX(${scrollbarCompensationPx}px)` }
                      : undefined
                  }
                >
                  <span
                    className={cn(
                      'h-[3px] rounded-full transition-[width,opacity,background-color,box-shadow] motion-reduce:transition-none',
                      DURATION,
                      EASING,
                      isActive
                        ? 'w-5 bg-[#4f7df6] opacity-100 shadow-[0_0_12px_rgba(79,125,246,0.35)] dark:bg-[#6ea0ff]'
                        : 'w-3 bg-foreground-muted opacity-45 group-hover/question:w-5 group-hover/question:opacity-75',
                    )}
                  />
                </span>
              </button>
            );
          })}
        </div>
        <div
          className={cn(
            'pointer-events-none absolute bottom-0 left-4 right-4 z-10 h-px bg-foreground-muted/25 transition-opacity',
            open && panelScrollState.canScrollDown ? 'opacity-100' : 'opacity-0',
          )}
        />
      </aside>
    </div>
  );
};

export default QuestionTimelineControl;
