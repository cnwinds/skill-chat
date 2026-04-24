import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { turnKindSchema, turnPhaseSchema } from '@skillchat/shared';
import type { PersistedRuntimeState, RuntimePersistence } from './turn-types.js';

const persistedInputSchema = z.object({
  inputId: z.string().trim().min(1),
  content: z.string(),
  createdAt: z.string(),
  source: z.enum(['steer', 'queued']),
  requestedKind: turnKindSchema,
  attachmentIds: z.array(z.string().trim().min(1)).optional(),
  turnConfig: z.object({
    model: z.string().trim().min(1).optional(),
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    webSearchMode: z.enum(['disabled', 'cached', 'live']).optional(),
  }).optional(),
});

const persistedActiveTurnSchema = z.object({
  turnId: z.string().trim().min(1),
  kind: turnKindSchema,
  status: z.enum(['running', 'interrupting']),
  phase: turnPhaseSchema,
  phaseStartedAt: z.string(),
  canSteer: z.boolean(),
  startedAt: z.string(),
  round: z.number().int().nonnegative(),
  pendingInputs: z.array(persistedInputSchema),
});

const persistedRuntimeStateSchema = z.object({
  sessionId: z.string().trim().min(1),
  activeTurn: persistedActiveTurnSchema.nullable(),
  queuedInputs: z.array(persistedInputSchema),
  recovery: z.object({
    recoveredAt: z.string(),
    previousTurnId: z.string().trim().min(1),
    previousTurnKind: turnKindSchema,
    reason: z.literal('process_restarted'),
  }).nullable(),
});

export class FileRuntimePersistence implements RuntimePersistence {
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedRuntimeState | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return persistedRuntimeStateSchema.parse(JSON.parse(raw)) as PersistedRuntimeState;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return null;
      }

      return null;
    }
  }

  save(snapshot: PersistedRuntimeState) {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      });

    return this.writeChain;
  }

  clear() {
    this.writeChain = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        await fs.rm(this.filePath, { force: true });
      });

    return this.writeChain;
  }
}
