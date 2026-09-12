import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/service/server';
import { VerificationStore } from '../../src/service/verification';
import { demoSnapshot } from '../../src/fixtures/demo';

const token = 'a-service-token-with-at-least-32-characters';
const accountId = 'demo-checking';
const servers: ReturnType<typeof buildServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.close())); });
async function fixture(extra: Parameters<typeof buildServer>[2] = {}) {
  let now = Date.now(); let referenceId = ''; let status = 'pending';
  const decision = () => ({ id: 'inq_test', status, referenceId, templateId: 'itmpl_test', environmentId: 'env_test' });
  const provider = { createInquiry: vi.fn(async (ref: string) => { referenceId = ref; return decision(); }), getInquiryDecision: vi.fn(async () => decision()) };
  const verification = new VerificationStore({ provider, templateId: 'itmpl_test', environmentId: 'env_test', environment: 'sandbox', mode: 'synthetic', now: () => now });
  const read = vi.fn(async () => demoSnapshot());
  const synthesize = vi.fn(async () => new Uint8Array([1]));
  const server = buildServer({ sessionToken: token, accountIds: [accountId], mode: 'synthetic' }, { read }, { verification, synthesize, ...extra });
  servers.push(server);
  async function login() {
    const r = await server.inject({ method: 'POST', url: '/auth/login', headers: { authorization: `Bearer ${token}` }, payload: { email: 'demo@example.com', password: 'demo-password' } });
    return { authorization: `Bearer ${r.json().id}` };
  }
  const headers = await login();
  const sessionId = (await server.inject({ method: 'POST', url: '/session', headers, payload: { accountId } })).json().sessionId;
  const post = (url: string, payload: unknown) => server.inject({ method: 'POST', url, headers, payload: payload as object });
  async function approve(requestId: string) {
    expect((await post('/verification/start', { requestId })).statusCode).toBe(200);
    status = 'approved';
    const r = await server.inject({ method: 'GET', url: `/verification/status?requestId=${requestId}`, headers });
    expect(r.json().state).toBe('approved');
  }
  return { server, headers, sessionId, post, approve, login, read, synthesize, provider, decision,
    setStatus: (value: string) => { status = value; }, advance: (ms: number) => { now += ms; } };
}
describe('verification HTTP workflow', () => {
  it('denies every direct protected route before a grant without invoking downstream work', async () => {
    const tools = { register: vi.fn(), call: vi.fn() };
    const model = { complete: vi.fn() };
    const f = await fixture({ tools, model });
    const responses = await Promise.all([
      f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: f.headers }),
      f.server.inject({ method: 'GET', url: '/profile', headers: f.headers }),
      f.server.inject({ method: 'PUT', url: '/profile', headers: f.headers, payload: { reserveCents: 100, riskStyle: 'calm', language: 'en-US', monitoringEnabled: false } }),
      f.post('/forecast', { accountId, purchaseCents: 100, reserveCents: 10000 }),
      f.post('/tool', { name: 'getSnapshot', input: { accountId } }),
      f.post('/turn', { sessionId: f.sessionId, turnId: 'locked', text: 'Explain my balance' }),
      f.post('/speak', { sessionId: f.sessionId, replyId: 'unknown' }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('verification_required');
      expect(response.headers['cache-control']).toBe('no-store');
    }
    expect(f.read).not.toHaveBeenCalled(); expect(tools.call).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled(); expect(f.synthesize).not.toHaveBeenCalled();
  });
  it('blocks, approves, resumes once, rejects other sessions, then blocks old speech after expiry', async () => {
    const f = await fixture();
    const body = { sessionId: f.sessionId, turnId: 'test-turn', text: 'Can I afford $200 today?' };
    const denied = await f.post('/turn', body);
    expect(denied.statusCode).toBe(403); expect(f.read).not.toHaveBeenCalled();
    const { requestId } = denied.json(); expect(requestId).toBeTypeOf('string');
    await f.approve(requestId);
    const resumed = await f.post('/verification/resume', { requestId });
    expect(resumed.statusCode).toBe(200);
    const answer = resumed.json().result;
    expect(answer.forecast.minimumCents).toBe(-8000); expect(answer.sensitive).toBe(true);
    expect((await f.post('/verification/resume', { requestId })).statusCode).toBe(403);
    expect((await f.server.inject({ method: 'GET', url: '/profile', headers: f.headers })).statusCode).toBe(200);
    expect((await f.post('/forecast', { accountId, purchaseCents: 100, reserveCents: 10000 })).statusCode).toBe(200);
    expect((await f.post('/tool', { name: 'getSnapshot', input: { accountId } })).statusCode).toBe(200);
    const stranger = await f.login();
    expect((await f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: stranger })).statusCode).toBe(403);
    expect((await f.server.inject({ method: 'POST', url: '/turn', payload: body, headers: stranger })).statusCode).toBe(403);
    expect((await f.post('/speak', { sessionId: f.sessionId, replyId: answer.replyId })).statusCode).toBe(200);
    expect(f.synthesize).toHaveBeenCalledOnce();
    f.advance(300_000);
    const oldSpeech = await f.post('/speak', { sessionId: f.sessionId, replyId: answer.replyId });
    expect(oldSpeech.statusCode).toBe(403); expect(f.synthesize).toHaveBeenCalledOnce();
    // Renewing an old speech request recomputes a text answer; it never auto-uploads old audio.
    await f.approve(oldSpeech.json().requestId);
    const fresh = await f.post('/verification/resume', { requestId: oldSpeech.json().requestId });
    expect(fresh.json().operation).toBe('/turn'); expect(f.synthesize).toHaveBeenCalledOnce();
  });
  it('rejects client-supplied approval and foreign pending IDs and keeps generic help usable', async () => {
    const f = await fixture();
    const denied = await f.post('/forecast', { accountId, purchaseCents: 100, reserveCents: 10000 });
    const { requestId } = denied.json();
    expect((await f.post('/verification/start', { requestId, approved: true })).statusCode).toBe(400);
    const stranger = await f.login();
    expect((await f.server.inject({ method: 'POST', url: '/verification/start', headers: stranger, payload: { requestId } })).statusCode).toBe(403);
    const help = await f.post('/turn', { sessionId: f.sessionId, turnId: 'help', text: 'help' });
    expect(help.json().sensitive).toBe(false);
    expect((await f.post('/speak', { sessionId: f.sessionId, replyId: help.json().replyId })).statusCode).toBe(200);
    expect(f.read).not.toHaveBeenCalled();
    const mixed = await f.post('/turn', { sessionId: f.sessionId, turnId: 'mixed', text: 'help explain my balance' });
    expect(mixed.statusCode).toBe(403);
  });
  it.each(['logout', 'expiry', 'lock then reapprove'])('withholds model output after %s', async invalidation => {
    let finish!: (value: { text: string; toolCalls: unknown[] }) => void;
    const complete = vi.fn(() => new Promise<{ text: string; toolCalls: unknown[] }>(resolve => { finish = resolve; }));
    const f = await fixture({ model: { complete } });
    const body = { sessionId: f.sessionId, turnId: 'race', text: 'Can I afford $10?' };
    const denied = await f.post('/turn', body); await f.approve(denied.json().requestId);
    const work = f.post('/turn', body).then(r => r);
    await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
    if (invalidation === 'logout') await f.post('/auth/logout', {});
    else if (invalidation === 'expiry') f.advance(300_000);
    else {
      await f.post('/verification/lock', {});
      const denied = await f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: f.headers });
      await f.approve(denied.json().requestId);
    }
    finish({ text: 'protected answer', toolCalls: [] });
    const result = await work;
    expect(result.statusCode).toBe(invalidation === 'logout' ? 401 : 403); expect(result.body).not.toContain('protected answer');
  });
  it.each(['lock', 'expiry', 'logout'])('withholds pending audio after %s', async invalidation => {
    let finish!: (value: Uint8Array) => void;
    const synthesize = vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
    const f = await fixture({ synthesize });
    const body = { sessionId: f.sessionId, turnId: 'speech', text: 'Can I afford $10?' };
    const denied = await f.post('/turn', body); await f.approve(denied.json().requestId);
    const answer = (await f.post('/turn', body)).json();
    const work = f.post('/speak', { sessionId: f.sessionId, replyId: answer.replyId }).then(r => r);
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
    if (invalidation === 'expiry') f.advance(300_000);
    else await f.post(invalidation === 'logout' ? '/auth/logout' : '/verification/lock', {});
    finish(new Uint8Array([1, 2]));
    const result = await work; expect(result.statusCode).toBe(invalidation === 'logout' ? 401 : 403);
    expect(result.json()).not.toHaveProperty('audio');
  });
  it.each(['logout', 'expiry'])('rejects a Persona approval arriving after %s', async invalidation => {
    const f = await fixture();
    const denied = await f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: f.headers });
    const { requestId } = denied.json();
    await f.post('/verification/start', { requestId }); f.setStatus('approved');
    let finish!: (value: ReturnType<typeof f.decision>) => void;
    f.provider.getInquiryDecision.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const work = f.server.inject({ method: 'GET', url: `/verification/status?requestId=${requestId}`, headers: f.headers }).then(r => r);
    await vi.waitFor(() => expect(f.provider.getInquiryDecision).toHaveBeenCalledOnce());
    if (invalidation === 'logout') await f.post('/auth/logout', {});
    else f.advance(600_000);
    finish(f.decision());
    expect((await work).statusCode).toBe(403);
    expect((await f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: f.headers })).statusCode).toBe(invalidation === 'logout' ? 401 : 403);
    expect(f.read).not.toHaveBeenCalled();
  });
  it('withholds a snapshot fetched across grant expiry', async () => {
    const f = await fixture();
    const url = `/snapshot?accountId=${accountId}`;
    const denied = await f.server.inject({ method: 'GET', url, headers: f.headers });
    await f.approve(denied.json().requestId);
    let finish!: (value: ReturnType<typeof demoSnapshot>) => void;
    f.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const work = f.server.inject({ method: 'GET', url, headers: f.headers }).then(r => r);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce());
    f.advance(300_000); finish(demoSnapshot());
    const result = await work;
    expect(result.statusCode).toBe(403); expect(result.json()).not.toHaveProperty('balanceCents');
  });
  it('executes only one of two concurrent resumes', async () => {
    const f = await fixture();
    const denied = await f.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: f.headers });
    const { requestId } = denied.json(); await f.approve(requestId);
    const responses = await Promise.all([f.post('/verification/resume', { requestId }), f.post('/verification/resume', { requestId })]);
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 403]);
    expect(f.read).toHaveBeenCalledOnce();
  });
});
