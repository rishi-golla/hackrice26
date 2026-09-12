import { addDays, isISODate } from './calendar';
import { forecastWithPurchases } from './forecast';
import { assertSafeCents } from './money';
import type { Forecast, HypotheticalPurchase, Snapshot } from './types';

export type { HypotheticalPurchase } from './types';

export function evaluateScenario(
  snapshot: Snapshot,
  purchases: HypotheticalPurchase[],
  reserveCents: number,
): Forecast {
  if (!Array.isArray(purchases)) throw new Error('Purchases must be an array');
  const horizonEnd = addDays(snapshot.today, 13);
  const ids = new Set<string>();

  for (const purchase of purchases) {
    if (typeof purchase !== 'object' || purchase === null) throw new Error('Purchase must be an object');
    if (typeof purchase.id !== 'string' || purchase.id.trim() === '') throw new Error('Purchase id is required');
    if (ids.has(purchase.id)) throw new Error(`Duplicate purchase id: ${purchase.id}`);
    ids.add(purchase.id);
    if (typeof purchase.label !== 'string' || purchase.label.trim() === '') throw new Error('Purchase label is required');
    assertSafeCents(purchase.cents, 'Purchase cents', { positive: true });
    if (!isISODate(purchase.date) || purchase.date < snapshot.today || purchase.date > horizonEnd) {
      throw new Error(`Purchase date must be inside the forecast horizon: ${purchase.date}`);
    }
  }

  return forecastWithPurchases(snapshot, purchases.map(purchase => ({ ...purchase })), reserveCents);
}
