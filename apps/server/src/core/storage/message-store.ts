import fs from 'node:fs/promises';
import type { StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { getSessionMessagesPath } from './paths.js';

export interface MessageQuery {
  before?: string;
  after?: string;
  limit?: number;
}

export class MessageStore {
  constructor(private readonly config: AppConfig) {}

  async appendEvent(userId: string, sessionId: string, event: StoredEvent) {
    const filePath = getSessionMessagesPath(this.config, userId, sessionId);
    await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async readEvents(userId: string, sessionId: string, query: MessageQuery = {}): Promise<StoredEvent[]> {
    const filePath = getSessionMessagesPath(this.config, userId, sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let events = lines.map((line) => JSON.parse(line) as StoredEvent);

      if (query.after) {
        events = events.filter((event) => event.createdAt > query.after!);
      }

      if (query.before) {
        events = events.filter((event) => event.createdAt < query.before!);
      }

      if (query.limit && query.limit > 0) {
        events = events.slice(-query.limit);
      }

      return events;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}
