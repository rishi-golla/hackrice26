import { describe, expect, it } from 'vitest';
import { intentSchema, routeIntent, ValidatedIntentRouter } from '../../src/service/conversation/router';
import type { RouterInput } from '../../src/service/conversation/types';

const input = (text: string, overrides: Partial<RouterInput> = {}): RouterInput => ({
  text,
  today: '2026-09-12',
  timezone: 'America/Chicago',
  references: [],
  candidates: [],
  lastScenario: [],
  ...overrides,
});

describe('strict intent routing', () => {
  it('parses supported deterministic paraphrases', async () => {
    await expect(routeIntent(input('Can I afford $200 today?'))).resolves.toMatchObject({ kind: 'evaluate', amountCents: 20_000, date: '2026-09-12' });
    await expect(routeIntent(input('Actually, they are ten dollars.', { lastScenario: [{ id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-12' }] }))).resolves.toEqual({ kind: 'evaluate', purchaseIds: ['tickets'], amountCents: 1_000 });
    await expect(routeIntent(input('Why?'))).resolves.toEqual({ kind: 'explain' });
    await expect(routeIntent(input('Forget this conversation.'))).resolves.toEqual({ kind: 'forget' });
  });

  it('resolves next Saturday and a bare Sunday from a Saturday', async () => {
    const lastScenario = [{ id: 'tickets', label: 'Tickets', cents: 20_000, date: '2026-09-12' }];
    await expect(routeIntent(input('What about next Saturday?', { lastScenario }))).resolves.toMatchObject({ kind: 'evaluate', date: '2026-09-19' });
    await expect(routeIntent(input('Then Sunday.', { lastScenario }))).resolves.toMatchObject({ kind: 'evaluate', date: '2026-09-13' });
  });

  it('fails closed on unknown fields and tool names', async () => {
    const unknownField = { mode: 'test' as const, route: async () => ({ kind: 'explain', transferCents: 50_000 }) };
    const unknownTool = { mode: 'test' as const, route: async () => ({ kind: 'transfer', amountCents: 50_000 }) };
    await expect(new ValidatedIntentRouter(unknownField).route(input('Why?'))).resolves.toEqual({ kind: 'unsupported' });
    await expect(new ValidatedIntentRouter(unknownTool).route(input('Send money'))).resolves.toEqual({ kind: 'unsupported' });
    expect(intentSchema.safeParse({ kind: 'evaluate', purchaseIds: [], amountCents: 1.5 }).success).toBe(false);
  });
});
