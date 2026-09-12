import type { Snapshot } from '../domain/types';

export function demoSnapshot(): Snapshot {
  return {
    accountId: 'demo-checking',
    balanceCents: 80000,
    currency: 'USD',
    asOf: '2026-09-12T14:00:00.000Z',
    today: '2026-09-12',
    timezone: 'America/Chicago',
    mode: 'synthetic',
    complete: true,
    stale: false,
    events: [
      {
        id: 'rent-2026-09', sourceId: 'rent', date: '2026-09-14', cents: -60000,
        label: 'Rent', kind: 'bill', confidence: 'scheduled', reflectedInBalance: false,
        cancelled: false,
      },
      {
        id: 'utilities-2026-09', sourceId: 'utilities', date: '2026-09-16', cents: -8000,
        label: 'Utilities', kind: 'bill', confidence: 'scheduled', reflectedInBalance: false,
        cancelled: false,
      },
      {
        id: 'income-2026-09-19', sourceId: 'income', date: '2026-09-19', cents: 100000,
        label: 'Scheduled income', kind: 'income', confidence: 'scheduled', reflectedInBalance: false,
        cancelled: false,
      },
    ],
  };
}
