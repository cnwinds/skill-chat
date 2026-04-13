import type { TurnTask, TurnTaskExecutionArgs } from './turn-task.js';

type CompactTurnTaskDeps = {
  executeCompactTurn: TurnTask['execute'];
};

export class CompactTurnTask implements TurnTask {
  constructor(private readonly deps: CompactTurnTaskDeps) {}

  async execute(args: TurnTaskExecutionArgs) {
    await this.deps.executeCompactTurn(args);
  }
}
