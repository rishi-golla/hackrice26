// Verified against the live Nessie sandbox API on 2026-09-12: a real customer,
// checking account, two bills and a deposit were created and read back through
// https://api.nessieisreal.com (see docs/provider-contracts.md for the full
// evidence trail and exact request/response pairs, IDs redacted). Field names
// and enum values below are taken from those live responses and from Capital
// One's own nessie-javascript-sdk source, not invented.
import type { CashEvent, Snapshot } from '../../domain/types';
import type { SnapshotProvider } from '../snapshot';
import { ProviderUnavailableError } from './speech';

// Confirmed via a live 400 validation error from the API itself:
// "permitted: 'pending', 'cancelled', 'completed', 'recurring'".
const ACTIVE_BILL_STATUSES = new Set(['pending', 'recurring']);
// Deposits: the API accepts any string for `status` (no server-side enum,
// confirmed by posting an unrecognized value and having it accepted). Only
// allowlist the two values bills confirmed mean "still upcoming"; anything
// else (completed, cancelled, unrecognized) is excluded rather than guessed.
const ACTIVE_DEPOSIT_STATUSES = new Set(['pending', 'recurring']);
// Confirmed live: creating an account with "type":"Checking" round-trips
// unchanged. Savings is documented in the SDK as a sibling liquid type;
// Credit Card is excluded as non-liquid per the product spec.
const LIQUID_ACCOUNT_TYPES = new Set(['Checking', 'Savings']);

type NessieAccount = { _id?: unknown; type?: unknown; nickname?: unknown; balance?: unknown };
type NessieBill = {
  _id?: unknown; status?: unknown; payee?: unknown; nickname?: unknown;
  payment_date?: unknown; upcoming_payment_date?: unknown; recurring_date?: unknown; payment_amount?: unknown;
};
type NessieDeposit = { _id?: unknown; status?: unknown; transaction_date?: unknown; amount?: unknown; description?: unknown };

export type NessieProviderOptions = {
  apiKey?: string;
  baseUrl?: string;
  timezone?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * Nessie sends whole-dollar amounts (e.g. `"balance": 800` for $800.00),
 * confirmed live by round-tripping known values through account/bill/deposit
 * creation. Converts to integer cents without float drift; rejects anything
 * with more precision than two decimal places instead of silently rounding
 * away real money.
 */
function dollarsToCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Nessie ${field} must be a finite number`);
  const scaled = value * 100;
  const cents = Math.round(scaled);
  if (Math.abs(scaled - cents) > 1e-6) throw new Error(`Nessie ${field} has unsupported sub-cent precision`);
  if (!Number.isSafeInteger(cents)) throw new Error(`Nessie ${field} is out of a safe integer range`);
  return cents;
}

function todayInTimeZone(timezone: string, now: () => number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now()));
  const lookup = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>;
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

async function fetchNessieJson(fetcher: typeof fetch, url: string, timeoutMs: number, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`Nessie ${label} timed out`);
    throw new Error(`Nessie ${label} request failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new Error(`Nessie ${label} failed with HTTP ${response.status}`);
  return response.json();
}

/**
 * Translates verified Nessie fields into a Snapshot. Fails closed: an
 * unrecognized bill/deposit status, a non-liquid account type, or a
 * malformed monetary field marks the snapshot incomplete (or, for the
 * account read itself, throws) rather than guessing a value or silently
 * treating missing data as zero.
 */
export function createNessieProvider(options: NessieProviderOptions): SnapshotProvider {
  const baseUrl = options.baseUrl ?? 'https://api.nessieisreal.com';
  const timezone = options.timezone ?? 'America/Chicago';
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetcher = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;

  return {
    async read(accountId: string): Promise<Snapshot> {
      if (!options.apiKey) throw new ProviderUnavailableError('Nessie unavailable: API key missing');
      const key = encodeURIComponent(options.apiKey);
      const id = encodeURIComponent(accountId);

      const account = await fetchNessieJson(fetcher, `${baseUrl}/accounts/${id}?key=${key}`, timeoutMs, 'account read') as NessieAccount;
      if (typeof account._id !== 'string' || account._id !== accountId) {
        throw new Error('Nessie account read returned a missing or mismatched account id');
      }
      if (typeof account.type !== 'string' || !LIQUID_ACCOUNT_TYPES.has(account.type)) {
        throw new Error(`Nessie account type "${String(account.type)}" is not a supported liquid checking/savings account`);
      }
      const balanceCents = dollarsToCents(account.balance, 'account.balance');

      const [billsRaw, depositsRaw] = await Promise.all([
        fetchNessieJson(fetcher, `${baseUrl}/accounts/${id}/bills?key=${key}`, timeoutMs, 'bills read'),
        fetchNessieJson(fetcher, `${baseUrl}/accounts/${id}/deposits?key=${key}`, timeoutMs, 'deposits read'),
      ]);
      if (!Array.isArray(billsRaw)) throw new Error('Nessie bills read returned an unexpected shape');
      if (!Array.isArray(depositsRaw)) throw new Error('Nessie deposits read returned an unexpected shape');

      const events: CashEvent[] = [];
      let complete = true;

      for (const raw of billsRaw as NessieBill[]) {
        if (typeof raw._id !== 'string' || typeof raw.status !== 'string' || typeof raw.payment_amount !== 'number') {
          complete = false; continue;
        }
        if (raw.status === 'completed') continue; // already paid; assumed already reflected in the current balance
        const cancelled = raw.status === 'cancelled';
        if (!cancelled && !ACTIVE_BILL_STATUSES.has(raw.status)) { complete = false; continue; } // unrecognized status: fail closed, don't guess
        // upcoming_payment_date is server-computed and authoritative for the
        // next occurrence (confirmed live); payment_date is the original
        // anchor and only used if the newer field is somehow absent.
        const date = typeof raw.upcoming_payment_date === 'string' ? raw.upcoming_payment_date
          : typeof raw.payment_date === 'string' ? raw.payment_date : undefined;
        if (!date) { complete = false; continue; }
        let cents: number;
        try { cents = dollarsToCents(raw.payment_amount, 'bill.payment_amount'); }
        catch { complete = false; continue; }
        const label = (typeof raw.nickname === 'string' && raw.nickname) || (typeof raw.payee === 'string' && raw.payee) || 'Bill';
        events.push({
          id: String(raw._id), sourceId: String(raw._id), date, cents: -cents, label,
          kind: 'bill', confidence: 'scheduled', reflectedInBalance: false, cancelled,
          ...(typeof raw.recurring_date === 'number' ? { recurrence: 'monthly' as const } : {}),
        });
      }

      for (const raw of depositsRaw as NessieDeposit[]) {
        if (typeof raw._id !== 'string' || typeof raw.status !== 'string' || typeof raw.amount !== 'number' || typeof raw.transaction_date !== 'string') {
          complete = false; continue;
        }
        // Never extrapolate scheduled income from a completed/historical
        // deposit or an unrecognized status - only a still-upcoming deposit
        // counts as scheduled income.
        if (!ACTIVE_DEPOSIT_STATUSES.has(raw.status)) continue;
        let cents: number;
        try { cents = dollarsToCents(raw.amount, 'deposit.amount'); }
        catch { complete = false; continue; }
        const label = (typeof raw.description === 'string' && raw.description) || 'Scheduled deposit';
        events.push({
          id: String(raw._id), sourceId: String(raw._id), date: raw.transaction_date, cents, label,
          kind: 'income', confidence: 'scheduled', reflectedInBalance: false, cancelled: false,
        });
      }

      return {
        accountId, balanceCents, currency: 'USD',
        asOf: new Date(now()).toISOString(),
        today: todayInTimeZone(timezone, now),
        timezone, mode: 'live-sandbox',
        complete, stale: false,
        events,
      };
    },
  };
}
