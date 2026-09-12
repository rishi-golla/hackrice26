import { describe, expect, it } from 'vitest';
import { createDeterministicIntentProvider } from '../../src/service/conversation/deterministic-router.js';

const provider = createDeterministicIntentProvider();

describe('typed deterministic intent fallback', () => {
  it('routes common read-only questions without an external model', async () => {
    const request = {
      utterance: 'Can I afford these?',
      references: [{ id: 'tickets', label: JSON.stringify('Tickets'), cents: 20_000, date: '2026-09-12', origin: 'screen' as const }],
      allowedIntents: ['evaluate', 'remember', 'explain', 'forget', 'clarify', 'unsupported'] as const,
    };
    await expect(provider(request)).resolves.toEqual({ kind: 'evaluate', purchaseIds: ['tickets'] });
    await expect(provider({ ...request, utterance: 'Why?' })).resolves.toEqual({ kind: 'explain' });
    await expect(provider({ ...request, utterance: 'Forget this conversation' })).resolves.toEqual({ kind: 'forget' });
  });

  it('asks for clarification when both cannot be resolved to exactly two references', async () => {
    const request = {
      utterance: 'What if I buy both?',
      references: [{ id: 'tickets', label: JSON.stringify('Tickets'), cents: 20_000, date: '2026-09-12', origin: 'screen' as const }],
      allowedIntents: ['evaluate', 'remember', 'explain', 'forget', 'clarify', 'unsupported'] as const,
    };
    await expect(provider(request)).resolves.toEqual({
      kind: 'clarify',
      question: 'Which two purchases do you mean?',
    });
  });

  it('returns a fully resolved date for a follow-up weekday', async () => {
    const request = {
      utterance: 'What about next Saturday?',
      today: '2026-09-12',
      timezone: 'America/Chicago',
      references: [{ id: 'tickets', label: JSON.stringify('Tickets'), cents: 20_000, date: '2026-09-12', origin: 'screen' as const }],
      allowedIntents: ['evaluate', 'remember', 'explain', 'forget', 'clarify', 'unsupported'] as const,
    };
    await expect(provider(request)).resolves.toEqual({
      kind: 'evaluate',
      purchaseIds: ['tickets'],
      date: '2026-09-19',
    });
  });
});
