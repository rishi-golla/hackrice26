import { describe, expect, it, vi } from 'vitest';

import { SnapshotStore, type SnapshotProvider } from '../../src/service/snapshot';
import { demoSnapshot } from '../../src/fixtures/demo';

describe('SnapshotStore', () => {
  it('uses a snapshot for less than sixty seconds and refreshes at expiry', async () => {
    let now = 0;
    const read = vi.fn(async () => ({ ...demoSnapshot(), asOf: new Date(now).toISOString() }));
    const store = new SnapshotStore({ read }, { clock: () => now });

    await store.get('demo-checking', false);
    now = 59_999;
    await store.get('demo-checking', false);
    expect(read).toHaveBeenCalledTimes(1);

    now = 60_000;
    await store.get('demo-checking', false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('forces refresh inside the cache lifetime', async () => {
    const read = vi.fn(async () => demoSnapshot());
    const store = new SnapshotStore({ read });
    await store.get('demo-checking', false);
    await store.get('demo-checking', true);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('isolates cached source provenance from caller mutations', async () => {
    const snapshot = { ...demoSnapshot(), sources: ['/accounts/demo-checking'] };
    const store = new SnapshotStore({ read: async () => snapshot });

    const first = await store.get('demo-checking', false);
    first.sources!.push('/mutated');
    const second = await store.get('demo-checking', false);

    expect(second.sources).toEqual(['/accounts/demo-checking']);
    expect(snapshot.sources).toEqual(['/accounts/demo-checking']);
  });

  it('returns a stale cached snapshot after provider failure', async () => {
    let fail = false;
    const provider: SnapshotProvider = {
      async read() {
        if (fail) throw new Error('offline');
        return demoSnapshot();
      },
    };
    const store = new SnapshotStore(provider);
    const fresh = await store.get('demo-checking', false);
    fail = true;
    const stale = await store.get('demo-checking', true);

    expect(fresh.stale).toBe(false);
    expect(stale.stale).toBe(true);
    expect(fresh.stale).toBe(false);
  });

  it('throws provider failure when there is no cached snapshot', async () => {
    const store = new SnapshotStore({ read: async () => { throw new Error('offline'); } });
    await expect(store.get('demo-checking', false)).rejects.toThrow('offline');
  });

  it('rejects malformed snapshots and account mismatches', async () => {
    const unsafe = { ...demoSnapshot(), balanceCents: Number.MAX_SAFE_INTEGER + 1 };
    const malformed = new SnapshotStore({ read: async () => unsafe });
    await expect(malformed.get('demo-checking', false)).rejects.toThrow(/balanceCents/);

    const mismatched = new SnapshotStore({ read: async () => demoSnapshot() });
    await expect(mismatched.get('different-account', false)).rejects.toThrow(/account/i);
  });
});
