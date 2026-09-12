import { describe, expect, it, vi } from 'vitest';
import { VerificationStore } from '../../src/service/verification';
import type { InquiryDecision } from '../../src/service/providers/persona';

function verificationFixture() {
  let now = Date.now(); let status = 'pending'; let referenceId = ''; let sequence = 0;
  const decision = (): InquiryDecision => ({ id: 'inq_test', templateId: 'itmpl_test', environmentId: 'env_test', referenceId, status });
  const provider = {
    createInquiry: vi.fn(async (reference: string) => { referenceId = reference; return decision(); }),
    getInquiryDecision: vi.fn(async () => decision()),
  };
  const options = { provider, templateId: 'itmpl_test', environmentId: 'env_test', environment: 'sandbox', mode: 'synthetic' as const,
    now: () => now, id: () => `request-${++sequence}` };
  const store = new VerificationStore(options);
  const session = { id: 'session', userId: 'user', accountId: 'demo-checking', issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3600_000).toISOString() };
  return { store, session, provider, options, decision, setStatus: (value: string) => { status = value; }, advance: (ms: number) => { now += ms; } };
}
const operation = { method: 'GET' as const, url: '/snapshot?accountId=demo-checking' };
describe('verification store', () => {
  it('binds approvals to the session/account, caps expiry and consumes a request once', async () => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await Promise.all([f.store.start(f.session, id), f.store.start(f.session, id)]);
    expect(f.provider.createInquiry).toHaveBeenCalledOnce();
    f.setStatus('approved');
    expect((await f.store.status(f.session, id)).state).toBe('approved');
    expect(f.store.isApproved(f.session, 'demo-checking', 'account-sensitive-read')).toBe(true);
    expect(f.store.isApproved({ ...f.session, id: 'other' }, 'demo-checking', 'account-sensitive-read')).toBe(false);
    expect(f.store.isApproved(f.session, 'other', 'account-sensitive-read')).toBe(false);
    expect(() => f.store.consume({ ...f.session, id: 'other' }, id)).toThrow();
    expect(f.store.consume(f.session, id)).toEqual(operation);
    expect(() => f.store.consume(f.session, id)).toThrow();
    f.advance(300_000);
    expect(f.store.isApproved(f.session, 'demo-checking', 'account-sensitive-read')).toBe(false);
  });
  it.each(['completed', 'needs_review', 'pending', 'unknown', 'failed', 'declined', 'expired'])('never approves %s', async status => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id); f.setStatus(status); await f.store.status(f.session, id);
    expect(f.store.isApproved(f.session, 'demo-checking', 'account-sensitive-read')).toBe(false);
  });
  it('limits polls and stops after two minutes until an explicit retry', async () => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id);
    await Promise.all([f.store.status(f.session, id), f.store.status(f.session, id)]);
    await f.store.status(f.session, id);
    expect(f.provider.getInquiryDecision).toHaveBeenCalledOnce();
    f.advance(120_000);
    expect((await f.store.status(f.session, id)).state).toBe('retry');
    expect(f.provider.getInquiryDecision).toHaveBeenCalledOnce();
    await f.store.start(f.session, id); await f.store.status(f.session, id);
    expect(f.provider.createInquiry).toHaveBeenCalledOnce();
    expect(f.provider.getInquiryDecision).toHaveBeenCalledTimes(2);
  });
  it('ignores an approval arriving after cancellation', async () => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id); f.setStatus('approved');
    let resolve!: (d: InquiryDecision) => void;
    f.provider.getInquiryDecision.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = f.store.status(f.session, id);
    f.store.cancel(f.session, id); resolve(f.decision());
    await expect(pending).rejects.toThrow();
    expect(f.store.isApproved(f.session, 'demo-checking', 'account-sensitive-read')).toBe(false);
  });
  it.each(['referenceId', 'templateId', 'environmentId', 'id'] as const)('rejects mismatched %s', async key => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id); f.setStatus('approved');
    f.provider.getInquiryDecision.mockResolvedValue({ ...f.decision(), [key]: 'foreign' });
    expect((await f.store.status(f.session, id)).state).toBe('unavailable');
    expect(f.store.isApproved(f.session, 'demo-checking', 'account-sensitive-read')).toBe(false);
  });
  it('does not unlock recorded/live data or accept production configuration in this sandbox MVP', () => {
    const f = verificationFixture();
    expect(new VerificationStore({ ...f.options, mode: 'recorded-sandbox' }).isConfigured()).toBe(false);
    expect(new VerificationStore({ ...f.options, mode: 'live-sandbox' }).isConfigured()).toBe(false);
    expect(new VerificationStore({ ...f.options, environment: 'production' }).isConfigured()).toBe(false);
  });
  it('caps a grant at session expiry and limits ambiguous creation retries', async () => {
    const f = verificationFixture(); f.session.expiresAt = new Date(f.options.now() + 10_000).toISOString();
    const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id); f.setStatus('approved'); await f.store.status(f.session, id);
    expect(f.store.expiresAt(f.session)).toBe(Date.parse(f.session.expiresAt));
    const other = verificationFixture(); other.provider.createInquiry.mockRejectedValue(new Error('timeout'));
    const request = other.store.remember(other.session, operation)!;
    await other.store.start(other.session, request); await other.store.start(other.session, request);
    expect(other.provider.createInquiry).toHaveBeenCalledOnce();
  });
  it('limits creation attempts across canceled requests and resets after ten minutes', async () => {
    const f = verificationFixture();
    for (let attempt = 0; attempt < 3; attempt++) {
      const id = f.store.remember(f.session, operation)!;
      await f.store.start(f.session, id); f.store.cancel(f.session, id);
    }
    const blocked = f.store.remember(f.session, operation)!;
    await expect(f.store.start(f.session, blocked)).rejects.toThrow('Too many verification attempts');
    expect(f.provider.createInquiry).toHaveBeenCalledTimes(3);
    f.advance(600_000);
    const next = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, next);
    expect(f.provider.createInquiry).toHaveBeenCalledTimes(4);
  });
  it('bounds pending storage and prunes expired requests', () => {
    const f = verificationFixture();
    for (let i = 0; i < 100; i++) f.store.remember({ ...f.session, id: `session-${i}` }, operation);
    expect(() => f.store.remember(f.session, operation)).toThrow('Verification is busy');
    f.advance(600_000);
    expect(f.store.remember(f.session, operation)).toBeTypeOf('string');
    expect(f.store.remember(f.session, { ...operation, body: 'x'.repeat(16_384) })).toBeUndefined();
  });
  it('fails closed on retrieval errors and ignores creation after request replacement', async () => {
    const f = verificationFixture(); const id = f.store.remember(f.session, operation)!;
    await f.store.start(f.session, id);
    f.provider.getInquiryDecision.mockRejectedValueOnce(new Error('network failure'));
    expect((await f.store.status(f.session, id)).state).toBe('unavailable');
    expect(f.store.isApproved(f.session, f.session.accountId, 'account-sensitive-read')).toBe(false);
    f.store.cancel(f.session, id);
    const next = f.store.remember(f.session, operation)!;
    let finish!: (value: InquiryDecision) => void;
    f.provider.createInquiry.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const work = f.store.start(f.session, next);
    f.store.remember(f.session, { ...operation, url: '/profile' });
    finish(f.decision()); await expect(work).rejects.toThrow();
    expect(f.store.isApproved(f.session, f.session.accountId, 'account-sensitive-read')).toBe(false);
  });
});
