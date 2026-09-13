import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';
const env = { OPENAI_API_KEY: 'test-key', FLICKY_CLIENT_TOKEN: 'test-client-token' };
test('session endpoint requires auth before making an upstream request', async () => {
  const response = await worker.fetch(new Request('https://test/session', { method: 'POST' }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('rejects non-session paths and methods', async () => {
  assert.equal((await worker.fetch(new Request('https://test/other'), env)).status, 404);
  assert.equal((await worker.fetch(new Request('https://test/session'), env)).status, 405);
});
test('issues only a short-lived audio session and never returns the permanent key', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/client_secrets');
    const body = JSON.parse(init.body);
    assert.equal(body.expires_after.seconds, 60);
    assert.equal(body.session.audio.input.turn_detection, null);
    assert.equal(body.session.audio.output.voice, 'marin');
    assert.equal(body.session.max_output_tokens, 800);
    return Response.json({value:'ephemeral-test'});
  };
  try {
    const response = await worker.fetch(new Request('https://test/session', {method:'POST', headers:{Authorization:'Bearer test-client-token'}}), env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {value:'ephemeral-test'});
  } finally { globalThis.fetch = originalFetch; }
});
test('upstream errors do not expose credentials or raw provider responses', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('sensitive provider error', {status:401});
  try {
    const response = await worker.fetch(new Request('https://test/session', {method:'POST', headers:{Authorization:'Bearer test-client-token'}}), env);
    assert.equal(response.status, 502);
    assert.ok(!(await response.text()).includes('sensitive'));
  } finally { globalThis.fetch = originalFetch; }
});
