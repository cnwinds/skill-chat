import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const ROW_HEIGHT_PX = 36;
const MAX_CONTROL_HEIGHT_PX = 420;
const MIN_CONTROL_HEIGHT_PX = ROW_HEIGHT_PX * 5;
const CONTROL_VERTICAL_MARGIN_PX = 48;
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

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getVisibleRailQuestions = <T extends { id: string }>({
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
    return {
      hasHiddenBefore: false,
      hasHiddenAfter: false,
      visibleQuestions: questions,
    };
  }

  const activeIndex = Math.max(
    0,
    questions.findIndex((question) => activeId !== null && question.id === activeId),
  );
  const questionCapacity = Math.max(1, maxSlots - 2);
  const start = clamp(
    activeIndex - Math.floor(questionCapacity / 2),
    0,
    total - questionCapacity,
  );
  const end = start + questionCapacity;

  return {
    hasHiddenBefore: start > 0,
    hasHiddenAfter: end < total,
    visibleQuestions: questions.slice(start, end),
  };
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
        label: truncateQuestion(question.content) || `第 ${question.index} 个提问`,
      })),
    [questions],
  );
  const visualActiveQuestionId = gestureQuestionId ?? activeQuestionId;
  const railSlots = clamp(
    Math.floor(controlHeightPx / ROW_HEIGHT_PX),
    MIN_RAIL_SLOTS,
    MAX_RAIL_SLOTS,
  );
  const {
    hasHiddenBefore: railHasHiddenBefore,
    hasHiddenAfter: railHasHiddenAfter,
    visibleQuestions: railQuestions,
  } = useMemo(
    () =>
      getVisibleRailQuestions({
        activeId: visualActiveQuestionId,
        maxSlots: railSlots,
        questions: displayQuestions,
      }),
    [displayQuestions, railSlots, visualActiveQuestionId],
  );

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
    if (!node) {
      setPanelScrollState({ canScrollDown: false, canScrollUp: false });
      return;
    }

    const canScrollUp = node.scrollTop > 1;
    const canScrollDown = node.scrollTop + node.clientHeight < node.scrollHeight - 1;
    setPanelScrollState((current) =>
      current.canScrollDown === canScrollDown && current.canScrollUp === canScrollUp
        ? current
        : { canScrollDown, canScrollUp },
    );
  }, []);

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

  useEffect(() => {
    if (!open) {
      return;
    }

    const activeRow = visualActiveQuestionId
      ? questionRowRefs.current.get(visualActiveQuestionId)
      : null;
    if (typeof activeRow?.scrollIntoView === 'function') {
      activeRow.scrollIntoView({ block: 'nearest' });
    }

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(updatePanelScrollState);
      return;
    }
    window.setTimeout(updatePanelScrollState, 0);
  }, [
    controlHeightPx,
    displayQuestions.length,
    open,
    updatePanelScrollState,
    visualActiveQuestionId,
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

  const handleRailClick = (questionId: string) => {
    if (isDesktop) {
      onSelectQuestion(questionId);
      return;
    }
  };

  const handleRailPointerDown = (
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
      aria-label={`提问定位，共 ${questions.length} 个提问`}
      className="absolute right-2 top-1/2 z-30 -translate-y-1/2 lg:right-5"
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
        aria-label={`问题定位列表，共 ${questions.length} 个提问`}
        aria-hidden={!open}
        inert={!open}
        className={cn(
          'pointer-events-auto absolute right-0 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-[14px] border border-border bg-surface/95 py-2 shadow-xl backdrop-blur',
          'transition-[opacity,transform] motion-reduce:transition-none',
          PANEL_WIDTH,
          DURATION,
          EASING,
          open ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-3 opacity-0',
        )}
        style={{ maxHeight: controlHeightPx }}
      >
        <div
          className={cn(
            'pointer-events-none absolute left-4 right-4 top-0 z-10 h-px bg-foreground-muted/25 transition-opacity',
            panelScrollState.canScrollUp ? 'opacity-100' : 'opacity-0',
          )}
        />
        <div
          ref={panelScrollRef}
          className="min-h-0 overflow-y-auto overscroll-contain pr-1"
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
                aria-label={`定位到第 ${question.index} 个提问：${question.label}`}
                onClick={() => handleSelectQuestion(question.id)}
                className={cn(
                  'group/row grid h-9 w-full touch-none select-none grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-3 px-4 text-left transition-colors',
                  'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  isActive && 'bg-surface-hover',
                )}
              >
                <span
                  className={cn(
                    'min-w-0 truncate text-sm leading-5 transition-colors',
                    isActive
                      ? 'text-foreground'
                      : 'text-foreground-muted group-hover/row:text-foreground',
                  )}
                >
                  {question.label}
                </span>
                <span className="flex h-full w-10 items-center justify-end">
                  <span
                    className={cn(
                      'h-[3px] rounded-full transition-[width,opacity,background-color,box-shadow] motion-reduce:transition-none',
                      DURATION,
                      EASING,
                      isActive
                        ? 'w-5 bg-[#4f7df6] opacity-100 shadow-[0_0_12px_rgba(79,125,246,0.35)] dark:bg-[#6ea0ff]'
                        : 'w-3 bg-foreground-muted opacity-45 group-hover/row:w-5 group-hover/row:opacity-75',
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
            panelScrollState.canScrollDown ? 'opacity-100' : 'opacity-0',
          )}
        />
      </aside>

      <div
        aria-hidden={open}
        inert={open}
        className={cn(
          'pointer-events-auto flex flex-col items-end overflow-hidden rounded-full px-1 py-1 transition-opacity motion-reduce:transition-none',
          DURATION,
          EASING,
          open ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        style={{ maxHeight: controlHeightPx }}
      >
        {railHasHiddenBefore ? (
          <span className="flex h-9 w-10 items-center justify-end pr-1" aria-hidden="true">
            <span className="h-[3px] w-2 rounded-full bg-foreground-muted/25" />
          </span>
        ) : null}
        {railQuestions.map((question) => {
          const isActive = question.id === visualActiveQuestionId;
          return (
            <button
              key={question.id}
              type="button"
              aria-label={`展开问题定位列表：第 ${question.index} 个提问，${question.label}`}
              onPointerDown={(event) => handleRailPointerDown(event, question.id)}
              onClick={() => handleRailClick(question.id)}
              className="group/rail flex h-9 w-10 shrink-0 touch-none select-none items-center justify-end rounded-md pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <span
                className={cn(
                  'h-[3px] rounded-full transition-[width,opacity,background-color,box-shadow] motion-reduce:transition-none',
                  DURATION,
                  EASING,
                  isActive
                    ? 'w-5 bg-[#4f7df6] opacity-100 shadow-[0_0_12px_rgba(79,125,246,0.35)] dark:bg-[#6ea0ff]'
                    : 'w-3 bg-foreground-muted opacity-45 group-hover/rail:w-5 group-hover/rail:opacity-75',
                )}
              />
            </button>
          );
        })}
        {railHasHiddenAfter ? (
          <span className="flex h-9 w-10 items-center justify-end pr-1" aria-hidden="true">
            <span className="h-[3px] w-2 rounded-full bg-foreground-muted/25" />
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default QuestionTimelineControl;
