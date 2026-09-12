import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../src/fixtures/demo.js';
import { evaluateScenario } from '../../src/domain/scenario.js';

describe('dated hypothetical purchase scenarios', () => {
  it('applies an immediate two-hundred-dollar purchase exactly once', () => {
    const result = evaluateScenario(
      demoSnapshot(),
      [{ id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-12' }],
      10_000,
    );

    expect(result.minimumCents).toBe(-8_000);
    expect(result.status).toBe('negative');
    expect(result.afterPurchase.find((point) => point.date === '2026-09-16')?.intradayLowCents).toBe(
      -8_000,
    );
  });

  it('does not debit a future purchase before its date', () => {
    const result = evaluateScenario(
      demoSnapshot(),
      [{ id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-20' }],
      10_000,
    );

    expect(result.afterPurchase.find((point) => point.date === '2026-09-16')?.closingCents).toBe(
      12_000,
    );
    expect(result.minimumCents).toBe(12_000);
  });

  it('combines confirmed hypothetical purchases without double counting', () => {
    const result = evaluateScenario(
      demoSnapshot(),
      [
        { id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-12' },
        { id: 'headphones', label: 'Headphones', cents: 5_000, date: '2026-09-12' },
      ],
      10_000,
    );

    expect(result.purchaseCents).toBe(25_000);
    expect(result.minimumCents).toBe(-13_000);
  });

  it('rejects duplicate IDs, invalid amounts, and dates outside the fourteen-day horizon', () => {
    expect(() =>
      evaluateScenario(
        demoSnapshot(),
        [
          { id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-12' },
          { id: 'tickets', label: 'Tickets again', cents: 1_000, date: '2026-09-12' },
        ],
        10_000,
      ),
    ).toThrow(/duplicate/i);
    expect(() =>
      evaluateScenario(
        demoSnapshot(),
        [{ id: 'free', label: 'Free', cents: 0, date: '2026-09-12' }],
        10_000,
      ),
    ).toThrow(/cents/i);
    expect(() =>
      evaluateScenario(
        demoSnapshot(),
        [{ id: 'late', label: 'Late', cents: 1_000, date: '2026-09-26' }],
        10_000,
      ),
    ).toThrow(/horizon/i);
  });
});
