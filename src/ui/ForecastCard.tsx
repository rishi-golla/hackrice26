import { useState } from 'react';
import type { ReactElement } from 'react';
import { AmountForm } from './AmountForm';
import { ForecastChart } from './ForecastChart';
import type { ForecastView, SnapshotView } from './types';

export type ForecastCardProps = {
  snapshot: SnapshotView;
  forecast: ForecastView;
  onAmountChange: (cents: number) => void;
  onDismiss?: () => void;
  textOnly?: boolean;
};

const STATUS_LABELS: Record<ForecastView['status'], string> = {
  negative: 'Projected negative balance',
  'below-reserve': 'Below your reserve',
  'within-reserve': 'Within your reserve',
};

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function freshness(asOf: string): string {
  const timestamp = Date.parse(asOf);
  return Number.isNaN(timestamp) ? 'Freshness unavailable' : `Updated ${new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp)}`;
}

function modeLabel(mode: SnapshotView['mode']): string {
  return mode === 'synthetic' ? 'Synthetic demo' : mode === 'recorded-sandbox' ? 'Recorded sandbox' : 'Live sandbox';
}

export function ForecastCard({ snapshot, forecast, onAmountChange, onDismiss, textOnly = false }: ForecastCardProps): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const hasWarning = snapshot.stale || forecast.stale || !snapshot.complete || !forecast.complete;

  if (textOnly) {
    return (
      <section className="forecast-card forecast-card--text-only" aria-label="Purchase forecast result">
        <p className="forecast-card__text-result">{STATUS_LABELS[forecast.status]}: {money(forecast.minimumCents)} projected on {forecast.minimumDate}.</p>
        {onDismiss && <button className="quiet-button" onClick={onDismiss} type="button">Dismiss</button>}
      </section>
    );
  }

  return (
    <section className={`forecast-card forecast-card--${forecast.status}`} aria-label="Purchase forecast">
      <div className="forecast-card__topline">
        <span className="mode-badge">{modeLabel(snapshot.mode)}</span>
        {hasWarning && <span className="data-badge data-badge--warning">{snapshot.stale || forecast.stale ? 'Stale data' : 'Incomplete data'}</span>}
        {onDismiss && <button className="dismiss-button" aria-label="Dismiss forecast" onClick={onDismiss} type="button">×</button>}
      </div>

      <div className="forecast-card__heading">
        <div>
          <h2>{STATUS_LABELS[forecast.status]}</h2>
          <p className="forecast-card__subhead">After a {money(forecast.purchaseCents)} purchase</p>
        </div>
        <AmountForm amountCents={forecast.purchaseCents} onAmountChange={onAmountChange} />
      </div>

      <div className="forecast-card__metric-row">
        <div>
          <span className="metric-label">Lowest projected balance</span>
          <strong className={`metric-value metric-value--${forecast.status}`}>{money(forecast.minimumCents)}</strong>
        </div>
        <div className="metric-date">{forecast.minimumDate}</div>
      </div>

      <button className="chart-toggle" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)} type="button">
        {expanded ? 'Hide projection' : 'Show projection'}
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && <ForecastChart afterPurchase={forecast.afterPurchase} baseline={forecast.baseline} reserveCents={forecast.reserveCents} />}

      {forecast.reasons.length > 0 && (
        <div className="forecast-card__reasons">
          <h3>What drives the low point</h3>
          <ul>{forecast.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}

      <div className="forecast-card__footer">
        <span>{freshness(snapshot.asOf)}</span>
        <span>Reserve {money(forecast.reserveCents)}</span>
      </div>
    </section>
  );
}
