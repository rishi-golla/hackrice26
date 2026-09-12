import { describe, expect, it } from 'vitest';

import { evaluateScenario } from '../../src/domain/scenario';
import { demoSnapshot } from '../../src/fixtures/demo';

describe('evaluateScenario', () => {
  it('does not debit a future purchase before its date', () => {
    const result = evaluateScenario(demoSnapshot(), [
      { id: 'tickets', label: 'Tickets', cents: 20000, date: '2026-09-19' },
    ], 10000);

    expect(result.afterPurchase.find(point => point.date === '2026-09-16')?.closingCents).toBe(12000);
    expect(result.minimumCents).toBe(-8000);
  });

  it('combines hypothetical purchases exactly once', () => {
    const result = evaluateScenario(demoSnapshot(), [
      { id: 'tickets', label: 'Tickets', cents: 20000, date: '2026-09-12' },
      { id: 'headphones', label: 'Headphones', cents: 5000, date: '2026-09-12' },
    ], 10000);
    expect(result.purchaseCents).toBe(25000);
    expect(result.minimumCents).toBe(-13000);
  });

  it.each([
    [[{ id: 'same', label: 'A', cents: 100, date: '2026-09-12' }, { id: 'same', label: 'B', cents: 100, date: '2026-09-13' }], /duplicate/i],
    [[{ id: 'bad', label: 'Bad', cents: 0, date: '2026-09-12' }], /positive safe integer/i],
    [[{ id: 'late', label: 'Late', cents: 100, date: '2026-09-26' }], /horizon/i],
  ])('rejects invalid scenarios', (purchases, message) => {
    expect(() => evaluateScenario(demoSnapshot(), purchases, 10000)).toThrow(message);
  });
});
