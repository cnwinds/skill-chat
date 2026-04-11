import type { SSEvent } from '@skillchat/shared';

type Subscriber = (event: SSEvent) => void;

export class StreamHub {
  private readonly sessions = new Map<string, Set<Subscriber>>();

  subscribe(sessionId: string, subscriber: Subscriber) {
    const subscribers = this.sessions.get(sessionId) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.sessions.set(sessionId, subscribers);

    return () => {
      const current = this.sessions.get(sessionId);
      if (!current) {
        return;
      }
      current.delete(subscriber);
      if (current.size === 0) {
        this.sessions.delete(sessionId);
      }
    };
  }

  publish(sessionId: string, event: SSEvent) {
    const subscribers = this.sessions.get(sessionId);
    if (!subscribers) {
      return;
    }

    for (const subscriber of subscribers) {
      subscriber(event);
    }
  }
}
