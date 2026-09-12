import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../../src/domain/types';
import { createConversationManager } from '../../src/service/conversation/controller';

const baseSnapshot: Snapshot = {
  accountId: 'a', balanceCents: 100_000, currency: 'USD', asOf: '2026-09-12T12:00:00Z',
  today: '2026-09-12', timezone: 'America/Chicago', mode: 'synthetic', complete: true, stale: false, events: [],
};

describe('bounded session lifecycle', () => {
  it('keeps ten messages and ten confirmed references', async () => {
    const manager = createConversationManager({ id: sequentialIds() });
    const session = manager.createSession('a', 'synthetic');
    for (let i = 0; i < 11; i += 1) {
      manager.registerCandidate(session.id, { id: `p-${i}`, label: `Purchase ${i}`, cents: 100 + i, date: '2026-09-12', origin: 'typed', confirmed: true });
      await manager.turn({ sessionId: session.id, turnId: `remember-${i}`, text: 'Remember this.', candidateId: `p-${i}` }, baseSnapshot);
    }

    const current = manager.getSession(session.id)!;
    expect(current.references).toHaveLength(10);
    expect(current.references[0].id).toBe('p-1');
    expect(current.turns).toHaveLength(10);
  });

  it('expires semantic memory after thirty idle minutes', async () => {
    let now = 0;
    const manager = createConversationManager({ now: () => now, id: sequentialIds() });
    const session = manager.createSession('a', 'synthetic');
    manager.registerCandidate(session.id, { id: 'p', label: 'Purchase', cents: 100, date: '2026-09-12', origin: 'typed', confirmed: true });
    await manager.turn({ sessionId: session.id, turnId: 'remember', text: 'Remember this.', candidateId: 'p' }, baseSnapshot);
    now = 30 * 60 * 1_000 + 1;

    const reply = await manager.turn({ sessionId: session.id, turnId: 'expired', text: 'Can I afford this?' }, baseSnapshot);

    expect(reply.state).toBe('clarifying');
    expect(manager.getSession(session.id)?.references).toEqual([]);
  });

  it('clears memory when the account or data mode changes', async () => {
    const manager = createConversationManager({ id: sequentialIds() });
    const session = manager.createSession('a', 'synthetic');
    manager.registerCandidate(session.id, { id: 'p', label: 'Purchase', cents: 100, date: '2026-09-12', origin: 'typed', confirmed: true });
    await manager.turn({ sessionId: session.id, turnId: 'remember', text: 'Remember this.', candidateId: 'p' }, baseSnapshot);

    const switched = await manager.turn({ sessionId: session.id, turnId: 'switch', text: 'Can I afford this?' }, { ...baseSnapshot, accountId: 'b', mode: 'recorded-sandbox' });

    expect(switched.state).toBe('clarifying');
    expect(manager.getSession(session.id)).toMatchObject({ accountId: 'b', mode: 'recorded-sandbox', references: [], lastScenario: [] });
  });

  it('does not mutate memory when a routed turn is cancelled', async () => {
    let release!: (value: unknown) => void;
    const router = { mode: 'test' as const, route: () => new Promise<unknown>((resolve) => { release = resolve; }) };
    const manager = createConversationManager({ router, id: sequentialIds() });
    const session = manager.createSession('a', 'synthetic');
    const pending = manager.turn({ sessionId: session.id, turnId: 'slow', text: 'Remember this.' }, baseSnapshot);
    manager.cancel(session.id);
    release({ kind: 'forget' });

    await expect(pending).rejects.toThrow(/TURN_CANCELLED/);
    expect(manager.getSession(session.id)).toMatchObject({ references: [], turns: [], lastScenario: [] });
  });

  it('only returns generated replies to their owning session', async () => {
    const manager = createConversationManager({ id: sequentialIds() });
    const first = manager.createSession('a', 'synthetic');
    const second = manager.createSession('a', 'synthetic');
    const reply = await manager.turn({ sessionId: first.id, turnId: 'unknown', text: 'Tell me a joke.' }, baseSnapshot);

    expect(manager.getReply(first.id, reply.replyId)?.text).toBe(reply.text);
    expect(manager.getReply(second.id, reply.replyId)).toBeUndefined();
  });
});

function sequentialIds(): () => string {
  let next = 0;
  return () => `generated-${++next}`;
}
