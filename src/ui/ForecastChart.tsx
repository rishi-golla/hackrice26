import type { DayPointView } from './types';
import type { ReactElement } from 'react';

export type ForecastChartProps = {
  baseline: DayPointView[];
  afterPurchase: DayPointView[];
  reserveCents: number;
};

const CHART_WIDTH = 320;
const CHART_HEIGHT = 132;
const PADDING = { top: 10, right: 8, bottom: 22, left: 38 };

function pathFor(points: DayPointView[], minimum: number, maximum: number): string {
  const usableWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const usableHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const denominator = Math.max(1, maximum - minimum);
  return points.map((point, index) => {
    const x = PADDING.left + (index / Math.max(1, points.length - 1)) * usableWidth;
    const y = PADDING.top + ((maximum - point.lowCents) / denominator) * usableHeight;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

function yFor(value: number, minimum: number, maximum: number): number {
  const usableHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  return PADDING.top + ((maximum - value) / Math.max(1, maximum - minimum)) * usableHeight;
}

export function ForecastChart({ baseline, afterPurchase, reserveCents }: ForecastChartProps): ReactElement {
  const values = [...baseline, ...afterPurchase].flatMap((point) => [point.lowCents, point.openingCents, point.closingCents]);
  const minimum = Math.min(0, reserveCents, ...values);
  const maximum = Math.max(reserveCents, ...values, minimum + 1);
  const zeroY = yFor(0, minimum, maximum);
  const reserveY = yFor(reserveCents, minimum, maximum);
  const labels = baseline.length > 0 ? [baseline[0].date, baseline[baseline.length - 1].date] : [];

  return (
    <div className="forecast-chart">
      <svg aria-label="Fourteen day balance projection" role="img" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <line className="forecast-chart__guide forecast-chart__guide--zero" x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={zeroY} y2={zeroY} />
        <line className="forecast-chart__guide forecast-chart__guide--reserve" x1={PADDING.left} x2={CHART_WIDTH - PADDING.right} y1={reserveY} y2={reserveY} />
        <path className="forecast-chart__line forecast-chart__line--baseline" d={pathFor(baseline, minimum, maximum)} />
        <path className="forecast-chart__line forecast-chart__line--after" d={pathFor(afterPurchase, minimum, maximum)} />
        <text className="forecast-chart__label" x={4} y={zeroY + 4}>$0</text>
        <text className="forecast-chart__label" x={4} y={reserveY + 4}>reserve</text>
        {labels.length === 2 && (
          <>
            <text className="forecast-chart__date" x={PADDING.left} y={CHART_HEIGHT - 4}>{labels[0]}</text>
            <text className="forecast-chart__date" textAnchor="end" x={CHART_WIDTH - PADDING.right} y={CHART_HEIGHT - 4}>{labels[1]}</text>
          </>
        )}
      </svg>
      <div className="forecast-chart__legend" aria-hidden="true">
        <span><i className="legend-swatch legend-swatch--baseline" />baseline</span>
        <span><i className="legend-swatch legend-swatch--after" />after purchase</span>
      </div>
    </div>
  );
}
