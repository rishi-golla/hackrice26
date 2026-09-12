import type { Forecast } from './types.js';

function formatCents(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function explain(forecast: Forecast): string {
  const lowPoint = forecast.afterPurchase.reduce((lowest, point) =>
    point.intradayLowCents < lowest.intradayLowCents ? point : lowest,
  );
  const drivers = forecast.drivers
    .filter((driver) => driver.cents < 0)
    .map((driver) => `${driver.label} on ${driver.date}`)
    .join(', ');
  const reason = drivers ? ` Drivers: ${drivers}.` : '';
  return `Projected minimum is ${formatCents(forecast.minimumCents)} on ${lowPoint.date}.${reason}`;
}
