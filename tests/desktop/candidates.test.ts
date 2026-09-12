import { describe, expect, it, vi } from 'vitest';
import { createCandidateRegistry } from '../../src/desktop/candidates';
import type { PurchaseCandidate } from '../../src/desktop/ocr/extract';

const candidate: PurchaseCandidate = {
  amountCents: 20_000,
  sourceText: '$200.00',
  state: 'confirm',
  buttonBox: null,
  totalBox: { x: 0, y: 0, width: 10, height: 10 },
  reason: 'low-confidence',
};

describe('candidate registry handoff', () => {
  it('registers reviewable candidates, notifies listeners, and confirms once', () => {
    const registry = createCandidateRegistry();
    const listener = vi.fn();
    const unsubscribe = registry.onCandidate(listener);

    const id = registry.registerCandidate(candidate);
    expect(id).toBe('candidate-1');
    expect(listener).toHaveBeenCalledWith({ id, candidate });
    expect(registry.confirmCandidate(id)).toEqual({
      id,
      cents: 20_000,
      label: 'Unlabeled screen purchase',
      origin: 'screen',
    });
    expect(registry.confirmCandidate(id)).toBe(registry.confirmCandidate(id));

    unsubscribe();
    registry.registerCandidate({ ...candidate, amountCents: 1_000 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('rejects no-candidate results and unknown confirmations', () => {
    const registry = createCandidateRegistry();
    expect(() => registry.registerCandidate({ ...candidate, state: 'no-candidate', amountCents: null })).toThrow();
    expect(() => registry.confirmCandidate('missing')).toThrow();
  });
});
