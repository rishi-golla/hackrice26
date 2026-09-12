import type { Rect } from '../desktop/coordinates';

export type ForecastStatus = 'negative' | 'below-reserve' | 'within-reserve';

export type DayPointView = {
  date: string;
  openingCents: number;
  lowCents: number;
  closingCents: number;
};

/** The UI consumes this narrow shape; the domain Snapshot is structurally compatible. */
export type SnapshotView = {
  mode: 'live-sandbox' | 'recorded-sandbox' | 'synthetic';
  asOf: string;
  stale: boolean;
  complete: boolean;
  timezone?: string;
};

/** The UI renders facts computed by the domain; it does not calculate forecasts. */
export type ForecastView = {
  baseline: DayPointView[];
  afterPurchase: DayPointView[];
  minimumCents: number;
  minimumDate: string;
  baselineMinimumCents?: number;
  safeToSpendCents?: number;
  purchaseCents: number;
  reserveCents: number;
  status: ForecastStatus;
  complete: boolean;
  stale: boolean;
  reasons: string[];
};

export type CursorAnchor = Pick<Rect, 'x' | 'y'>;
