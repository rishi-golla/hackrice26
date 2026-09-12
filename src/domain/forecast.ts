import { addDays } from './calendar';
import { normalizeEvents, overdueUnreflectedEvents } from './events';
import { addCents, assertSafeCents, formatUSD } from './money';
import type { CashEvent, DayPoint, Forecast, HypotheticalPurchase, Snapshot } from './types';
import { validateSnapshot } from './types';

type WalkEvent = Pick<CashEvent, 'id' | 'date' | 'cents'>;

function walk(snapshot: Snapshot, events: WalkEvent[]): DayPoint[] {
  const byDate = new Map<string, WalkEvent[]>();
  for (const event of events) {
    const dayEvents = byDate.get(event.date) ?? [];
    dayEvents.push(event);
    byDate.set(event.date, dayEvents);
  }

  const points: DayPoint[] = [];
  let balance = snapshot.balanceCents;
  for (let day = 0; day < 14; day += 1) {
    const date = addDays(snapshot.today, day);
    const openingCents = balance;
    let lowCents = balance;
    const dayEvents = (byDate.get(date) ?? []).sort((left, right) => (
      Number(left.cents >= 0) - Number(right.cents >= 0)
      || left.id.localeCompare(right.id)
    ));
    for (const event of dayEvents) {
      balance = addCents(balance, event.cents);
      lowCents = Math.min(lowCents, balance);
    }
    points.push({ date, openingCents, lowCents, closingCents: balance });
  }
  return points;
}

function lowest(points: DayPoint[]): { cents: number; date: string } {
  let result = { cents: points[0].lowCents, date: points[0].date };
  for (const point of points.slice(1)) {
    if (point.lowCents < result.cents) result = { cents: point.lowCents, date: point.date };
  }
  return result;
}

function buildReasons(
  snapshot: Snapshot,
  events: CashEvent[],
  overdue: CashEvent[],
  baselineMinimumCents: number,
  minimumCents: number,
  minimumDate: string,
  reserveCents: number,
): string[] {
  const reasons: string[] = [];
  if (snapshot.stale) reasons.push(`Stale data: the snapshot is from ${snapshot.asOf}.`);
  if (!snapshot.complete || overdue.length > 0) {
    reasons.push('Incomplete forecast: one or more expected obligations may be missing or overdue.');
  }
  for (const event of overdue) {
    reasons.push(`Overdue unreflected obligation "${event.label}" dated ${event.date} was excluded from the balance walk.`);
  }
  if (baselineMinimumCents < 0) {
    reasons.push(`The baseline is already below zero at ${formatUSD(baselineMinimumCents)} before this purchase.`);
  } else if (baselineMinimumCents < reserveCents) {
    reasons.push(`The baseline is already below the ${formatUSD(reserveCents)} reserve before this purchase.`);
  }
  for (const event of events) {
    if (event.cents < 0) {
      reasons.push(`${event.label} on ${event.date} reduces the projection by ${formatUSD(-event.cents)}.`);
    } else if (event.kind === 'income' && event.confidence === 'scheduled') {
      reasons.push(`${event.label} on ${event.date} is included as a scheduled-income assumption.`);
    }
  }
  if (minimumCents < 0) {
    reasons.push(`Projected negative balance: ${formatUSD(minimumCents)} on ${minimumDate}.`);
  } else if (minimumCents < reserveCents) {
    reasons.push(`Below your reserve: the projected minimum is ${formatUSD(minimumCents)} on ${minimumDate}.`);
  } else {
    reasons.push(`Within your reserve: the projected minimum is ${formatUSD(minimumCents)} on ${minimumDate}.`);
  }
  return reasons;
}

export function forecastWithPurchases(
  rawSnapshot: Snapshot,
  purchases: HypotheticalPurchase[],
  reserveCents: number,
): Forecast {
  const snapshot = validateSnapshot(rawSnapshot);
  assertSafeCents(reserveCents, 'Reserve', { nonnegative: true });

  const events = normalizeEvents(snapshot.events, snapshot.today);
  const overdue = overdueUnreflectedEvents(snapshot.events, snapshot.today);
  const baseline = walk(snapshot, events);
  const scenarioEvents: WalkEvent[] = purchases.map(purchase => ({
    id: `hypothetical:${purchase.id}`,
    date: purchase.date,
    cents: -purchase.cents,
  }));
  const afterPurchase = walk(snapshot, [...events, ...scenarioEvents]);
  const baselineMinimum = lowest(baseline);
  const minimum = lowest(afterPurchase);
  let purchaseCents = 0;
  for (const purchase of purchases) purchaseCents = addCents(purchaseCents, purchase.cents);
  const allowance = addCents(baselineMinimum.cents, -reserveCents);
  const complete = snapshot.complete && overdue.length === 0;
  const status: Forecast['status'] = minimum.cents < 0
    ? 'negative'
    : minimum.cents < reserveCents ? 'below-reserve' : 'within-reserve';

  return {
    baseline,
    afterPurchase,
    minimumCents: minimum.cents,
    minimumDate: minimum.date,
    baselineMinimumCents: baselineMinimum.cents,
    safeToSpendCents: Math.max(0, allowance),
    purchaseCents,
    reserveCents,
    status,
    complete,
    stale: snapshot.stale,
    reasons: buildReasons(
      snapshot,
      events,
      overdue,
      baselineMinimum.cents,
      minimum.cents,
      minimum.date,
      reserveCents,
    ),
  };
}

export function forecast(snapshot: Snapshot, purchaseCents: number, reserveCents: number): Forecast {
  assertSafeCents(purchaseCents, 'Purchase', { nonnegative: true });
  const purchases: HypotheticalPurchase[] = purchaseCents === 0 ? [] : [{
    id: 'immediate-purchase',
    label: 'Purchase',
    cents: purchaseCents,
    date: snapshot.today,
  }];
  return forecastWithPurchases(snapshot, purchases, reserveCents);
}
