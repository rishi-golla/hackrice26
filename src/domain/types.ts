export type DataMode = 'live-sandbox' | 'recorded-sandbox' | 'synthetic';

export type CashEvent = {
  id: string;
  sourceId: string;
  date: string;
  cents: number;
  label: string;
  kind: 'bill' | 'income' | 'other';
  confidence: 'confirmed' | 'estimated';
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
  events: CashEvent[];
};

export type ForecastStatus = 'negative' | 'below-reserve' | 'within-reserve';

export type DayPoint = {
  date: string;
  openingCents: number;
  intradayLowCents: number;
  closingCents: number;
};

export type ForecastDriver = {
  id: string;
  label: string;
  date: string;
  cents: number;
};

export type Forecast = {
  baseline: DayPoint[];
  afterPurchase: DayPoint[];
  baselineMinimumCents: number;
  minimumCents: number;
  safeToSpendCents: number;
  purchaseCents: number;
  status: ForecastStatus;
  drivers: ForecastDriver[];
};
