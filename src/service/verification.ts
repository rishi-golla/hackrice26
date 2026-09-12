import type { CappySession } from './auth';
import { randomUUID } from 'node:crypto';
import type { DataMode } from '../domain/types';
import type { InquiryDecision, PersonaProvider } from './providers/persona';
import type { VerificationState, VerificationStatus } from '../shared/verification';

export type VerificationScope = 'account-sensitive-read';
export type VerificationCode = 'verification_required' | 'verification_unavailable';

export interface VerificationGate {
  isConfigured(): boolean;
  isApproved(session: CappySession, accountId: string, scope: VerificationScope): boolean;
  expiresAt?(session: CappySession): number | undefined;
  grantId?(session: CappySession): string | undefined;
}
export class VerificationError extends Error {
  readonly statusCode: number;

  constructor(readonly code: VerificationCode, message: string) {
    super(message);
    this.name = 'VerificationError';
    this.statusCode = code === 'verification_required' ? 403 : 503;
  }
}

// Missing configuration always leaves protected data unavailable.
export const unavailableVerificationGate: VerificationGate = {
  isConfigured: () => false,
  isApproved: () => false,
};

export type PendingOperation = { method: 'GET' | 'POST' | 'PUT'; url: string; body?: unknown };
type Pending = {
  id: string; session: CappySession; operation: PendingOperation; expiresAt: number;
  referenceId: string; inquiryId?: string; state: VerificationState; pollUntil?: number; nextPollAt: number;
  starting?: Promise<void>; checking?: Promise<void>;
};
type Grant = { id: string; session: CappySession; inquiryId: string; expiresAt: number };

/** One pending action per auth session. All state is local and bounded; no identity payloads are stored. */
export class VerificationStore implements VerificationGate {
  private readonly requests = new Map<string, Pending>();
  private readonly grants = new Map<string, Grant>();
  private readonly attempts = new Map<string, { count: number; expiresAt: number }>();
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly ttlMs: number;

  constructor(private readonly options: { provider?: PersonaProvider; templateId?: string; environmentId?: string;
    environment?: string; mode: DataMode; ttlMs?: number; now?: () => number; id?: () => string }) {
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    this.ttlMs = Math.min(300_000, Math.max(1_000, options.ttlMs ?? 300_000));
  }
  isConfigured() {
    return !!this.options.provider && !!this.options.templateId && !!this.options.environmentId &&
      this.options.environment === 'sandbox' && this.options.mode === 'synthetic';
  }
  private matches(a: CappySession, b: CappySession) {
    return a.id === b.id && a.userId === b.userId && a.accountId === b.accountId &&
      Number.isFinite(Date.parse(b.expiresAt)) && Date.parse(b.expiresAt) > this.now();
  }
  expiresAt(session: CappySession) {
    const grant = this.grants.get(session.id);
    return grant && this.matches(grant.session, session) && grant.expiresAt > this.now() ? grant.expiresAt : undefined;
  }
  isApproved(session: CappySession, accountId: string, scope: VerificationScope) {
    return this.isConfigured() && accountId === session.accountId && scope === 'account-sensitive-read' && this.expiresAt(session) !== undefined;
  }
  grantId(session: CappySession) {
    return this.expiresAt(session) === undefined ? undefined : this.grants.get(session.id)?.id;
  }
  private prune() {
    const now = this.now();
    for (const [id, p] of this.requests) if (p.expiresAt <= now) this.requests.delete(id);
    for (const [id, g] of this.grants) if (g.expiresAt <= now) this.grants.delete(id);
    for (const [id, a] of this.attempts) if (a.expiresAt <= now) this.attempts.delete(id);
  }
  remember(session: CappySession, operation: PendingOperation): string | undefined {
    if (!this.isConfigured()) return undefined;
    if (JSON.stringify(operation).length > 16_384) return undefined;
    this.prune();
    for (const p of this.requests.values()) {
      if (p.session.id !== session.id) continue;
      if (JSON.stringify(p.operation) === JSON.stringify(operation)) return p.id;
      this.requests.delete(p.id);
    }
    if (this.requests.size >= 100) throw new VerificationError('verification_unavailable', 'Verification is busy. Try again shortly.');
    const id = this.id();
    this.requests.set(id, { id, session: { ...session }, operation: structuredClone(operation),
      expiresAt: Math.min(this.now() + 10 * 60_000, Date.parse(session.expiresAt)),
      referenceId: this.id(), state: 'locked', nextPollAt: 0 });
    return id;
  }
  private owned(session: CappySession, id: string): Pending {
    const p = this.requests.get(id);
    if (!p || !this.matches(p.session, session) || p.expiresAt <= this.now()) {
      throw Object.assign(new Error('Verification request expired or unavailable.'), { statusCode: 403 });
    }
    return p;
  }
  private current(p: Pending) { return this.requests.get(p.id) === p && p.expiresAt > this.now(); }
  private statusOf(p: Pending): VerificationStatus {
    if (p.state === 'approved' && !this.expiresAt(p.session)) p.state = 'expired';
    return { requestId: p.id, state: p.state, ...(p.state === 'approved' ? { expiresAt: this.expiresAt(p.session) } : {}),
      ...(p.state === 'pending' ? { pollAfterMs: Math.max(2000, p.nextPollAt - this.now()) } : {}) };
  }
  private checkBinding(p: Pending, d: InquiryDecision) {
    if (d.referenceId !== p.referenceId || d.templateId !== this.options.templateId ||
      d.environmentId !== this.options.environmentId || (p.inquiryId && d.id !== p.inquiryId)) {
      throw new Error('Inquiry binding mismatch');
    }
  }
  async start(session: CappySession, id: string): Promise<VerificationStatus & { hostedUrl?: string }> {
    if (!this.isConfigured()) throw new VerificationError('verification_unavailable', 'Identity verification is unavailable.');
    const p = this.owned(session, id);
    if (!p.inquiryId && !p.starting && p.state === 'locked') {
      this.prune();
      const attempts = this.attempts.get(session.id) ?? { count: 0, expiresAt: this.now() + 10 * 60_000 };
      if (attempts.count >= 3 || this.attempts.size >= 100) throw new VerificationError('verification_unavailable', 'Too many verification attempts. Try again later.');
      attempts.count++; this.attempts.set(session.id, attempts);
      p.state = 'pending';
      p.starting = (async () => {
        try {
          const decision = await this.options.provider!.createInquiry(p.referenceId);
          if (!this.current(p)) return;
          this.checkBinding(p, decision);
          p.inquiryId = decision.id; p.pollUntil = this.now() + 120_000; p.state = 'pending';
        } catch { if (this.current(p)) p.state = 'unavailable'; }
      })().finally(() => { p.starting = undefined; });
    }
    await p.starting;
    this.owned(session, id);
    // Never retry ambiguous inquiry creation. Only retrieval can be retried on the same request.
    if (p.inquiryId && (p.state === 'retry' || p.state === 'unavailable')) {
      p.pollUntil = this.now() + 120_000; p.state = 'pending';
    }
    return { ...this.statusOf(p), ...(p.inquiryId && p.state === 'pending'
      ? { hostedUrl: `https://inquiry.withpersona.com/verify?inquiry-id=${encodeURIComponent(p.inquiryId)}` } : {}) };
  }
  async status(session: CappySession, id: string): Promise<VerificationStatus> {
    const p = this.owned(session, id);
    if (p.checking) { await p.checking; this.owned(session, id); return this.statusOf(p); }
    if (p.state !== 'pending' || !p.inquiryId) return this.statusOf(p);
    if (this.now() >= (p.pollUntil ?? 0)) { p.state = 'retry'; return this.statusOf(p); }
    if (this.now() < p.nextPollAt) return this.statusOf(p);
    p.nextPollAt = this.now() + 2000;
    p.checking = (async () => {
      try {
        const d = await this.options.provider!.getInquiryDecision(p.inquiryId!);
        if (!this.current(p)) return;
        this.checkBinding(p, d);
        if (d.status === 'approved') {
          if (this.grants.size >= 100) throw new Error('Grant capacity reached');
          const expiresAt = Math.min(this.now() + this.ttlMs, Date.parse(session.expiresAt));
          this.grants.set(session.id, { id: this.id(), session: { ...session }, inquiryId: d.id, expiresAt });
          p.state = 'approved';
        } else if (d.status === 'declined' || d.status === 'failed') p.state = 'declined';
        else if (d.status === 'expired') p.state = 'expired';
        else if (!['created', 'pending', 'completed', 'needs_review'].includes(d.status)) p.state = 'unavailable';
      } catch { if (this.current(p)) p.state = 'unavailable'; }
    })().finally(() => { p.checking = undefined; });
    await p.checking;
    this.owned(session, id);
    return this.statusOf(p);
  }
  consume(session: CappySession, id: string): PendingOperation {
    const p = this.owned(session, id);
    if (!this.isApproved(session, session.accountId, 'account-sensitive-read')) {
      throw new VerificationError('verification_required', 'Identity verification is required.');
    }
    this.requests.delete(id); // Consume synchronously before any downstream await.
    return structuredClone(p.operation);
  }
  cancel(session: CappySession, id: string) { this.owned(session, id); this.revoke(session.id); }
  revoke(sessionId: string) {
    this.grants.delete(sessionId);
    for (const [id, p] of this.requests) if (p.session.id === sessionId) this.requests.delete(id);
  }
}
