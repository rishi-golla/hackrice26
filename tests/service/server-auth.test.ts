import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/service/server';
import { demoSnapshot } from '../../src/fixtures/demo';

describe('authenticated service routes', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
  it('requires a local session and enforces its account binding', async () => {
    const token = 'service-token-that-is-at-least-32-bytes-long';
    const server = buildServer({ sessionToken: token, accountIds: ['demo-checking'], mode: 'synthetic' }, { read: async () => demoSnapshot() }); servers.push(server);
    const login = await server.inject({ method: 'POST', url: '/auth/login', headers: { authorization: `Bearer ${token}` }, payload: { email: 'demo@example.com', password: 'demo-password' } });
    expect(login.statusCode).toBe(200);
    const session = login.json<{ id: string }>();
    expect((await server.inject({ method: 'GET', url: '/snapshot?accountId=demo-checking' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/snapshot?accountId=demo-checking', headers: { authorization: `Bearer ${session.id}` } })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/snapshot?accountId=other', headers: { authorization: `Bearer ${session.id}` } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'POST', url: '/auth/logout', headers: { authorization: `Bearer ${session.id}` }, payload: {} })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/auth/session', headers: { authorization: `Bearer ${session.id}` } })).statusCode).toBe(401);
  });
});
