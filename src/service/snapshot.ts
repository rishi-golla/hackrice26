import type { Snapshot } from '../domain/types';
import { validateSnapshot } from '../domain/types';

export interface SnapshotProvider {
  read(accountId: string): Promise<Snapshot>;
}

export type SnapshotStoreOptions = {
  ttlMs?: number;
  clock?: () => number;
};

type CacheEntry = { snapshot: Snapshot; cachedAt: number };

function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return {
    ...snapshot,
    ...(snapshot.sources ? { sources: [...snapshot.sources] } : {}),
    events: snapshot.events.map(event => ({ ...event })),
  };
}

export class SnapshotStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<Snapshot>>();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(private readonly provider: SnapshotProvider, options: SnapshotStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.clock = options.clock ?? Date.now;
    if (!Number.isSafeInteger(this.ttlMs) || this.ttlMs < 0) {
      throw new Error('Snapshot TTL must be a nonnegative safe integer');
    }
  }

  async get(accountId: string, refresh: boolean): Promise<Snapshot> {
    if (typeof accountId !== 'string' || accountId.trim() === '') throw new Error('Account id is required');
    const now = this.clock();
    if (!Number.isFinite(now)) throw new Error('Snapshot clock returned an invalid time');
    const cached = this.cache.get(accountId);
    if (!refresh && cached && now - cached.cachedAt < this.ttlMs) {
      return cloneSnapshot(cached.snapshot);
    }

    const existing = this.inflight.get(accountId);
    if (existing) return cloneSnapshot(await existing);
    const read = (async () => {
      const snapshot = validateSnapshot(await this.provider.read(accountId));
      if (snapshot.accountId !== accountId) throw new Error('Provider returned a snapshot for a different account');
      const stored = cloneSnapshot(snapshot);
      this.cache.set(accountId, { snapshot: stored, cachedAt: now });
      return stored;
    })();
    this.inflight.set(accountId, read);
    try { return cloneSnapshot(await read); }
    catch (error) { if (!cached) throw error; return { ...cloneSnapshot(cached.snapshot), stale: true }; }
    finally { this.inflight.delete(accountId); }
  }
}
