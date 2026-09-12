import { explain } from '../../domain/explain.js';
import { evaluateScenario } from '../../domain/scenario.js';
import type { DataMode, Forecast, Snapshot } from '../../domain/types.js';
import { CandidateRegistry } from './candidates.js';
import { createDeterministicIntentProvider } from './deterministic-router.js';
import {
  appendTurn,
  clearSession,
  createSession,
  isSessionExpired,
  rememberPurchase,
  switchSessionContext,
} from './session.js';
import { IntentRouterError, routeIntent } from './router.js';
import type {
  ConversationSession,
  HypotheticalPurchase,
  IntentRouterProvider,
  PurchaseRef,
  TurnReply,
  TurnRequest,
} from './types.js';
import type { SpeechProvider } from '../providers/speech.js';

export type SnapshotProvider = (accountId: string) => Promise<Snapshot>;

export type ConversationControllerOptions = {
  routerProvider?: IntentRouterProvider;
  snapshotProvider: SnapshotProvider;
  candidateRegistry?: CandidateRegistry;
  speechProvider?: SpeechProvider;
  reserveCents: number;
  now: () => number;
};

export class TurnCancelledError extends Error {
  public readonly name = 'TurnCancelledError';

  public constructor() {
    super('Conversation turn was cancelled.');
  }
}

export class VoiceTurnError extends Error {
  public readonly name = 'VoiceTurnError';

  public constructor(
    public readonly code: 'provider-unavailable' | 'duration' | 'no-speech',
    message: string,
  ) {
    super(message);
  }
}

export type VoiceTurnRequest = {
  sessionId: string;
  turnId: string;
  audio: Uint8Array;
  mime: string;
  durationMs: number;
  candidateId?: string;
};

export type VoiceTurnReply = {
  transcript: string;
  reply: TurnReply;
  audio: Uint8Array;
};

type GeneratedReply = {
  sessionId: string;
  text: string;
};

function formatCents(cents: number): string {
  return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function lowestPoint(forecast: Forecast) {
  return forecast.afterPurchase.reduce((lowest, point) =>
    point.intradayLowCents < lowest.intradayLowCents ? point : lowest,
  );
}

function forecastReply(forecast: Forecast): string {
  const low = lowestPoint(forecast);
  const status =
    forecast.status === 'negative'
      ? 'Projected negative balance'
      : forecast.status === 'below-reserve'
        ? 'Below your reserve'
        : 'Within your reserve';
  return `${status}: projected minimum ${formatCents(forecast.minimumCents)} on ${low.date}.`;
}

function asReference(purchase: HypotheticalPurchase): PurchaseRef {
  return { ...purchase, origin: 'typed', confirmed: false };
}

export class ConversationController {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly generations = new Map<string, number>();
  private readonly replies = new Map<string, GeneratedReply>();
  private readonly activeCandidates = new Map<string, PurchaseRef>();
  private readonly snapshotContext = new Map<string, Pick<Snapshot, 'today' | 'timezone'>>();
  private readonly routerProvider: IntentRouterProvider;
  private readonly snapshotProvider: SnapshotProvider;
  private readonly candidateRegistry: CandidateRegistry;
  private readonly speechProvider?: SpeechProvider;
  private readonly reserveCents: number;
  private readonly now: () => number;

  public constructor(options: ConversationControllerOptions) {
    this.routerProvider = options.routerProvider ?? createDeterministicIntentProvider();
    this.snapshotProvider = options.snapshotProvider;
    this.candidateRegistry = options.candidateRegistry ?? new CandidateRegistry();
    this.speechProvider = options.speechProvider;
    this.reserveCents = options.reserveCents;
    this.now = options.now;
  }

  public createSession(id: string, accountId: string, mode: DataMode): ConversationSession {
    const session = createSession({ id, accountId, mode, now: this.now() });
    this.sessions.set(id, session);
    this.generations.set(id, 0);
    return session;
  }

  public getSession(sessionId: string): ConversationSession | undefined {
    return this.sessions.get(sessionId);
  }

  public confirmCandidate(sessionId: string, candidateId: string): PurchaseRef | undefined {
    const session = this.requireSession(sessionId);
    const reference = this.candidateRegistry.confirmCandidate(session.accountId, candidateId, this.now());
    if (!reference || !rememberPurchase(session, reference, this.now())) {
      return undefined;
    }
    return reference;
  }

  public switchContext(sessionId: string, accountId: string, mode: DataMode): void {
    const session = this.requireSession(sessionId);
    this.candidateRegistry.clearAccount(session.accountId);
    switchSessionContext(session, { accountId, mode }, this.now());
    this.activeCandidates.delete(sessionId);
    this.snapshotContext.delete(sessionId);
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
  }

  public clearSession(sessionId: string): void {
    const session = this.requireSession(sessionId);
    clearSession(session, this.now());
    this.activeCandidates.delete(sessionId);
    this.snapshotContext.delete(sessionId);
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
  }

  public cancelTurn(sessionId: string): void {
    this.requireSession(sessionId);
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
  }

  public getGeneratedReply(replyId: string, sessionId: string): GeneratedReply | undefined {
    const reply = this.replies.get(replyId);
    return reply && reply.sessionId === sessionId ? { ...reply } : undefined;
  }

  public async handleVoiceTurn(request: VoiceTurnRequest): Promise<VoiceTurnReply> {
    if (!this.speechProvider) {
      throw new VoiceTurnError('provider-unavailable', 'Voice provider is not configured.');
    }
    if (!Number.isFinite(request.durationMs) || request.durationMs <= 0 || request.durationMs > 30_000) {
      throw new VoiceTurnError('duration', 'Voice recording must be between 0 and 30 seconds.');
    }
    const transcript = await this.speechProvider.transcribe(request.audio, request.mime);
    if (!transcript.trim()) {
      throw new VoiceTurnError('no-speech', 'No speech was detected.');
    }
    const reply = await this.handleTurn({
      sessionId: request.sessionId,
      turnId: request.turnId,
      text: transcript,
      candidateId: request.candidateId,
    });
    const audio = await this.speechProvider.synthesize(reply.replyId);
    return { transcript, reply, audio };
  }

  public async handleTurn(request: TurnRequest): Promise<TurnReply> {
    const session = this.requireSession(request.sessionId);
    const generation = (this.generations.get(request.sessionId) ?? 0) + 1;
    this.generations.set(request.sessionId, generation);
    const now = this.now();
    if (isSessionExpired(session, now)) {
      clearSession(session, now);
      this.activeCandidates.delete(request.sessionId);
    }
    appendTurn(session, { role: 'user', text: request.text }, now);

    const freshCandidate = request.candidateId
      ? this.candidateRegistry.getFreshCandidate(session.accountId, request.candidateId, now)
      : undefined;
    if (request.candidateId && !freshCandidate) {
      return this.publish(request, session, generation, 'clarifying', 'That screen context has expired. Please capture it again.');
    }
    if (freshCandidate) {
      this.activeCandidates.set(request.sessionId, freshCandidate);
    }

    const contextReferences = [
      ...(freshCandidate ? [freshCandidate] : []),
      ...session.lastScenario.map(asReference),
    ];

    try {
      const intent = await routeIntent(request.text, session, this.routerProvider, {
        freshReferences: contextReferences,
        today: this.snapshotContext.get(request.sessionId)?.today,
        timezone: this.snapshotContext.get(request.sessionId)?.timezone,
      });
      this.assertCurrent(request.sessionId, generation);

      switch (intent.kind) {
        case 'evaluate':
          return await this.evaluate(request, session, generation, intent.purchaseIds, intent.amountCents, intent.date, contextReferences);
        case 'remember':
          return this.remember(request, session, generation, intent.purchaseId, contextReferences);
        case 'explain':
          return await this.explain(request, session, generation);
        case 'forget':
          clearSession(session, now);
          this.activeCandidates.delete(request.sessionId);
          this.snapshotContext.delete(request.sessionId);
          return this.publish(request, session, generation, 'idle', 'Conversation cleared.');
        case 'clarify':
          return this.publish(request, session, generation, 'clarifying', intent.question);
        case 'unsupported':
          return this.publish(
            request,
            session,
            generation,
            'clarifying',
            'I can evaluate confirmed hypothetical purchases and explain the projected result.',
          );
      }
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        throw error;
      }
      if (error instanceof IntentRouterError && error.code === 'unknown-reference') {
        return this.publish(request, session, generation, 'clarifying', 'Which confirmed purchase should I use?');
      }
      if (error instanceof IntentRouterError) {
        return this.publish(request, session, generation, 'error', 'I could not understand that voice turn. You can type it instead.');
      }
      return this.publish(request, session, generation, 'error', 'I could not refresh the forecast. You can retry or type the question.');
    }
  }

  private async evaluate(
    request: TurnRequest,
    session: ConversationSession,
    generation: number,
    purchaseIds: string[],
    amountCents: number | undefined,
    date: string | undefined,
    contextReferences: PurchaseRef[],
  ): Promise<TurnReply> {
    if (purchaseIds.length === 0 || (amountCents !== undefined && purchaseIds.length !== 1)) {
      return this.publish(request, session, generation, 'clarifying', 'Which one purchase should I evaluate?');
    }

    const references = new Map<string, PurchaseRef>();
    for (const reference of [...session.references, ...contextReferences]) {
      if (!references.has(reference.id)) {
        references.set(reference.id, reference);
      }
    }
    const purchases = purchaseIds.map((id) => references.get(id));
    if (purchases.some((purchase) => !purchase)) {
      return this.publish(request, session, generation, 'clarifying', 'Which confirmed purchase should I use?');
    }

    const scenario = purchases.map((purchase) => ({
      id: purchase!.id,
      label: purchase!.label,
      cents: amountCents ?? purchase!.cents,
      date: date ?? purchase!.date,
    }));
    const snapshot = await this.snapshotProvider(session.accountId);
    this.assertCurrent(request.sessionId, generation);
    this.snapshotContext.set(request.sessionId, { today: snapshot.today, timezone: snapshot.timezone });
    if (snapshot.stale) {
      return this.publish(request, session, generation, 'error', 'I could not refresh the account. Choose an explicit stale preview or retry.');
    }
    const forecast = evaluateScenario(snapshot, scenario, this.reserveCents);
    session.lastScenario = scenario;
    return this.publish(request, session, generation, 'idle', forecastReply(forecast), forecast, scenario);
  }

  private remember(
    request: TurnRequest,
    session: ConversationSession,
    generation: number,
    purchaseId: string,
    contextReferences: PurchaseRef[],
  ): TurnReply {
    const references = new Map<string, PurchaseRef>();
    for (const item of [...session.references, ...contextReferences]) {
      if (!references.has(item.id)) {
        references.set(item.id, item);
      }
    }
    const reference = references.get(purchaseId);
    if (!reference || !reference.confirmed || !rememberPurchase(session, reference, this.now())) {
      return this.publish(request, session, generation, 'clarifying', 'Please confirm that purchase before I remember it.');
    }
    return this.publish(request, session, generation, 'idle', `Saved ${reference.label} as something you are considering.`);
  }

  private async explain(
    request: TurnRequest,
    session: ConversationSession,
    generation: number,
  ): Promise<TurnReply> {
    if (session.lastScenario.length === 0) {
      return this.publish(request, session, generation, 'clarifying', 'What purchase should I explain?');
    }
    const snapshot = await this.snapshotProvider(session.accountId);
    this.assertCurrent(request.sessionId, generation);
    this.snapshotContext.set(request.sessionId, { today: snapshot.today, timezone: snapshot.timezone });
    if (snapshot.stale) {
      return this.publish(request, session, generation, 'error', 'I could not refresh the account. Retry before asking for an explanation.');
    }
    const forecast = evaluateScenario(snapshot, session.lastScenario, this.reserveCents);
    return this.publish(request, session, generation, 'idle', explain(forecast), forecast, session.lastScenario);
  }

  private publish(
    request: TurnRequest,
    session: ConversationSession,
    generation: number,
    state: TurnReply['state'],
    text: string,
    forecast?: Forecast,
    scenario: HypotheticalPurchase[] = [],
  ): TurnReply {
    this.assertCurrent(request.sessionId, generation);
    const replyId = `reply:${request.sessionId}:${request.turnId}`;
    this.replies.set(replyId, { sessionId: request.sessionId, text });
    appendTurn(session, { role: 'assistant', text }, this.now());
    return { turnId: request.turnId, replyId, state, text, forecast, scenario };
  }

  private requireSession(sessionId: string): ConversationSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown conversation session: ${sessionId}`);
    }
    return session;
  }

  private assertCurrent(sessionId: string, generation: number): void {
    if (this.generations.get(sessionId) !== generation) {
      throw new TurnCancelledError();
    }
  }
}
