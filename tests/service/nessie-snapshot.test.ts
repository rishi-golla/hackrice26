import { describe, expect, it } from 'vitest';

import {
  createNessieFromEnv,
  createNessieSnapshotProvider,
  type NessieClientLike,
} from '../../src/service/providers/nessie-snapshot';

const account = {
  _id: 'nessie-checking', balance: 120.5, type: 'Checking', nickname: 'Daily checking',
  account_number: '1234567890123456', customer_id: 'customer-1',
};

const bill = (id: string, accountId = account._id) => ({
  _id: id, status: 'pending', payee: `Payee ${id}`, payment_date: '2026-09-15',
  payment_amount: 10, account_id: accountId,
});

function fakeClient(overrides: Partial<NessieClientLike> = {}): NessieClientLike {
  return {
    getCustomer: async () => ({ _id: 'customer-1' }),
    getCustomerAccounts: async () => [account],
    getCustomerBills: async () => [],
    getAccount: async () => account,
    getAccountBills: async () => [bill('account-bill')],
    getAccountDeposits: async () => [{
      _id: 'deposit-1', medium: 'balance', transaction_date: '2026-09-13',
      status: 'pending', amount: 25, description: 'Payroll',
    }],
    getAccountWithdrawals: async () => [],
    getAccountLoans: async () => [],
    ...overrides,
  };
}

function provider(client: NessieClientLike, nessieAccountId?: string) {
  return createNessieSnapshotProvider({
    client,
    customerId: 'customer-1',
    cappyAccountId: 'demo-checking',
    nessieAccountId,
    amountUnit: 'dollars',
    timezone: 'America/Chicago',
    today: () => '2026-09-12',
    now: () => '2026-09-12T16:30:00.000Z',
  });
}

describe('createNessieSnapshotProvider', () => {
  it('returns a complete live snapshot from the selected account resources', async () => {
    const result = await provider(fakeClient()).read('demo-checking');

    expect(result).toMatchObject({
      accountId: 'demo-checking', balanceCents: 12050, mode: 'live-sandbox',
      complete: true, stale: false, today: '2026-09-12',
    });
    expect(result.events.map(event => event.sourceId)).toEqual(['deposit-1', 'account-bill']);
    expect(result.sources).toEqual([
      '/accounts/nessie-checking',
      '/accounts/nessie-checking/bills',
      '/accounts/nessie-checking/deposits',
      '/accounts/nessie-checking/loans',
      '/accounts/nessie-checking/withdrawals',
      '/customers/customer-1',
      '/customers/customer-1/accounts',
      '/customers/customer-1/bills',
    ]);
  });

  it('uses the configured Nessie account instead of the first customer account', async () => {
    const selected = { ...account, _id: 'configured-account', balance: 42 };
    const client = fakeClient({
      getCustomerAccounts: async () => [{ ...account, _id: 'first-account' }, selected],
      getAccount: async id => id === selected._id ? selected : Promise.reject(new Error('wrong account')),
      getAccountBills: async () => [],
      getAccountDeposits: async () => [],
    });

    const result = await provider(client, selected._id).read('demo-checking');
    expect(result.balanceCents).toBe(4200);
    expect(result.sources).toContain('/accounts/configured-account');
  });

  it('merges both bill surfaces, filters to the account, and deduplicates by id', async () => {
    const client = fakeClient({
      getAccountBills: async () => [bill('shared'), bill('account-only'), bill('foreign-account-bill', 'other')],
      getCustomerBills: async () => [bill('shared'), bill('customer-only'), bill('foreign-customer-bill', 'other')],
      getAccountDeposits: async () => [],
    });

    const result = await provider(client).read('demo-checking');
    expect(result.events.map(event => event.sourceId)).toEqual(['shared', 'account-only', 'customer-only']);
  });

  it('returns explicit partial live data when an optional resource fails', async () => {
    const client = fakeClient({
      getAccountBills: async () => Promise.reject(new Error('bills unavailable')),
      getCustomerBills: async () => [bill('customer-bill')],
      getAccountDeposits: async () => Promise.reject(new Error('deposits unavailable')),
    });

    const result = await provider(client).read('demo-checking');
    expect(result.complete).toBe(false);
    expect(result.mode).toBe('live-sandbox');
    expect(result.events.map(event => event.sourceId)).toEqual(['customer-bill']);
    expect(result.sources).not.toContain('/accounts/nessie-checking/bills');
    expect(result.sources).not.toContain('/accounts/nessie-checking/deposits');
  });

  it('rejects customer, account, and Cappy identity mismatches', async () => {
    await expect(provider(fakeClient({ getCustomer: async () => ({ _id: 'someone-else' }) }))
      .read('demo-checking')).rejects.toThrow(/customer.*mismatch/i);
    await expect(provider(fakeClient({ getAccount: async () => ({ ...account, _id: 'someone-else' }) }))
      .read('demo-checking')).rejects.toThrow(/account.*mismatch/i);
    await expect(provider(fakeClient()).read('renderer-selected-account')).rejects.toThrow(/unexpected Cappy account/i);
  });

  it('never substitutes synthetic data when every optional resource fails', async () => {
    const failed = async () => Promise.reject(new Error('offline'));
    const result = await provider(fakeClient({
      getCustomerBills: failed,
      getAccountBills: failed,
      getAccountDeposits: failed,
      getAccountWithdrawals: failed,
      getAccountLoans: failed,
    })).read('demo-checking');

    expect(result).toMatchObject({
      accountId: 'demo-checking', balanceCents: 12050, mode: 'live-sandbox', complete: false,
    });
    expect(result.events).toEqual([]);
  });
});

describe('createNessieFromEnv', () => {
  const valid = {
    FLICKY_DATA_MODE: 'live-sandbox',
    NESSIE_API_KEY: 'secret',
    NESSIE_CUSTOMER_ID: 'customer-1',
    NESSIE_AMOUNT_UNIT: 'dollars',
  };

  it('creates the compatible demo account mapping from valid live configuration', () => {
    const result = createNessieFromEnv(valid);
    expect(result.accountIds).toEqual(['demo-checking']);
    expect(result.customerId).toBe('customer-1');
    expect(result.provider).toEqual(expect.objectContaining({ read: expect.any(Function) }));
  });

  it.each([
    [{ ...valid, FLICKY_DATA_MODE: 'synthetic' }, /live-sandbox/i],
    [{ ...valid, NESSIE_API_KEY: ' ' }, /API key/i],
    [{ ...valid, NESSIE_CUSTOMER_ID: '' }, /customer id/i],
    [{ ...valid, NESSIE_AMOUNT_UNIT: 'euros' }, /amount unit/i],
    [{ ...valid, NESSIE_AMOUNT_UNIT: ' dollars ' }, /amount unit/i],
    [{ ...valid, NESSIE_TIMEOUT_MS: '0' }, /timeout/i],
    [{ ...valid, NESSIE_RETRY_COUNT: '-1' }, /retry/i],
    [{ ...valid, NESSIE_CACHE_TTL_MS: '-1' }, /cache TTL/i],
    [{ ...valid, CAPPY_TIMEZONE: 'Moon/Base-1' }, /timezone/i],
  ])('rejects invalid live configuration %#', (environment, message) => {
    expect(() => createNessieFromEnv(environment)).toThrow(message);
  });
});
