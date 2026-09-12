import { randomUUID } from 'node:crypto';

import type { CappySession, CappySessionStore } from './auth';

export interface SessionStoreOptions {
  clock?: () => number;
  ttlMs?: number;
  id?: () => string;
}

/** In-memory sessions are intentionally local and process-scoped. */
export function createSessionStore(options: SessionStoreOptions = {}): CappySessionStore {
  const clock = options.clock ?? Date.now;
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const id = options.id ?? randomUUID;
  const sessions = new Map<string, CappySession>();
  return {
    create(userId, accountId) {
      const issuedAt = new Date(clock()).toISOString();
      const session = { id: id(), userId, accountId, issuedAt, expiresAt: new Date(clock() + ttlMs).toISOString() };
      sessions.set(session.id, session);
      return session;
    },
    revoke(sessionId) { sessions.delete(sessionId); },
    get(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return undefined;
      if (Date.parse(session.expiresAt) <= clock()) { sessions.delete(sessionId); return undefined; }
      return session;
    },
  };
}

export class InMemorySessionStore implements CappySessionStore {
  private readonly store: CappySessionStore;
  constructor(options: SessionStoreOptions = {}) { this.store = createSessionStore(options); }
  create(userId: string, accountId: string) { return this.store.create(userId, accountId); }
  revoke(sessionId: string) { this.store.revoke(sessionId); }
  get(sessionId: string) { return this.store.get(sessionId); }
}
