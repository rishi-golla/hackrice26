import { addDays } from './calendar';
import { normalizeEvents } from './events';
import { forecast } from './forecast';
import { addCents, assertSafeCents, formatUSD } from './money';
import type { CashEvent, Snapshot } from './types';
import { validateSnapshot } from './types';

export type UpcomingBill = {
  id: string;
  label: string;
  date: string;
  cents: number;
  recurring: boolean;
};

export type ExpectedIncome = {
  id: string;
  label: string;
  date: string;
  cents: number;
};

export type FinancialInsights = {
  balanceCents: number;
  safeToSpendCents: number;
  upcomingBills: UpcomingBill[];
  expectedIncome: ExpectedIncome[];
  recurringOutflowCents: number;
  loanObligationsCents: number;
  rewardsPoints: number | null;
  recentDepositsCents: number;
  recentWithdrawalsCents: number;
  coverage: { complete: boolean; stale: boolean; sources: string[] };
  highlights: string[];
  account: { type?: string; nickname?: string; last4?: string };
};

function absoluteCents(cents: number): number {
  if (cents === Number.MIN_SAFE_INTEGER) {
    throw new Error('Event amount cannot be represented as absolute safe integer cents');
  }
  return Math.abs(cents);
}

function sumEvents(events: CashEvent[]): number {
  return events.reduce((total, event) => addCents(total, absoluteCents(event.cents)), 0);
}

function isLoan(event: CashEvent): boolean {
  return event.sourceId.startsWith('nessie:loan:') || event.id.startsWith('nessie:loan:');
}

function recentTotals(snapshot: Snapshot): { deposits: number; withdrawals: number } {
  const start = addDays(snapshot.today, -30);
  let deposits = 0;
  let withdrawals = 0;

  for (const event of snapshot.events) {
    if (
      event.cancelled
      || event.date < start
      || event.date > snapshot.today
      || (!event.reflectedInBalance && event.date === snapshot.today)
    ) continue;

    if (event.kind === 'income') deposits = addCents(deposits, absoluteCents(event.cents));
    if (event.kind === 'expense') withdrawals = addCents(withdrawals, absoluteCents(event.cents));
  }

  return { deposits, withdrawals };
}

function buildHighlights(
  projection: ReturnType<typeof forecast>,
  reserveCents: number,
  bills: UpcomingBill[],
  income: ExpectedIncome[],
  recurringOutflowCents: number,
  loanObligationsCents: number,
  rewardsPoints: number | null,
  snapshot: Snapshot,
): string[] {
  const highlights: string[] = [];

  if (projection.minimumCents < 0) {
    highlights.push(`Projected balance is negative (${formatUSD(projection.minimumCents)}) on ${projection.minimumDate}.`);
  } else if (projection.safeToSpendCents === 0) {
    highlights.push(`Safe to spend is $0.00 after the ${formatUSD(reserveCents)} reserve.`);
  }
  if (bills[0]) {
    highlights.push(`Next bill: ${bills[0].label}, ${formatUSD(bills[0].cents)} on ${bills[0].date}.`);
  }
  if (income[0]) {
    highlights.push(`Expected income: ${income[0].label}, ${formatUSD(income[0].cents)} on ${income[0].date}.`);
  }
  if (recurringOutflowCents > 0) {
    highlights.push(`Recurring outflow in the next 14 days: ${formatUSD(recurringOutflowCents)}.`);
  }
  if (loanObligationsCents > 0) {
    highlights.push(`Loan obligations in the next 14 days: ${formatUSD(loanObligationsCents)}.`);
  }
  if (rewardsPoints !== null) highlights.push(`${rewardsPoints} reward points available.`);
  if (!snapshot.complete) highlights.push('Coverage is incomplete; some account activity may be missing.');
  if (snapshot.stale) highlights.push(`Coverage is stale as of ${snapshot.asOf}.`);

  return highlights.slice(0, 8);
}

export function buildFinancialInsights(rawSnapshot: Snapshot, reserveCents: number): FinancialInsights {
  const snapshot = validateSnapshot(rawSnapshot);
  assertSafeCents(reserveCents, 'Reserve', { nonnegative: true });

  const projection = forecast(snapshot, 0, reserveCents);
  const events = normalizeEvents(snapshot.events, snapshot.today);
  const billEvents = events.filter(event => event.kind === 'bill');
  const incomeEvents = events.filter(event => event.kind === 'income' && event.confidence === 'scheduled');
  const recurringOutflowCents = sumEvents(events.filter(event => (
    event.recurrence === 'monthly' && (event.kind === 'bill' || event.kind === 'expense')
  )));
  const loanObligationsCents = sumEvents(events.filter(isLoan));
  const upcomingBills = billEvents.map(event => ({
    id: event.id,
    label: event.label,
    date: event.date,
    cents: absoluteCents(event.cents),
    recurring: event.recurrence === 'monthly',
  }));
  const expectedIncome = incomeEvents.map(event => ({
    id: event.id,
    label: event.label,
    date: event.date,
    cents: absoluteCents(event.cents),
  }));
  const recent = recentTotals(snapshot);
  const rewardsPoints = snapshot.rewardsPoints ?? null;

  return {
    balanceCents: snapshot.balanceCents,
    safeToSpendCents: projection.safeToSpendCents,
    upcomingBills,
    expectedIncome,
    recurringOutflowCents,
    loanObligationsCents,
    rewardsPoints,
    recentDepositsCents: recent.deposits,
    recentWithdrawalsCents: recent.withdrawals,
    coverage: {
      complete: snapshot.complete,
      stale: snapshot.stale,
      sources: [...(snapshot.sources ?? [])].sort(),
    },
    highlights: buildHighlights(
      projection,
      reserveCents,
      upcomingBills,
      expectedIncome,
      recurringOutflowCents,
      loanObligationsCents,
      rewardsPoints,
      snapshot,
    ),
    account: {
      ...(snapshot.accountType ? { type: snapshot.accountType } : {}),
      ...(snapshot.accountNickname ? { nickname: snapshot.accountNickname } : {}),
      ...(snapshot.accountLast4 ? { last4: snapshot.accountLast4 } : {}),
    },
  };
}
