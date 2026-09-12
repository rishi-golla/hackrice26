// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForecastCard } from '../../src/ui/ForecastCard';
import type { ForecastView, SnapshotView } from '../../src/ui/types';

const snapshot: SnapshotView = {
  mode: 'synthetic',
  asOf: '2026-09-12T12:00:00.000Z',
  stale: false,
  complete: true,
  timezone: 'America/Chicago',
};

const points = Array.from({ length: 14 }, (_, index) => ({
  date: `2026-09-${String(12 + index).padStart(2, '0')}`,
  openingCents: 80_000,
  lowCents: 80_000,
  closingCents: 80_000,
}));

function forecast(overrides: Partial<ForecastView> = {}): ForecastView {
  return {
    baseline: points,
    afterPurchase: points,
    minimumCents: -8_000,
    minimumDate: '2026-09-16',
    purchaseCents: 20_000,
    reserveCents: 10_000,
    status: 'negative',
    complete: true,
    stale: false,
    reasons: ['Utilities on 2026-09-16', 'Rent on 2026-09-14'],
    ...overrides,
  };
}

describe('ForecastCard', () => {
  afterEach(() => cleanup());

  it('shows provenance, projected negative balance, low point, and responsible bills', () => {
    render(<ForecastCard forecast={forecast()} onAmountChange={vi.fn()} snapshot={snapshot} />);

    expect(screen.getByText('Synthetic demo')).toBeTruthy();
    expect(screen.getByText('Projected negative balance')).toBeTruthy();
    expect(screen.getByText('-$80.00')).toBeTruthy();
    expect(screen.getByText('Utilities on 2026-09-16')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Fourteen day balance projection' })).toBeTruthy();
  });

  it('shows amber reserve state and stale/incomplete provenance', () => {
    render(<ForecastCard
      forecast={forecast({ minimumCents: 0, status: 'below-reserve', complete: false })}
      onAmountChange={vi.fn()}
      snapshot={{ ...snapshot, stale: true }}
    />);

    expect(screen.getByText('Below your reserve')).toBeTruthy();
    expect(screen.getByText('Stale data')).toBeTruthy();
  });

  it('passes valid edited dollars back as cents and supports text-only dismissal', () => {
    const onAmountChange = vi.fn();
    render(<ForecastCard forecast={forecast()} onAmountChange={onAmountChange} snapshot={snapshot} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Purchase amount' }), { target: { value: '10.00' } });
    expect(onAmountChange).toHaveBeenCalledWith(1_000);

    const onDismiss = vi.fn();
    render(<ForecastCard forecast={forecast({ minimumCents: 0, status: 'below-reserve' })} onAmountChange={vi.fn()} onDismiss={onDismiss} snapshot={snapshot} textOnly />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
