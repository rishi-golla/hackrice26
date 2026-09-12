import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../src/fixtures/demo';
import { createCappyToolRegistry } from '../../src/service/tools';
import { defaultProfile } from '../../src/service/profile';

const context = { session: { id: 's', userId: 'u', accountId: 'demo-checking', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() }, profile: defaultProfile };

describe('Cappy tool registry', () => {
  const registry = createCappyToolRegistry({ snapshot: async accountId => ({ ...demoSnapshot(), accountId }) });
  it('exposes only read-only finance tools and rejects unknown tools', async () => {
    expect(registry.names()).toEqual([
      'getSnapshot',
      'getAccountSummary',
      'getUpcomingBills',
      'getFinancialInsights',
      'forecastPurchase',
      'compareScenario',
      'explainForecast',
    ]);
    await expect(registry.call('transferMoney', {}, context)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('enforces account scope, session validity, and integer cents', async () => {
    await expect(registry.call('getSnapshot', { accountId: 'other' }, context)).rejects.toThrow('Unknown account');
    await expect(registry.call('forecastPurchase', { accountId: 'demo-checking', purchaseCents: 1.5, reserveCents: 100 }, context)).rejects.toThrow();
    await expect(registry.call('getSnapshot', { accountId: 'demo-checking' }, { ...context, session: { ...context.session, expiresAt: new Date(Date.now() - 1).toISOString() } })).rejects.toMatchObject({ statusCode: 401 });
  });
});
