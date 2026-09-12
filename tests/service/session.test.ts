import { describe, expect, it } from 'vitest';
import { createSessionStore } from '../../src/service/session';

describe('Cappy sessions', () => {
  it('expires by injected clock, binds accounts, and revokes on logout', () => {
    let now = 1_000;
    const store = createSessionStore({ clock: () => now, ttlMs: 100, id: () => 's' });
    const session = store.create('u', 'demo-checking');
    expect(store.get('s')).toEqual(session);
    now = 1_100; expect(store.get('s')).toBeUndefined();
    const next = store.create('u', 'demo-checking'); store.revoke(next.id); expect(store.get(next.id)).toBeUndefined();
  });
  it('fails closed for unknown sessions', () => { const store = createSessionStore(); expect(store.get('unknown')).toBeUndefined(); });
});
