import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../src/fixtures/demo.js';
import { CandidateRegistry } from '../../src/service/conversation/candidates.js';
import {
  ConversationController,
  TurnCancelledError,
} from '../../src/service/conversation/controller.js';
import type { ConversationControllerOptions } from '../../src/service/conversation/controller.js';

function setup(routerProvider: ConversationControllerOptions['routerProvider']) {
  const candidates = new CandidateRegistry();
  const controller = new ConversationController({
    routerProvider,
    snapshotProvider: async () => demoSnapshot(),
    candidateRegistry: candidates,
    reserveCents: 10_000,
    now: () => 1_500,
  });
  controller.createSession('session-1', 'demo-checking', 'synthetic');
  return { controller, candidates };
}

describe('conversation controller', () => {
  it('evaluates a fresh screen candidate and stores the deterministic scenario', async () => {
    const { controller, candidates } = setup(async ({ references }) => {
      expect(references).toHaveLength(1);
      expect(references[0]?.id).toBe('screen-1');
      return { kind: 'evaluate', purchaseIds: ['screen-1'] };
    });
    const candidateId = candidates.registerCandidate('demo-checking', {
      id: 'screen-1',
      label: 'Tickets',
      cents: 20_000,
      date: '2026-09-12',
      capturedAt: 1_000,
      coordinateExpiresAt: 2_000,
    });

    const reply = await controller.handleTurn({
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'Can I afford these?',
      candidateId,
    });

    expect(reply.state).toBe('idle');
    expect(reply.forecast?.minimumCents).toBe(-8_000);
    expect(reply.scenario).toEqual([
      { id: 'screen-1', label: 'Tickets', cents: 20_000, date: '2026-09-12' },
    ]);
    expect(controller.getSession('session-1')?.lastScenario).toEqual(reply.scenario);
  });

  it('returns clarification instead of calculating without a resolved purchase', async () => {
    const { controller } = setup(async () => ({ kind: 'evaluate', purchaseIds: [] }));

    const reply = await controller.handleTurn({
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'Can I afford this?',
    });

    expect(reply.state).toBe('clarifying');
    expect(reply.forecast).toBeUndefined();
  });

  it('suppresses a late router result after cancellation', async () => {
    let resolveRouter: ((value: unknown) => void) | undefined;
    const { controller } = setup(
      () =>
        new Promise((resolve) => {
          resolveRouter = resolve;
        }),
    );

    const turn = controller.handleTurn({
      sessionId: 'session-1',
      turnId: 'turn-1',
      text: 'Why?',
    });
    controller.cancelTurn('session-1');
    resolveRouter?.({ kind: 'unsupported' });

    await expect(turn).rejects.toBeInstanceOf(TurnCancelledError);
  });
});
