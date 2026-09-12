import type { SnapshotProvider } from '../snapshot';
import { NessieClient } from './nessie';
import {
  normalizeNessieSnapshot,
  type NessieAccount,
  type NessieAmountUnit,
  type NessieBill,
  type NessieDeposit,
  type NessieLoan,
  type NessieWithdrawal,
} from './nessie-normalize';

export interface NessieClientLike {
  getCustomer(id: string): Promise<unknown>;
  getCustomerAccounts(id: string): Promise<unknown>;
  getCustomerBills(id: string): Promise<unknown>;
  getAccount(id: string): Promise<unknown>;
  getAccountBills(id: string): Promise<unknown>;
  getAccountDeposits(id: string): Promise<unknown>;
  getAccountWithdrawals(id: string): Promise<unknown>;
  getAccountLoans(id: string): Promise<unknown>;
}

export type NessieSnapshotProviderOptions = {
  client: NessieClientLike;
  customerId: string;
  cappyAccountId: string;
  nessieAccountId?: string;
  amountUnit: NessieAmountUnit;
  timezone: string;
  today?: () => string;
  now?: () => string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Nessie ${label} response must be an object`);
  }
  return value as RecordValue;
}

function records(value: unknown, label: string): RecordValue[] {
  if (!Array.isArray(value)) throw new Error(`Nessie ${label} response must be an array`);
  return value.map(item => record(item, label));
}

function localDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function createNessieSnapshotProvider(options: NessieSnapshotProviderOptions): SnapshotProvider {
  return {
    async read(accountId) {
      if (accountId !== options.cappyAccountId) throw new Error('Unexpected Cappy account id');

      const customer = record(await options.client.getCustomer(options.customerId), 'customer');
      if (customer._id !== options.customerId) throw new Error('Nessie customer identity mismatch');

      const customerAccounts = records(
        await options.client.getCustomerAccounts(options.customerId),
        'customer accounts',
      );
      const selected = options.nessieAccountId
        ? customerAccounts.find(candidate => candidate._id === options.nessieAccountId)
        : customerAccounts[0];
      if (!selected || typeof selected._id !== 'string' || selected._id.trim() === '') {
        throw new Error('Nessie customer has no matching account');
      }
      const nessieAccountId = selected._id;
      const account = record(await options.client.getAccount(nessieAccountId), 'account');
      if (account._id !== nessieAccountId) throw new Error('Nessie account identity mismatch');
      if (account.customer_id !== undefined && account.customer_id !== options.customerId) {
        throw new Error('Nessie account customer identity mismatch');
      }

      const optional = await Promise.allSettled([
        options.client.getAccountBills(nessieAccountId),
        options.client.getCustomerBills(options.customerId),
        options.client.getAccountDeposits(nessieAccountId),
        options.client.getAccountWithdrawals(nessieAccountId),
        options.client.getAccountLoans(nessieAccountId),
      ]);
      const successful = <T>(index: number, label: string): T[] => optional[index].status === 'fulfilled'
        ? records(optional[index].value, label) as T[]
        : [];
      const accountBills = successful<NessieBill>(0, 'account bills');
      const customerBills = successful<NessieBill>(1, 'customer bills')
        .filter(candidate => candidate.account_id === nessieAccountId);
      const bills = [...new Map(
        [...accountBills, ...customerBills].map(candidate => [candidate._id, candidate]),
      ).values()];
      const sourceEndpoints = [
        `/customers/${options.customerId}`,
        `/customers/${options.customerId}/accounts`,
        `/accounts/${nessieAccountId}`,
        ...(optional[0].status === 'fulfilled' ? [`/accounts/${nessieAccountId}/bills`] : []),
        ...(optional[1].status === 'fulfilled' ? [`/customers/${options.customerId}/bills`] : []),
        ...(optional[2].status === 'fulfilled' ? [`/accounts/${nessieAccountId}/deposits`] : []),
        ...(optional[3].status === 'fulfilled' ? [`/accounts/${nessieAccountId}/withdrawals`] : []),
        ...(optional[4].status === 'fulfilled' ? [`/accounts/${nessieAccountId}/loans`] : []),
      ];

      return normalizeNessieSnapshot({
        accountId,
        account: account as NessieAccount,
        bills,
        deposits: successful<NessieDeposit>(2, 'account deposits'),
        withdrawals: successful<NessieWithdrawal>(3, 'account withdrawals'),
        loans: successful<NessieLoan>(4, 'account loans'),
        complete: optional.every(result => result.status === 'fulfilled'),
        sourceEndpoints,
      }, {
        amountUnit: options.amountUnit,
        timezone: options.timezone,
        today: options.today?.() ?? localDate(options.timezone),
        now: options.now,
      });
    },
  };
}

function required(environment: Record<string, string | undefined>, name: string, label: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Nessie ${label} is required`);
  return value;
}

function integer(
  environment: Record<string, string | undefined>,
  name: string,
  fallback: number,
  minimum: number,
  label: string,
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`Nessie ${label} must be a safe integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`Nessie ${label} must be a safe integer`);
  return value;
}

function timezone(environment: Record<string, string | undefined>): string {
  const value = environment.CAPPY_TIMEZONE?.trim() || 'America/Chicago';
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0); }
  catch { throw new Error('Cappy timezone is invalid'); }
  return value;
}

export function readNessieCacheTtlMs(environment: Record<string, string | undefined> = process.env): number {
  return integer(environment, 'NESSIE_CACHE_TTL_MS', 60_000, 0, 'cache TTL');
}

export function createNessieFromEnv(
  environment: Record<string, string | undefined> = process.env,
): { provider: SnapshotProvider; accountIds: string[]; customerId: string } {
  if (environment.FLICKY_DATA_MODE !== 'live-sandbox') {
    throw new Error('Nessie provider requires FLICKY_DATA_MODE=live-sandbox');
  }
  const apiKey = required(environment, 'NESSIE_API_KEY', 'API key');
  const customerId = required(environment, 'NESSIE_CUSTOMER_ID', 'customer id');
  const amountUnit = environment.NESSIE_AMOUNT_UNIT;
  if (amountUnit !== 'dollars' && amountUnit !== 'cents') throw new Error('Nessie amount unit must be dollars or cents');
  const timeoutMs = integer(environment, 'NESSIE_TIMEOUT_MS', 10_000, 1, 'timeout');
  const retryCount = integer(environment, 'NESSIE_RETRY_COUNT', 2, 0, 'retry count');
  readNessieCacheTtlMs(environment);
  const cappyAccountId = 'demo-checking';
  const client = new NessieClient({
    apiKey,
    baseUrl: environment.NESSIE_BASE_URL?.trim() || 'https://prod-api.nessieisreal.com',
    timeoutMs,
    retryCount,
  });
  return {
    provider: createNessieSnapshotProvider({
      client,
      customerId,
      cappyAccountId,
      nessieAccountId: environment.NESSIE_ACCOUNT_ID?.trim() || undefined,
      amountUnit,
      timezone: timezone(environment),
    }),
    accountIds: [cappyAccountId],
    customerId,
  };
}
