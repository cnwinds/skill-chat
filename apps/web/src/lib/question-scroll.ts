const QUESTION_ANCHOR_RATIO = 0.3;
const QUESTION_ANCHOR_MIN_PX = 96;
const QUESTION_ANCHOR_MAX_RATIO = 0.55;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const getQuestionAnchorOffset = (containerHeight: number) => {
  const height = Math.max(0, containerHeight);
  return Math.min(
    Math.max(height * QUESTION_ANCHOR_RATIO, QUESTION_ANCHOR_MIN_PX),
    height * QUESTION_ANCHOR_MAX_RATIO,
  );
};

export const getQuestionTargetScrollTop = ({
  currentScrollTop,
  scrollHeight,
  clientHeight,
  containerTop,
  questionTop,
}: {
  currentScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  containerTop: number;
  questionTop: number;
}) => {
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  const targetScrollTop =
    currentScrollTop + questionTop - containerTop - getQuestionAnchorOffset(clientHeight);

  return clamp(targetScrollTop, 0, maxScrollTop);
};
