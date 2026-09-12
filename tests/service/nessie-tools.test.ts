import { describe, expect, it } from 'vitest';

import type { Snapshot } from '../../src/domain/types';
import { defaultProfile } from '../../src/service/profile';
import {
  createCappyToolRegistry,
  type CappyTool,
  type CappyToolContext,
} from '../../src/service/tools';

const liveSnapshot = {
  accountId: 'demo-checking',
  balanceCents: 100_000,
  currency: 'USD',
  asOf: '2026-09-12T16:30:00.000Z',
  today: '2026-09-12',
  timezone: 'America/Chicago',
  mode: 'live-sandbox',
  complete: false,
  stale: true,
  sources: ['/accounts/demo-checking/withdrawals', '/accounts/demo-checking', '/accounts/demo-checking/bills'],
  accountType: 'Checking',
  accountNickname: 'Daily checking',
  accountLast4: '3456',
  rewardsPoints: 17,
  events: [
    {
      id: 'nessie:bill:rent', sourceId: 'nessie:bill:rent', date: '2026-09-13', cents: -60_000,
      label: 'Rent', kind: 'bill', confidence: 'scheduled', reflectedInBalance: false, cancelled: false,
      recurrence: 'monthly',
    },
    {
      id: 'nessie:bill:utility', sourceId: 'nessie:bill:utility', date: '2026-09-14', cents: -8_000,
      label: 'Utilities', kind: 'bill', confidence: 'scheduled', reflectedInBalance: false, cancelled: false,
    },
    {
      id: 'nessie:deposit:paycheck', sourceId: 'nessie:deposit:paycheck', date: '2026-09-15', cents: 20_000,
      label: 'Paycheck', kind: 'income', confidence: 'scheduled', reflectedInBalance: false, cancelled: false,
    },
  ],
  accountNumber: '1234567890123456',
  apiKey: 'nessie-secret-key',
} satisfies Snapshot & { accountNumber: string; apiKey: string };

const context: CappyToolContext = {
  session: {
    id: 'session', userId: 'user', accountId: 'demo-checking',
    issuedAt: '2026-09-12T16:00:00.000Z', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  profile: { ...defaultProfile, reserveCents: 25_000 },
};

const newToolNames = ['getAccountSummary', 'getUpcomingBills', 'getFinancialInsights'] as const;

function registry(snapshot: Snapshot = liveSnapshot) {
  return createCappyToolRegistry({ snapshot: async () => snapshot });
}

describe('live Nessie-backed Cappy tools', () => {
  it('registers the exact tool names under the read-only, session-required, account-scoped policy', () => {
    const tools = registry() as unknown as { tools: Map<string, CappyTool> };

    expect([...tools.tools.keys()]).toEqual([
      'getSnapshot',
      'getAccountSummary',
      'getUpcomingBills',
      'getFinancialInsights',
      'forecastPurchase',
      'compareScenario',
      'explainForecast',
    ]);
    for (const name of newToolNames) {
      expect(tools.tools.get(name)?.policy).toEqual({ readOnly: true, requiresSession: true, accountScoped: true });
    }
  });

  it('returns cloned account metadata and live coverage without exposing provider secrets', async () => {
    const tools = registry();
    const result = await tools.call('getAccountSummary', { accountId: 'demo-checking' }, context) as Record<string, unknown>;

    expect(result).toEqual({
      accountId: 'demo-checking',
      balanceCents: 100_000,
      mode: 'live-sandbox',
      asOf: '2026-09-12T16:30:00.000Z',
      complete: false,
      stale: true,
      sources: ['/accounts/demo-checking/withdrawals', '/accounts/demo-checking', '/accounts/demo-checking/bills'],
      accountType: 'Checking',
      accountNickname: 'Daily checking',
      accountLast4: '3456',
      rewardsPoints: 17,
    });
    (result.sources as string[]).push('/mutated');
    expect(liveSnapshot.sources).not.toContain('/mutated');
    expect(JSON.stringify(result)).not.toContain('1234567890123456');
    expect(JSON.stringify(result)).not.toContain('nessie-secret-key');
  });

  it('uses deterministic insights and the authenticated profile reserve for bills and insights', async () => {
    const tools = registry();
    const bills = await tools.call('getUpcomingBills', { accountId: 'demo-checking' }, context);
    const result = await tools.call('getFinancialInsights', { accountId: 'demo-checking' }, context) as {
      accountId: string;
      mode: string;
      asOf: string;
      insights: {
        safeToSpendCents: number;
        coverage: { mode: string; complete: boolean; stale: boolean; sources: string[] };
        upcomingBills: unknown[];
      };
    };

    expect(bills).toEqual({
      accountId: 'demo-checking',
      mode: 'live-sandbox',
      asOf: '2026-09-12T16:30:00.000Z',
      complete: false,
      stale: true,
      sources: ['/accounts/demo-checking', '/accounts/demo-checking/bills', '/accounts/demo-checking/withdrawals'],
      upcomingBills: [
        { id: 'nessie:bill:rent', label: 'Rent', date: '2026-09-13', cents: 60_000, recurring: true },
        { id: 'nessie:bill:utility', label: 'Utilities', date: '2026-09-14', cents: 8_000, recurring: false },
      ],
    });
    expect(result).toMatchObject({
      accountId: 'demo-checking',
      mode: 'live-sandbox',
      asOf: '2026-09-12T16:30:00.000Z',
      insights: {
        coverage: {
          mode: 'live-sandbox',
          complete: false,
          stale: true,
          sources: ['/accounts/demo-checking', '/accounts/demo-checking/bills', '/accounts/demo-checking/withdrawals'],
        },
      },
    });
    expect(result.insights.safeToSpendCents).toBe(7_000);
    expect(result.insights.upcomingBills).toEqual((bills as { upcomingBills: unknown[] }).upcomingBills);
    expect(JSON.stringify({ bills, result })).not.toMatch(/1234567890123456|nessie-secret-key/);
  });

  it.each(newToolNames)('%s checks account scope before reading the snapshot', async name => {
    let reads = 0;
    const tools = createCappyToolRegistry({ snapshot: async () => { reads += 1; return liveSnapshot; } });

    await expect(tools.call(name, { accountId: 'other-account' }, context)).rejects.toMatchObject({ statusCode: 403 });
    expect(reads).toBe(0);
  });

  it.each(newToolNames)('%s rejects an expired session before reading the snapshot', async name => {
    let reads = 0;
    const tools = createCappyToolRegistry({ snapshot: async () => { reads += 1; return liveSnapshot; } });
    const expired = { ...context, session: { ...context.session, expiresAt: new Date(Date.now() - 1).toISOString() } };

    await expect(tools.call(name, { accountId: 'demo-checking' }, expired)).rejects.toMatchObject({ statusCode: 401 });
    expect(reads).toBe(0);
  });

  it.each(newToolNames)('%s validates its exact input with Zod', async name => {
    await expect(registry().call(name, { accountId: 'demo-checking', extra: true }, context)).rejects.toThrow();
  });

  it('keeps unknown and write tools unavailable', async () => {
    const tools = registry();

    await expect(tools.call('transferMoney', { accountId: 'demo-checking' }, context))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(tools.call('unknownTool', {}, context)).rejects.toMatchObject({ statusCode: 404 });
  });
});
