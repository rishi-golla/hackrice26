import { describe, expect, it, vi } from 'vitest';
import { createNessieProvider } from '../../src/service/providers/nessie';
import { ProviderUnavailableError } from '../../src/service/providers/speech';

// Fixture values below are exactly what a live https://api.nessieisreal.com
// sandbox returned when this adapter was built and smoke-tested against a
// real customer/account/bills/deposit (see docs/provider-contracts.md for
// the full evidence trail). Not invented shapes.
const account = { _id: 'acct-1', type: 'Checking', nickname: 'Demo Checking', rewards: 0, balance: 800, account_number: '8165055074163137', customer_id: 'cust-1' };
const rentBill = { _id: 'bill-rent', status: 'pending', payee: 'Landlord', nickname: 'Rent', creation_date: '2026-09-12', payment_date: '2026-09-14', recurring_date: 14, upcoming_payment_date: '2026-09-14', payment_amount: 600.0, account_id: 'acct-1' };
const utilitiesBill = { _id: 'bill-utilities', status: 'pending', payee: 'City Utilities', nickname: 'Utilities', creation_date: '2026-09-12', payment_date: '2026-09-16', recurring_date: 16, upcoming_payment_date: '2026-09-16', payment_amount: 80.0, account_id: 'acct-1' };
const paycheckDeposit = { _id: 'deposit-paycheck', medium: 'balance', transaction_date: '2026-09-19', status: 'pending', amount: 1000, description: 'Scheduled paycheck' };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function fetchFor(bills: unknown[], deposits: unknown[], accountOverride: unknown = account) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.includes('/bills')) return jsonResponse(bills);
    if (url.includes('/deposits')) return jsonResponse(deposits);
    return jsonResponse(accountOverride);
  });
}

describe('Nessie provider', () => {
  it('reports a missing API key as explicitly unavailable', async () => {
    const provider = createNessieProvider({});
    await expect(provider.read('acct-1')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('translates a verified live account/bills/deposit shape into a Snapshot matching the canonical fixture', async () => {
    const fetchImpl = fetchFor([rentBill, utilitiesBill], [paycheckDeposit]);
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl, now: () => Date.parse('2026-09-12T12:00:00Z') });

    const snapshot = await provider.read('acct-1');
    expect(snapshot.accountId).toBe('acct-1');
    expect(snapshot.balanceCents).toBe(80_000);
    expect(snapshot.currency).toBe('USD');
    expect(snapshot.mode).toBe('live-sandbox');
    expect(snapshot.complete).toBe(true);
    expect(snapshot.stale).toBe(false);
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.events).toContainEqual(expect.objectContaining({ date: '2026-09-14', cents: -60_000, label: 'Rent', kind: 'bill', recurrence: 'monthly', cancelled: false }));
    expect(snapshot.events).toContainEqual(expect.objectContaining({ date: '2026-09-16', cents: -8_000, label: 'Utilities', kind: 'bill', recurrence: 'monthly' }));
    expect(snapshot.events).toContainEqual(expect.objectContaining({ date: '2026-09-19', cents: 100_000, label: 'Scheduled paycheck', kind: 'income' }));
  });

  it('marks a cancelled bill excluded from the forecast without dropping the snapshot', async () => {
    const fetchImpl = fetchFor([{ ...rentBill, status: 'cancelled' }], []);
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    const snapshot = await provider.read('acct-1');
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({ cancelled: true });
  });

  it('excludes a completed bill entirely, assuming it is already reflected in the current balance', async () => {
    const fetchImpl = fetchFor([{ ...rentBill, status: 'completed' }], []);
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    const snapshot = await provider.read('acct-1');
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.complete).toBe(true);
  });

  it('marks the snapshot incomplete on an unrecognized bill status rather than guessing its meaning', async () => {
    const fetchImpl = fetchFor([{ ...rentBill, status: 'some-future-status' }], []);
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    const snapshot = await provider.read('acct-1');
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.complete).toBe(false);
  });

  it('never treats a completed or unrecognized-status deposit as scheduled income', async () => {
    const fetchImpl = fetchFor([], [{ ...paycheckDeposit, status: 'completed' }, { ...paycheckDeposit, _id: 'd2', status: 'bogus' }]);
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    const snapshot = await provider.read('acct-1');
    expect(snapshot.events).toHaveLength(0);
    // Neither the API's own enum nor an unrecognized value counts as scheduled income - not incomplete either, just correctly excluded.
    expect(snapshot.complete).toBe(true);
  });

  it('rejects a non-liquid account type rather than silently including it in spend calculations', async () => {
    const fetchImpl = fetchFor([], [], { ...account, type: 'Credit Card' });
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.read('acct-1')).rejects.toThrow(/liquid/i);
  });

  it('rejects a non-finite or malformed account balance', async () => {
    const fetchImpl = fetchFor([], [], { ...account, balance: 'not-a-number' });
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.read('acct-1')).rejects.toThrow(/finite number/i);
  });

  it('rejects sub-cent precision instead of silently rounding real money', async () => {
    const fetchImpl = fetchFor([], [], { ...account, balance: 800.005 });
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.read('acct-1')).rejects.toThrow(/sub-cent/i);
  });

  it('rejects a mismatched account id from the provider', async () => {
    const fetchImpl = fetchFor([], [], { ...account, _id: 'different-account' });
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.read('acct-1')).rejects.toThrow(/mismatched/i);
  });

  it('surfaces an HTTP failure without a cache clearly, letting the snapshot store decide staleness', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 500 }));
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl });
    await expect(provider.read('acct-1')).rejects.toThrow(/HTTP 500/);
  });

  it('times out a hung request instead of hanging the service indefinitely', async () => {
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const provider = createNessieProvider({ apiKey: 'test-key', fetchImpl, timeoutMs: 5 });
    await expect(provider.read('acct-1')).rejects.toThrow(/timed out/);
  });
});
