import type { SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { SessionContextState } from '../../modules/chat/session-context-store.js';
import type { RuntimeInput, TurnExecutionContext } from './turn-types.js';
import type { TurnTask, TurnTaskExecutionArgs } from './turn-task.js';

type RegularTurnTaskDeps = {
  maybeAutoCompactHistory: (args: {
    sessionId: string;
    userId: string;
    history: StoredEvent[];
    contextState: SessionContextState;
    execution: TurnExecutionContext;
    input: RuntimeInput;
  }) => Promise<SessionContextState>;
  readHistory: (userId: string, sessionId: string) => Promise<StoredEvent[]>;
  getFiles: (userId: string, sessionId: string) => SessionFileContext[];
  executeTurnRound: (args: {
    sessionId: string;
    history: StoredEvent[];
    contextState: SessionContextState;
    files: SessionFileContext[];
    execution: TurnExecutionContext;
    input: RuntimeInput;
    startingRound: number;
  }) => Promise<{ roundsUsed: number }>;
  mergeContinuationInputs: (inputs: RuntimeInput[]) => RuntimeInput;
  evaluateStopCondition?: () => Promise<{ shouldContinue: false }>;
};

export class RegularTurnTask implements TurnTask {
  constructor(private readonly deps: RegularTurnTaskDeps) {}

  async execute(args: TurnTaskExecutionArgs) {
    let currentInput = args.input;
    let nextRound = 1;
    let history = args.history;
    let contextState = args.contextState;
    let files = args.files;

    while (true) {
      contextState = await this.deps.maybeAutoCompactHistory({
        sessionId: args.sessionId,
        userId: args.userId,
        history,
        contextState,
        execution: args.execution,
        input: currentInput,
      });
      history = await this.deps.readHistory(args.userId, args.sessionId);
      files = this.deps.getFiles(args.userId, args.sessionId);

      const { roundsUsed } = await this.deps.executeTurnRound({
        sessionId: args.sessionId,
        history,
        contextState,
        files,
        execution: args.execution,
        input: currentInput,
        startingRound: nextRound,
      });

      nextRound += roundsUsed;
      args.execution.throwIfAborted();
      args.execution.updatePhase('finalizing');
      args.execution.setCanSteer(false);

      const stopDecision = await this.deps.evaluateStopCondition?.() ?? { shouldContinue: false as const };
      if (stopDecision.shouldContinue) {
        continue;
      }

      const pendingInputs = await args.execution.drainPendingInputs();
      if (pendingInputs.length === 0) {
        return;
      }

      currentInput = this.deps.mergeContinuationInputs(pendingInputs);
    }
  }
}
