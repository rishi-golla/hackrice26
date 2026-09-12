import { describe, expect, it } from 'vitest';
import {
  CandidateRegistry,
  type CandidateInput,
} from '../../src/service/conversation/candidates.js';

const candidate: CandidateInput = {
  id: 'screen-1',
  label: 'Tickets',
  cents: 20_000,
  date: '2026-09-12',
  capturedAt: 1_000,
  coordinateExpiresAt: 2_000,
};

describe('conversation candidate registry', () => {
  it('returns a fresh candidate for analysis and confirms it as a semantic reference', () => {
    const registry = new CandidateRegistry();
    const id = registry.registerCandidate('checking', candidate);

    expect(registry.getFreshCandidate('checking', id, 1_500)).toMatchObject({
      id,
      label: 'Tickets',
      confirmed: false,
    });
    expect(registry.confirmCandidate('checking', id, 1_500)).toMatchObject({
      id,
      label: 'Tickets',
      confirmed: true,
      origin: 'screen',
    });
  });

  it('expires coordinate access without deleting the confirmed semantic reference', () => {
    const registry = new CandidateRegistry();
    const id = registry.registerCandidate('checking', candidate);
    registry.confirmCandidate('checking', id, 1_500);

    expect(registry.getFreshCandidate('checking', id, 2_000)).toBeUndefined();
    expect(registry.getConfirmedReference('checking', id, 3_000)).toMatchObject({
      id,
      confirmed: true,
    });
  });

  it('rejects cross-account access and unknown candidates', () => {
    const registry = new CandidateRegistry();
    const id = registry.registerCandidate('checking', candidate);

    expect(registry.getFreshCandidate('savings', id, 1_500)).toBeUndefined();
    expect(registry.confirmCandidate('savings', id, 1_500)).toBeUndefined();
    expect(registry.confirmCandidate('checking', 'missing', 1_500)).toBeUndefined();
  });
});
