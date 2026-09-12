import { describe, expect, it } from 'vitest';

import { normalizeEvents } from '../../src/domain/events';
import {
  normalizeNessieSnapshot,
  toCents,
  type NessieAccount,
  type NessieBill,
  type NessieDeposit,
  type NessieLoan,
  type NessieWithdrawal,
} from '../../src/service/providers/nessie-normalize';

const account: NessieAccount = {
  _id: 'nessie-account-1',
  balance: 120.5,
  rewards: 17,
  type: 'Checking',
  nickname: 'Daily checking',
  account_number: '1234567890123456',
  customer_id: 'customer-1',
};

const input = (overrides: Partial<Parameters<typeof normalizeNessieSnapshot>[0]> = {}) => ({
  accountId: 'cappy-account-1',
  account,
  bills: [] as NessieBill[],
  deposits: [] as NessieDeposit[],
  withdrawals: [] as NessieWithdrawal[],
  loans: [] as NessieLoan[],
  complete: true,
  sourceEndpoints: ['/accounts/a1/loans', '/accounts/a1', '/accounts/a1/loans'],
  ...overrides,
});

const options = {
  amountUnit: 'dollars' as const,
  today: '2026-09-12',
  timezone: 'America/Chicago',
  now: () => '2026-09-12T16:30:00.000Z',
};

describe('toCents', () => {
  it('converts dollar amounts and preserves cent amounts', () => {
    expect(toCents(120.5, 'dollars')).toBe(12050);
    expect(toCents(12050, 'cents')).toBe(12050);
  });

  it('rejects unsupported amount units at runtime', () => {
    expect(() => toCents(12050, 'euros' as never)).toThrow(/amount unit/i);
  });

  it.each([
    [Number.NaN, 'dollars'],
    [Number.POSITIVE_INFINITY, 'dollars'],
    [-1, 'dollars'],
    [1.005, 'dollars'],
    [1.5, 'cents'],
    [Number.MAX_SAFE_INTEGER, 'dollars'],
  ] as const)('rejects unsafe money value %s in %s', (value, unit) => {
    expect(() => toCents(value, unit)).toThrow(/finite nonnegative amount|safe integer cents/i);
  });
});

describe('normalizeNessieSnapshot', () => {
  it('builds a validated live snapshot with deterministic provenance', () => {
    const result = normalizeNessieSnapshot(input({ complete: false }), options);

    expect(result).toMatchObject({
      accountId: 'cappy-account-1',
      balanceCents: 12050,
      currency: 'USD',
      asOf: '2026-09-12T16:30:00.000Z',
      today: '2026-09-12',
      timezone: 'America/Chicago',
      mode: 'live-sandbox',
      complete: false,
      stale: false,
      sources: ['/accounts/a1', '/accounts/a1/loans'],
      accountType: 'Checking',
      accountNickname: 'Daily checking',
      accountLast4: '3456',
      rewardsPoints: 17,
    });
  });

  it('maps deposits, withdrawals, bills, and loans to signed domain events', () => {
    const result = normalizeNessieSnapshot(input({
      deposits: [{
        _id: 'deposit-1', medium: 'balance', transaction_date: '2026-09-13',
        status: 'pending', amount: 25, description: 'Payroll',
      }],
      withdrawals: [{
        _id: 'withdrawal-1', medium: 'balance', transaction_date: '2026-09-14',
        status: 'pending', amount: 7.25, description: 'Groceries',
      }],
      bills: [{
        _id: 'bill-1', status: 'pending', payee: 'Power Co', nickname: 'Electric',
        payment_date: '2026-08-15', upcoming_payment_date: '2026-09-15',
        payment_amount: 40, account_id: 'nessie-account-1',
      }],
      loans: [{
        _id: 'loan-1', status: 'current', monthly_payment: 100, amount: 1200,
        description: 'Student loan', creation_date: '2026-08-16', type: 'student', credit_score: 720,
      }],
    }), options);

    expect(result.events).toEqual([
      expect.objectContaining({ sourceId: 'deposit-1', date: '2026-09-13', cents: 2500, label: 'Payroll', kind: 'income' }),
      expect.objectContaining({ sourceId: 'withdrawal-1', date: '2026-09-14', cents: -725, label: 'Groceries', kind: 'expense' }),
      expect.objectContaining({ sourceId: 'bill-1', date: '2026-09-15', cents: -4000, label: 'Electric', kind: 'bill' }),
      expect.objectContaining({ sourceId: 'loan-1', date: '2026-08-16', cents: -10000, label: 'Student loan', kind: 'bill', recurrence: 'monthly' }),
    ]);
  });

  it('preserves monthly bill recurrence and excludes cancelled bills during event normalization', () => {
    const result = normalizeNessieSnapshot(input({
      bills: [{
        _id: 'recurring-bill', status: 'recurring', payee: 'Landlord', nickname: 'Rent',
        payment_date: '2026-08-01', upcoming_payment_date: '2026-09-13', recurring_date: 13,
        payment_amount: 60, account_id: 'nessie-account-1',
      }, {
        _id: 'cancelled-bill', status: 'cancelled', payee: 'Old gym', nickname: 'Gym',
        payment_date: '2026-09-14', payment_amount: 9, account_id: 'nessie-account-1',
      }],
    }), options);

    expect(result.events).toEqual([
      expect.objectContaining({ sourceId: 'recurring-bill', confidence: 'scheduled', cancelled: false, recurrence: 'monthly' }),
      expect.objectContaining({ sourceId: 'cancelled-bill', confidence: 'unconfirmed', cancelled: true }),
    ]);
    expect(normalizeEvents(result.events, options.today).map(event => event.sourceId)).toEqual(['recurring-bill']);
  });

  it('uses recurring_date as the monthly anchor when no upcoming payment date exists', () => {
    const result = normalizeNessieSnapshot(input({
      bills: [{
        _id: 'recurring-bill', status: 'recurring', payee: 'Landlord', nickname: 'Rent',
        payment_date: '2026-08-01', recurring_date: 13,
        payment_amount: 60, account_id: 'nessie-account-1',
      }],
    }), options);

    expect(result.events[0]).toMatchObject({ date: '2026-08-13', recurrence: 'monthly' });
  });

  it('rejects a recurring day that cannot form a valid anchor date', () => {
    expect(() => normalizeNessieSnapshot(input({
      bills: [{
        _id: 'invalid-recurring-bill', status: 'recurring', payee: 'Landlord',
        payment_date: '2026-02-01', recurring_date: 31,
        payment_amount: 60, account_id: 'nessie-account-1',
      }],
    }), options)).toThrow(/recurring date/i);
  });

  it('keeps unknown and rejected bill or loan statuses out of forecasts', () => {
    const result = normalizeNessieSnapshot(input({
      bills: [{
        _id: 'unknown-bill', status: 'mystery', payee: 'Unknown bill',
        payment_date: '2026-09-13', payment_amount: 10, account_id: 'nessie-account-1',
      }, {
        _id: 'rejected-bill', status: 'rejected', payee: 'Rejected bill',
        payment_date: '2026-09-13', payment_amount: 10, account_id: 'nessie-account-1',
      }],
      loans: [{
        _id: 'unknown-loan', status: 'mystery', monthly_payment: 10, amount: 100,
        description: 'Unknown loan', creation_date: '2026-09-13',
      }, {
        _id: 'rejected-loan', status: 'rejected', monthly_payment: 10, amount: 100,
        description: 'Rejected loan', creation_date: '2026-09-13',
      }],
    }), options);

    expect(result.events.map(({ sourceId, confidence, cancelled }) => ({ sourceId, confidence, cancelled })))
      .toEqual([
        { sourceId: 'unknown-bill', confidence: 'unconfirmed', cancelled: false },
        { sourceId: 'rejected-bill', confidence: 'unconfirmed', cancelled: true },
        { sourceId: 'unknown-loan', confidence: 'unconfirmed', cancelled: false },
        { sourceId: 'rejected-loan', confidence: 'unconfirmed', cancelled: true },
      ]);
    expect(normalizeEvents(result.events, options.today)).toEqual([]);
  });

  it('marks completed transactions as reflected in the account balance', () => {
    const result = normalizeNessieSnapshot(input({
      deposits: [{
        _id: 'posted-deposit', medium: 'balance', transaction_date: '2026-09-13',
        status: 'completed', amount: 25, description: 'Posted deposit',
      }],
      withdrawals: [{
        _id: 'posted-withdrawal', medium: 'balance', transaction_date: '2026-09-13',
        status: 'completed', amount: 10, description: 'Posted withdrawal',
      }],
    }), options);

    expect(result.events.map(event => event.reflectedInBalance)).toEqual([true, true]);
    expect(normalizeEvents(result.events, options.today)).toEqual([]);
  });

  it.each([
    { balance: -1 },
    { balance: Number.NaN },
    { balance: Number.POSITIVE_INFINITY },
  ])('rejects invalid account balance $balance', balance => {
    expect(() => normalizeNessieSnapshot(input({ account: { ...account, ...balance } }), options))
      .toThrow(/balance|finite nonnegative amount/i);
  });

  it('rejects invalid event money and impossible ISO dates', () => {
    expect(() => normalizeNessieSnapshot(input({
      deposits: [{
        _id: 'bad-money', medium: 'balance', transaction_date: '2026-09-13',
        status: 'pending', amount: -1, description: 'Bad deposit',
      }],
    }), options)).toThrow(/amount|finite nonnegative/i);

    expect(() => normalizeNessieSnapshot(input({
      withdrawals: [{
        _id: 'bad-date', medium: 'balance', transaction_date: '2026-02-30',
        status: 'pending', amount: 1, description: 'Bad date',
      }],
    }), options)).toThrow(/valid ISO date/i);
  });

  it('validates snapshot dates and timezone through the domain contract', () => {
    expect(() => normalizeNessieSnapshot(input(), { ...options, today: '2026-02-30' }))
      .toThrow(/valid ISO date/i);
    expect(() => normalizeNessieSnapshot(input(), { ...options, timezone: 'Moon/Base-1' }))
      .toThrow(/timezone/i);
    expect(() => normalizeNessieSnapshot(input(), { ...options, now: () => 'not-a-timestamp' }))
      .toThrow(/timestamp/i);
  });

  it('omits full account numbers from snapshots and event labels', () => {
    const result = normalizeNessieSnapshot(input({
      bills: [{
        _id: 'bill-1', status: 'pending', payee: 'Visa 1234567890123456',
        payment_date: '2026-09-15', payment_amount: 40, account_id: 'nessie-account-1',
      }],
    }), options);

    expect(JSON.stringify(result)).not.toContain('1234567890123456');
    expect(result.events[0].label).toBe('Bill');
  });

  it('omits an account nickname that contains the full account number', () => {
    const result = normalizeNessieSnapshot(input({
      account: { ...account, nickname: 'Checking 1234567890123456' },
    }), options);

    expect(result.accountNickname).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('1234567890123456');
  });

  it('redacts formatted account numbers and long digit sequences from labels', () => {
    const result = normalizeNessieSnapshot(input({
      bills: [{
        _id: 'formatted-account', status: 'pending', nickname: 'Visa 1234-5678-9012-3456',
        payment_date: '2026-09-15', payment_amount: 40, account_id: 'nessie-account-1',
      }],
      loans: [{
        _id: 'numeric-reference', status: 'current', monthly_payment: 10, amount: 100,
        description: 'Loan reference 9876543210', creation_date: '2026-09-13',
      }],
    }), options);

    expect(result.events.map(event => event.label)).toEqual(['Bill', 'Loan payment']);
    expect(JSON.stringify(result.events)).not.toMatch(/1234-5678-9012-3456|9876543210/);
  });
});
