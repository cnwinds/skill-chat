import type { SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { SessionContextState } from '../../modules/chat/session-context-store.js';
import type { RuntimeInput, TurnExecutionContext } from './turn-types.js';

export type TurnTaskExecutionArgs = {
  sessionId: string;
  userId: string;
  execution: TurnExecutionContext;
  input: RuntimeInput;
  history: StoredEvent[];
  contextState: SessionContextState;
  files: SessionFileContext[];
};

export interface TurnTask {
  execute(args: TurnTaskExecutionArgs): Promise<void>;
}
