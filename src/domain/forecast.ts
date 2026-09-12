import { addCalendarDays, dateInInclusiveRange } from './dates.js';
import type {
  CashEvent,
  DayPoint,
  Forecast,
  ForecastDriver,
  ForecastStatus,
  Snapshot,
} from './types.js';

export type ScenarioEvent = {
  id: string;
  label: string;
  date: string;
  cents: number;
};

export const FORECAST_HORIZON_DAYS = 14;

function isIncludedCashEvent(event: CashEvent, snapshot: Snapshot, lastDate: string): boolean {
  if (event.cancelled || event.reflectedInBalance || !dateInInclusiveRange(event.date, snapshot.today, lastDate)) {
    return false;
  }
  return !(event.kind === 'income' && event.confidence !== 'confirmed');
}

function cashEventToScenarioEvent(event: CashEvent): ScenarioEvent {
  return { id: event.id, label: event.label, date: event.date, cents: event.cents };
}

function sortEvents(events: ScenarioEvent[]): ScenarioEvent[] {
  return [...events].sort((left, right) => {
    if (left.date !== right.date) {
      return left.date.localeCompare(right.date);
    }
    const leftOutgoing = left.cents < 0 ? 0 : 1;
    const rightOutgoing = right.cents < 0 ? 0 : 1;
    return leftOutgoing - rightOutgoing || left.id.localeCompare(right.id);
  });
}

function minimumCents(points: DayPoint[]): number {
  return points.reduce(
    (minimum, point) => Math.min(minimum, point.openingCents, point.intradayLowCents, point.closingCents),
    Number.MAX_SAFE_INTEGER,
  );
}

function statusFor(minimum: number, reserveCents: number): ForecastStatus {
  if (minimum < 0) {
    return 'negative';
  }
  if (minimum < reserveCents) {
    return 'below-reserve';
  }
  return 'within-reserve';
}

function walk(snapshot: Snapshot, events: ScenarioEvent[]): DayPoint[] {
  const points: DayPoint[] = [];
  const sortedEvents = sortEvents(events);
  let balance = snapshot.balanceCents;

  for (let dayOffset = 0; dayOffset < FORECAST_HORIZON_DAYS; dayOffset += 1) {
    const date = addCalendarDays(snapshot.today, dayOffset);
    const dayEvents = sortedEvents.filter((event) => event.date === date);
    const openingCents = balance;
    let intradayLowCents = openingCents;
    for (const event of dayEvents) {
      balance += event.cents;
      intradayLowCents = Math.min(intradayLowCents, balance);
    }
    points.push({ date, openingCents, intradayLowCents, closingCents: balance });
  }
  return points;
}

export function buildForecast(
  snapshot: Snapshot,
  purchases: readonly ScenarioEvent[],
  reserveCents: number,
): Forecast {
  if (!Number.isSafeInteger(reserveCents) || reserveCents < 0) {
    throw new Error('Reserve must be a non-negative safe integer number of cents.');
  }

  const lastDate = addCalendarDays(snapshot.today, FORECAST_HORIZON_DAYS - 1);
  const providerEvents = snapshot.events
    .filter((event) => isIncludedCashEvent(event, snapshot, lastDate))
    .map(cashEventToScenarioEvent);
  const baseline = walk(snapshot, providerEvents);
  const afterPurchase = walk(snapshot, [...providerEvents, ...purchases]);
  const baselineMinimumCents = minimumCents(baseline);
  const scenarioMinimumCents = minimumCents(afterPurchase);

  return {
    baseline,
    afterPurchase,
    baselineMinimumCents,
    minimumCents: scenarioMinimumCents,
    safeToSpendCents: Math.max(0, baselineMinimumCents - reserveCents),
    purchaseCents: purchases.reduce((sum, purchase) => sum + Math.abs(purchase.cents), 0),
    status: statusFor(scenarioMinimumCents, reserveCents),
    drivers: sortEvents([...providerEvents, ...purchases]).map<ForecastDriver>((event) => ({ ...event })),
  };
}

export function forecast(
  snapshot: Snapshot,
  purchaseCents: number,
  reserveCents: number,
): Forecast {
  return buildForecast(
    snapshot,
    purchaseCents === 0
      ? []
      : [{ id: '__immediate_purchase__', label: 'Purchase', date: snapshot.today, cents: -purchaseCents }],
    reserveCents,
  );
}
