import assert from 'node:assert/strict';
import { buildServer } from '../../src/service/server';
import { VerificationStore } from '../../src/service/verification';
import { createPersonaProvider } from '../../src/service/providers/persona';
import { demoSnapshot } from '../../src/fixtures/demo';

async function main() {
  let status = 'pending'; let referenceId = ''; let now = Date.now(); let reads = 0;
  const config = { apiKey: 'test-only', templateId: 'itmpl_test', environmentId: 'env_test' };
  const provider = createPersonaProvider(config, async (_url, init) => {
    if (init?.method === 'POST') referenceId = JSON.parse(init.body as string).meta['auto-create-account-reference-id'];
    return new Response(JSON.stringify({ data: { type: 'inquiry', id: 'inq_test', attributes: { status, 'reference-id': referenceId },
      relationships: { 'inquiry-template': { data: { type: 'inquiry-template', id: config.templateId } } },
    } }), { status: init?.method === 'POST' ? 201 : 200, headers: { 'Persona-Environment-Id': config.environmentId } });
  });
  const verification = new VerificationStore({ provider, templateId: config.templateId, environmentId: config.environmentId,
    environment: 'sandbox', mode: 'synthetic', now: () => now });
  const serviceToken = 'test-service-token-at-least-32-characters';
  const server = buildServer({ sessionToken: serviceToken, accountIds: ['demo-checking'], mode: 'synthetic' },
    { read: async () => { reads++; return demoSnapshot(); } }, { verification });
  try {
    const address = await server.listen({ host: '127.0.0.1', port: 0 });
    let token = serviceToken;
    const request = async (route: string, body?: unknown) => {
      const response = await fetch(address + route, { method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request('/health')).status, 200);
    token = (await request('/auth/login', { email: 'demo@example.com', password: 'demo-password' })).body.id;
    const sessionId = (await request('/session', { accountId: 'demo-checking' })).body.sessionId;
    const locked = await request('/turn', { sessionId, turnId: 'e2e', text: 'Can I afford $200 today?' });
    assert.equal(locked.status, 403); assert.equal(reads, 0);
    const requestId = locked.body.requestId;
    const start = await request('/verification/start', { requestId });
    assert.equal(start.status, 200); assert.match(start.body.hostedUrl, /^https:\/\/inquiry.withpersona.com\/verify\?/);
    assert.equal((await request('/verification/status?requestId=' + requestId)).body.state, 'pending');
    status = 'completed'; now += 2000;
    assert.equal((await request('/verification/status?requestId=' + requestId)).body.state, 'pending');
    status = 'approved'; now += 2000;
    assert.equal((await request('/verification/status?requestId=' + requestId)).body.state, 'approved');
    const resumed = await request('/verification/resume', { requestId });
    assert.equal(resumed.status, 200); assert.equal(resumed.body.result.forecast.minimumCents, -8000);
    assert.equal((await request('/verification/resume', { requestId })).status, 403);
    assert.equal((await request('/snapshot?accountId=demo-checking')).status, 200);
    now += 300_000;
    assert.equal((await request('/snapshot?accountId=demo-checking')).status, 403);
    assert.equal((await request('/auth/logout', {})).status, 200);
    assert.equal((await request('/snapshot?accountId=demo-checking')).status, 401);
    console.log('Verification HTTP e2e passed: locked → pending → approved → resumed once → expired → logged out (mock Persona only).');
  } finally { await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
