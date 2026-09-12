import { isISODate } from './calendar';

export type DataMode = 'live-sandbox' | 'recorded-sandbox' | 'synthetic';

export type CashEvent = {
  id: string;
  sourceId: string;
  date: string;
  cents: number;
  label: string;
  kind: 'bill' | 'income' | 'transfer' | 'expense';
  confidence: 'scheduled' | 'user-entered' | 'unconfirmed';
  reflectedInBalance: boolean;
  cancelled: boolean;
  recurrence?: 'monthly';
};

export type Snapshot = {
  accountId: string;
  balanceCents: number;
  currency: 'USD';
  asOf: string;
  today: string;
  timezone: string;
  mode: DataMode;
  complete: boolean;
  stale: boolean;
  sources?: string[];
  events: CashEvent[];
};

export type DayPoint = {
  date: string;
  openingCents: number;
  lowCents: number;
  closingCents: number;
};

export type Forecast = {
  baseline: DayPoint[];
  afterPurchase: DayPoint[];
  minimumCents: number;
  minimumDate: string;
  baselineMinimumCents: number;
  safeToSpendCents: number;
  purchaseCents: number;
  reserveCents: number;
  status: 'negative' | 'below-reserve' | 'within-reserve';
  complete: boolean;
  stale: boolean;
  reasons: string[];
};

export type HypotheticalPurchase = {
  id: string;
  label: string;
  cents: number;
  date: string;
};

const modes: DataMode[] = ['live-sandbox', 'recorded-sandbox', 'synthetic'];
const kinds: CashEvent['kind'][] = ['bill', 'income', 'transfer', 'expense'];
const confidences: CashEvent['confidence'][] = ['scheduled', 'user-entered', 'unconfirmed'];

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty string`);
}

function safeInteger(value: unknown, name: string): asserts value is number {
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer`);
}

export function validateCashEvent(value: unknown): CashEvent {
  const input = record(value, 'CashEvent');
  nonEmptyString(input.id, 'CashEvent.id');
  nonEmptyString(input.sourceId, 'CashEvent.sourceId');
  if (!isISODate(input.date)) throw new Error('CashEvent.date must be a valid ISO date');
  safeInteger(input.cents, 'CashEvent.cents');
  if (input.cents === 0) throw new Error('CashEvent.cents must be non-zero');
  nonEmptyString(input.label, 'CashEvent.label');
  if (!kinds.includes(input.kind as CashEvent['kind'])) throw new Error('CashEvent.kind is unsupported');
  if (!confidences.includes(input.confidence as CashEvent['confidence'])) {
    throw new Error('CashEvent.confidence is unsupported');
  }
  if (typeof input.reflectedInBalance !== 'boolean') throw new Error('CashEvent.reflectedInBalance must be boolean');
  if (typeof input.cancelled !== 'boolean') throw new Error('CashEvent.cancelled must be boolean');
  if (input.recurrence !== undefined && input.recurrence !== 'monthly') {
    throw new Error('CashEvent.recurrence is unsupported');
  }
  return { ...input } as CashEvent;
}

export function validateSnapshot(value: unknown): Snapshot {
  const input = record(value, 'Snapshot');
  nonEmptyString(input.accountId, 'Snapshot.accountId');
  safeInteger(input.balanceCents, 'Snapshot.balanceCents');
  if (input.currency !== 'USD') throw new Error('Snapshot.currency must be USD');
  nonEmptyString(input.asOf, 'Snapshot.asOf');
  if (!Number.isFinite(Date.parse(input.asOf))) throw new Error('Snapshot.asOf must be a valid timestamp');
  if (!isISODate(input.today)) throw new Error('Snapshot.today must be a valid ISO date');
  nonEmptyString(input.timezone, 'Snapshot.timezone');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format(0);
  } catch {
    throw new Error('Snapshot.timezone is invalid');
  }
  if (!modes.includes(input.mode as DataMode)) throw new Error('Snapshot.mode is unsupported');
  if (typeof input.complete !== 'boolean') throw new Error('Snapshot.complete must be boolean');
  if (typeof input.stale !== 'boolean') throw new Error('Snapshot.stale must be boolean');
  if (input.sources !== undefined) {
    if (!Array.isArray(input.sources)) throw new Error('Snapshot.sources must be an array');
    input.sources.forEach(source => nonEmptyString(source, 'Snapshot.sources entry'));
  }
  if (!Array.isArray(input.events)) throw new Error('Snapshot.events must be an array');

  return {
    ...input,
    events: input.events.map(validateCashEvent),
  } as Snapshot;
}
