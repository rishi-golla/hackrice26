import { describe, expect, it } from 'vitest';
import { SnapshotStore } from '../../src/service/snapshot';
import { demoSnapshot } from '../../src/fixtures/demo';

describe('snapshot cache stress', () => {
  it('coalesces concurrent reads and keeps cache bounded', async () => {
    let reads = 0;
    const store = new SnapshotStore({ read: async () => { reads += 1; await Promise.resolve(); return demoSnapshot(); } });
    await Promise.all(Array.from({ length: 100 }, () => store.get('demo-checking', false)));
    expect(reads).toBe(1);
    expect((await store.get('demo-checking', false)).stale).toBe(false);
  });
});
