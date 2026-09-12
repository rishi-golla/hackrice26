import { addCalendarDays, dateInInclusiveRange } from './dates.js';
import { buildForecast } from './forecast.js';
import type { Forecast, Snapshot } from './types.js';
import type { HypotheticalPurchase } from '../service/conversation/types.js';

export type { HypotheticalPurchase };

function validatePurchaseDates(snapshot: Snapshot, purchases: readonly HypotheticalPurchase[]): void {
  const lastDate = addCalendarDays(snapshot.today, 13);
  const ids = new Set<string>();
  for (const purchase of purchases) {
    if (ids.has(purchase.id)) {
      throw new Error(`Duplicate purchase ID: ${purchase.id}`);
    }
    ids.add(purchase.id);
    if (!purchase.id || !purchase.label) {
      throw new Error('Scenario purchases require an ID and label.');
    }
    if (!Number.isSafeInteger(purchase.cents) || purchase.cents <= 0) {
      throw new Error('Scenario purchase cents must be a positive safe integer.');
    }
    if (!dateInInclusiveRange(purchase.date, snapshot.today, lastDate)) {
      throw new Error(`Purchase date is outside the forecast horizon: ${purchase.date}`);
    }
  }
}

export function evaluateScenario(
  snapshot: Snapshot,
  purchases: readonly HypotheticalPurchase[],
  reserveCents: number,
): Forecast {
  validatePurchaseDates(snapshot, purchases);
  return buildForecast(
    snapshot,
    purchases.map((purchase) => ({
      id: `hypothetical:${purchase.id}`,
      label: purchase.label,
      date: purchase.date,
      cents: -purchase.cents,
    })),
    reserveCents,
  );
}
