import type { Snapshot } from '../domain/types.js';

export function demoSnapshot(): Snapshot {
  return {
    accountId: 'demo-checking',
    balanceCents: 80_000,
    currency: 'USD',
    asOf: '2026-09-12T09:00:00-05:00',
    today: '2026-09-12',
    timezone: 'America/Chicago',
    mode: 'synthetic',
    complete: true,
    stale: false,
    events: [
      {
        id: 'rent-2026-09-14',
        sourceId: 'rent',
        date: '2026-09-14',
        cents: -60_000,
        label: 'Rent',
        kind: 'bill',
        confidence: 'confirmed',
        reflectedInBalance: false,
        cancelled: false,
      },
      {
        id: 'utilities-2026-09-16',
        sourceId: 'utilities',
        date: '2026-09-16',
        cents: -8_000,
        label: 'Utilities',
        kind: 'bill',
        confidence: 'confirmed',
        reflectedInBalance: false,
        cancelled: false,
      },
      {
        id: 'paycheck-2026-09-19',
        sourceId: 'paycheck',
        date: '2026-09-19',
        cents: 100_000,
        label: 'Scheduled paycheck',
        kind: 'income',
        confidence: 'confirmed',
        reflectedInBalance: false,
        cancelled: false,
      },
    ],
  };
}
