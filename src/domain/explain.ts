import { formatUSD } from './money';
import type { Forecast } from './types';

export function explain(result: Forecast): string {
  const qualifier = [
    result.stale ? 'Using stale data.' : '',
    !result.complete ? 'This forecast is incomplete.' : '',
  ].filter(Boolean).join(' ');
  const outcome = result.status === 'negative'
    ? `Projected negative balance of ${formatUSD(result.minimumCents)} on ${result.minimumDate}.`
    : result.status === 'below-reserve'
      ? `Projected minimum ${formatUSD(result.minimumCents)} on ${result.minimumDate}, below your ${formatUSD(result.reserveCents)} reserve.`
      : `Projected minimum ${formatUSD(result.minimumCents)} on ${result.minimumDate}, within your ${formatUSD(result.reserveCents)} reserve.`;
  return [qualifier, outcome, ...result.reasons].filter(Boolean).join(' ');
}
