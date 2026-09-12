import { describe, expect, it } from 'vitest';

import { forecast } from '../../src/domain/forecast';
import type { CashEvent, Snapshot } from '../../src/domain/types';
import { demoSnapshot } from '../../src/fixtures/demo';

const snapshotWith = (balanceCents: number, events: CashEvent[]): Snapshot => ({
  accountId: 'test',
  balanceCents,
  currency: 'USD',
  asOf: '2026-09-12T12:00:00.000Z',
  today: '2026-09-12',
  timezone: 'America/Chicago',
  mode: 'synthetic',
  complete: true,
  stale: false,
  events,
});

const cashEvent = (overrides: Partial<CashEvent>): CashEvent => ({
  id: 'event', sourceId: 'source', date: '2026-09-12', cents: -100,
  label: 'Event', kind: 'bill', confidence: 'scheduled',
  reflectedInBalance: false, cancelled: false, ...overrides,
});

describe('forecast', () => {
  it('computes the canonical fourteen-day projection', () => {
    const result = forecast(demoSnapshot(), 20000, 10000);

    expect(result.baseline).toHaveLength(14);
    expect(result.baselineMinimumCents).toBe(12000);
    expect(result.safeToSpendCents).toBe(2000);
    expect(result.minimumCents).toBe(-8000);
    expect(result.minimumDate).toBe('2026-09-16');
    expect(result.status).toBe('negative');
  });

  it('leaves $110 after a $10 purchase', () => {
    const result = forecast(demoSnapshot(), 1000, 10000);
    expect(result.minimumCents).toBe(11000);
    expect(result.status).toBe('within-reserve');
  });

  it('treats zero as below reserve rather than negative', () => {
    const snapshot = demoSnapshot();
    snapshot.events = snapshot.events.filter(item => item.label !== 'Utilities');
    const result = forecast(snapshot, 20000, 10000);
    expect(result.minimumCents).toBe(0);
    expect(result.status).toBe('below-reserve');
  });

  it('treats the exact reserve boundary as within reserve', () => {
    expect(forecast(demoSnapshot(), 2000, 10000).status).toBe('within-reserve');
  });

  it('records a same-day debit low before applying scheduled income', () => {
    const result = forecast(snapshotWith(5000, [
      cashEvent({ id: 'income', sourceId: 'income', cents: 10000, kind: 'income' }),
      cashEvent({ id: 'bill', sourceId: 'bill', cents: -7000 }),
    ]), 0, 0);

    expect(result.baseline[0]).toEqual({
      date: '2026-09-12', openingCents: 5000, lowCents: -2000, closingCents: 8000,
    });
    expect(result.status).toBe('negative');
  });

  it('does not attribute a pre-existing baseline shortfall to the purchase', () => {
    const result = forecast(snapshotWith(-100, []), 0, 0);
    expect(result.baselineMinimumCents).toBe(-100);
    expect(result.reasons.join(' ')).toMatch(/baseline is already below zero/i);
  });

  it('marks stale, provider-incomplete, and overdue data in the result', () => {
    const snapshot = snapshotWith(10000, [
      cashEvent({ id: 'overdue', sourceId: 'overdue', date: '2026-09-11', label: 'Late bill' }),
    ]);
    snapshot.stale = true;
    snapshot.complete = false;

    const result = forecast(snapshot, 0, 0);
    expect(result.complete).toBe(false);
    expect(result.stale).toBe(true);
    expect(result.reasons.join(' ')).toMatch(/stale/i);
    expect(result.reasons.join(' ')).toMatch(/incomplete/i);
    expect(result.reasons.join(' ')).toMatch(/Late bill/);
  });

  it('fails closed on unsafe integer arithmetic', () => {
    const result = () => forecast(snapshotWith(Number.MAX_SAFE_INTEGER, [
      cashEvent({ cents: 1, kind: 'income' }),
    ]), 0, 0);
    expect(result).toThrow(/safe integer/i);
  });
});
