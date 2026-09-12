import { describe, expect, it } from 'vitest';

import { forecast } from '../../src/domain/forecast';
import { buildFinancialInsights } from '../../src/domain/insights';
import type { CashEvent, Snapshot } from '../../src/domain/types';

const cashEvent = (overrides: Partial<CashEvent>): CashEvent => ({
  id: 'event',
  sourceId: 'source',
  date: '2026-09-12',
  cents: -100,
  label: 'Event',
  kind: 'expense',
  confidence: 'scheduled',
  reflectedInBalance: false,
  cancelled: false,
  ...overrides,
});

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  accountId: 'checking-1',
  balanceCents: 80_000,
  currency: 'USD',
  asOf: '2026-09-12T14:00:00.000Z',
  today: '2026-09-12',
  timezone: 'America/Chicago',
  mode: 'live-sandbox',
  complete: true,
  stale: false,
  sources: ['/withdrawals', '/accounts', '/bills'],
  events: [],
  ...overrides,
});

describe('buildFinancialInsights', () => {
  it('uses the existing forecast result for safe-to-spend', () => {
    const value = snapshot({
      events: [cashEvent({ id: 'rent', date: '2026-09-14', cents: -60_000, kind: 'bill' })],
    });

    expect(buildFinancialInsights(value, 10_000).safeToSpendCents)
      .toBe(forecast(value, 0, 10_000).safeToSpendCents);
  });

  it('orders upcoming bills and scheduled income within the 14-day horizon', () => {
    const result = buildFinancialInsights(snapshot({ events: [
      cashEvent({ id: 'late-bill', date: '2026-09-25', cents: -2_000, label: 'Internet', kind: 'bill' }),
      cashEvent({ id: 'first-income', sourceId: 'income-refund', date: '2026-09-13', cents: 5_000, label: 'Refund', kind: 'income' }),
      cashEvent({ id: 'first-bill', sourceId: 'bill-water', date: '2026-09-13', cents: -1_000, label: 'Water', kind: 'bill', recurrence: 'monthly' }),
      cashEvent({ id: 'later-income', date: '2026-09-24', cents: 20_000, label: 'Paycheck', kind: 'income' }),
      cashEvent({ id: 'outside', date: '2026-09-26', cents: -9_000, label: 'Outside', kind: 'bill' }),
      cashEvent({ id: 'unconfirmed', date: '2026-09-14', cents: 9_000, label: 'Maybe', kind: 'income', confidence: 'unconfirmed' }),
    ] }), 10_000);

    expect(result.upcomingBills).toEqual([
      { id: 'first-bill', label: 'Water', date: '2026-09-13', cents: 1_000, recurring: true },
      { id: 'late-bill', label: 'Internet', date: '2026-09-25', cents: 2_000, recurring: false },
    ]);
    expect(result.expectedIncome).toEqual([
      { id: 'first-income', label: 'Refund', date: '2026-09-13', cents: 5_000 },
      { id: 'later-income', label: 'Paycheck', date: '2026-09-24', cents: 20_000 },
    ]);
  });

  it('sums recurring outflow and normalized Nessie loan obligations', () => {
    const result = buildFinancialInsights(snapshot({ events: [
      cashEvent({ id: 'rent', sourceId: 'nessie:bill:rent', date: '2026-09-13', cents: -50_000, kind: 'bill', recurrence: 'monthly' }),
      cashEvent({ id: 'loan', sourceId: 'nessie:loan:student', date: '2026-09-14', cents: -12_500, kind: 'bill', recurrence: 'monthly' }),
      cashEvent({ id: 'one-off', date: '2026-09-15', cents: -2_000, kind: 'expense' }),
    ] }), 0);

    expect(result.recurringOutflowCents).toBe(62_500);
    expect(result.loanObligationsCents).toBe(12_500);
  });

  it('totals completed or past deposits and withdrawals from the prior 30 days only', () => {
    const result = buildFinancialInsights(snapshot({ events: [
      cashEvent({ id: 'old-edge', date: '2026-08-13', cents: 1_000, kind: 'income', reflectedInBalance: true }),
      cashEvent({ id: 'too-old', date: '2026-08-12', cents: 99_000, kind: 'income', reflectedInBalance: true }),
      cashEvent({ id: 'past-income', date: '2026-09-01', cents: 4_000, kind: 'income' }),
      cashEvent({ id: 'today-posted', date: '2026-09-12', cents: 3_000, kind: 'income', reflectedInBalance: true }),
      cashEvent({ id: 'today-pending', date: '2026-09-12', cents: 7_000, kind: 'income' }),
      cashEvent({ id: 'past-expense', date: '2026-09-11', cents: -2_500, kind: 'expense' }),
      cashEvent({ id: 'cancelled-expense', date: '2026-09-10', cents: -8_000, kind: 'expense', cancelled: true }),
      cashEvent({ id: 'future', date: '2026-09-13', cents: -6_000, kind: 'expense', reflectedInBalance: true }),
    ] }), 0);

    expect(result.recentDepositsCents).toBe(8_000);
    expect(result.recentWithdrawalsCents).toBe(2_500);
  });

  it('projects account metadata, rewards, and cloned sorted coverage sources', () => {
    const value = snapshot({
      accountType: 'Checking',
      accountNickname: 'Daily checking',
      accountLast4: '3456',
      rewardsPoints: 17,
      complete: false,
      stale: true,
    });

    const result = buildFinancialInsights(value, 0);
    value.sources!.push('/later-mutation');

    expect(result.account).toEqual({ type: 'Checking', nickname: 'Daily checking', last4: '3456' });
    expect(result.rewardsPoints).toBe(17);
    expect(result.coverage).toEqual({
      mode: 'live-sandbox',
      complete: false,
      stale: true,
      sources: ['/accounts', '/bills', '/withdrawals'],
    });
    expect(result.highlights).toEqual(expect.arrayContaining([
      expect.stringMatching(/incomplete/i),
      expect.stringMatching(/stale/i),
      expect.stringMatching(/17 reward/i),
    ]));
  });

  it('returns null rewards and an empty account object when metadata is absent', () => {
    const result = buildFinancialInsights(snapshot({ mode: 'synthetic', sources: undefined }), 0);

    expect(result.rewardsPoints).toBeNull();
    expect(result.account).toEqual({});
    expect(result.coverage.sources).toEqual([]);
  });

  it('emits bounded deterministic highlights for negative and low projections', () => {
    const negative = snapshot({
      balanceCents: 1_000,
      events: [cashEvent({ id: 'bill', date: '2026-09-13', cents: -2_000, label: 'Rent', kind: 'bill' })],
    });
    const low = snapshot({ balanceCents: 10_000 });

    const first = buildFinancialInsights(negative, 0);
    const second = buildFinancialInsights(negative, 0);
    const lowResult = buildFinancialInsights(low, 10_000);

    expect(first.highlights).toEqual(second.highlights);
    expect(first.highlights.length).toBeLessThanOrEqual(8);
    expect(first.highlights).toEqual(expect.arrayContaining([
      expect.stringMatching(/negative/i),
      expect.stringMatching(/next bill.*Rent/i),
    ]));
    expect(lowResult.highlights).toEqual(expect.arrayContaining([expect.stringMatching(/safe to spend.*\$0\.00/i)]));
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid reserve %s',
    reserve => expect(() => buildFinancialInsights(snapshot(), reserve)).toThrow(/reserve.*safe integer/i),
  );
});
