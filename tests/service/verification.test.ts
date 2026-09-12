import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../../src/service/server';
import { demoSnapshot } from '../../src/fixtures/demo';

const token = 'service-token-that-is-at-least-32-bytes-long';
const accountId = 'demo-checking';

async function authenticatedServer(options: Parameters<typeof buildServer>[2] = {}) {
  const provider = { read: vi.fn(async () => demoSnapshot()) };
  const server = buildServer({ sessionToken: token, accountIds: [accountId], mode: 'synthetic' }, provider, options);
  const login = await server.inject({ method: 'POST', url: '/auth/login', headers: { authorization: `Bearer ${token}` }, payload: { email: 'demo@example.com', password: 'demo-password' } });
  const session = login.json<{ id: string }>();
  return { server, provider, authorization: `Bearer ${session.id}` };
}

describe('sensitive data verification boundary', () => {
  const servers: ReturnType<typeof buildServer>[] = [];

  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });

  it('returns verification_unavailable and stops protected work before providers', async () => {
    const model = { complete: vi.fn(async () => ({ text: 'should not run', toolCalls: [] })) };
    const synthesize = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const tools = { register: vi.fn(), call: vi.fn(async () => ({ ok: true })) };
    const result = await authenticatedServer({ model, synthesize, tools });
    servers.push(result.server);
    const headers = { authorization: result.authorization };
    const conversation = await result.server.inject({ method: 'POST', url: '/session', headers, payload: { accountId } });
    const sessionId = conversation.json<{ sessionId: string }>().sessionId;

    const responses = await Promise.all([
      result.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers }),
      result.server.inject({ method: 'POST', url: '/forecast', headers, payload: { accountId, purchaseCents: 100, reserveCents: 10000 } }),
      result.server.inject({ method: 'POST', url: '/tool', headers, payload: { name: 'getSnapshot', input: { accountId } } }),
      result.server.inject({ method: 'POST', url: '/turn', headers, payload: { sessionId, turnId: 'turn-1', text: 'Can I afford $10?' } }),
      result.server.inject({ method: 'GET', url: '/profile', headers }),
      result.server.inject({ method: 'POST', url: '/speak', headers, payload: { sessionId, replyId: 'reply-1' } }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ code: 'verification_unavailable' });
    }
    expect(result.provider.read).not.toHaveBeenCalled();
    expect(tools.call).not.toHaveBeenCalled();
    expect(model.complete).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('returns verification_required when Persona is configured but the session has no grant', async () => {
    const result = await authenticatedServer({ verification: { isConfigured: () => true, isApproved: () => false } });
    servers.push(result.server);
    const response = await result.server.inject({ method: 'GET', url: `/snapshot?accountId=${accountId}`, headers: { authorization: result.authorization } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'Identity verification is required.', code: 'verification_required' });
    expect(result.provider.read).not.toHaveBeenCalled();
  });

  it('leaves health, generic help, and session creation available before verification', async () => {
    const result = await authenticatedServer();
    servers.push(result.server);
    const headers = { authorization: result.authorization };
    expect((await result.server.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const conversation = await result.server.inject({ method: 'POST', url: '/session', headers, payload: { accountId } });
    expect(conversation.statusCode).toBe(200);
    const sessionId = conversation.json<{ sessionId: string }>().sessionId;
    const help = await result.server.inject({ method: 'POST', url: '/turn', headers, payload: { sessionId, turnId: 'help-1', text: 'help' } });
    expect(help.statusCode).toBe(200);
    expect(help.json()).toMatchObject({ state: 'idle', text: expect.stringContaining('evaluate purchase cash flow') });
    expect(result.provider.read).not.toHaveBeenCalled();
  });
});
