export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type SessionTokenUsage = {
  totalInputTokens: number;
  totalOutputTokens: number;
  turnCount: number;
  lastUpdatedAt: string;
};

export const emptySessionTokenUsage = (): SessionTokenUsage => ({
  totalInputTokens: 0,
  totalOutputTokens: 0,
  turnCount: 0,
  lastUpdatedAt: new Date(0).toISOString(),
});

export const accumulateSessionTokenUsage = (
  previous: SessionTokenUsage | null | undefined,
  usage: TokenUsage,
  updatedAt: string,
): SessionTokenUsage => ({
  totalInputTokens: (previous?.totalInputTokens ?? 0) + usage.inputTokens,
  totalOutputTokens: (previous?.totalOutputTokens ?? 0) + usage.outputTokens,
  turnCount: (previous?.turnCount ?? 0) + 1,
  lastUpdatedAt: updatedAt,
});
