import { describe, expect, it } from 'vitest';
import { NessieClient, NessieProviderError } from '../../src/service/providers/nessie';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('NessieClient', () => {
  it('constructs requests with the key query parameter', async () => {
    let requested = '';
    const client = new NessieClient({ apiKey: 'secret-key', baseUrl: 'https://api.example.test' , fetchImpl: async (input) => { requested = String(input); return response({ _id: 'c1' }); } });
    await client.getCustomer('c1');
    expect(requested).toBe('https://api.example.test/customers/c1?key=secret-key');
  });

  it('uses the official production host by default', async () => {
    let requested = '';
    const client = new NessieClient({ apiKey: 'secret-key', fetchImpl: async (input) => { requested = String(input); return response({}); } });
    await client.listAtms();
    expect(requested).toBe('https://prod-api.nessieisreal.com/atms?key=secret-key');
  });

  it.each([[401, 'auth'], [403, 'auth'], [404, 'not-found']] as const)('maps %s to %s', async (status, kind) => {
    const client = new NessieClient({ apiKey: 'secret', fetchImpl: async () => response({}, status), retryCount: 0 });
    let error!: NessieProviderError;
    try { await client.getCustomer('c1'); } catch (e) { error = e as NessieProviderError; }
    expect(error).toBeInstanceOf(NessieProviderError);
    expect(error.kind).toBe(kind);
  });

  it('retries a 503 and succeeds', async () => {
    let attempts = 0;
    const client = new NessieClient({ apiKey: 'secret', retryCount: 1, fetchImpl: async () => ++attempts === 1 ? response({}, 503) : response({ _id: 'c1' }) });
    await expect(client.getCustomer('c1')).resolves.toEqual({ _id: 'c1' });
    expect(attempts).toBe(2);
  });

  it('retries a 429 and succeeds', async () => {
    let attempts = 0;
    const client = new NessieClient({ apiKey: 'secret', retryCount: 1, fetchImpl: async () => ++attempts === 1 ? response({}, 429) : response({ ok: true }) });
    await expect(client.getCustomer('c1')).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('retries a network failure and succeeds', async () => {
    let attempts = 0;
    const client = new NessieClient({ apiKey: 'secret', retryCount: 1, fetchImpl: async () => { attempts += 1; if (attempts === 1) throw new Error('network'); return response({ ok: true }); } });
    await expect(client.getCustomer('c1')).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  it('rejects invalid retry and timeout options', () => {
    expect(() => new NessieClient({ apiKey: 'secret', retryCount: Infinity })).toThrowError(/retry count/);
    expect(() => new NessieClient({ apiKey: 'secret', timeoutMs: 0 })).toThrowError(/timeout/);
  });

  it('maps timeout aborts to transient', async () => {
    const client = new NessieClient({ apiKey: 'secret', timeoutMs: 1, retryCount: 0, fetchImpl: async (_input, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }) });
    let error!: NessieProviderError;
    try { await client.getCustomer('c1'); } catch (e) { error = e as NessieProviderError; }
    expect(error.kind).toBe('transient');
  });

  it('maps malformed JSON to invalid-response without exposing the key', async () => {
    const client = new NessieClient({ apiKey: 'secret-key', retryCount: 0, fetchImpl: async () => new Response('nope', { status: 200 }) });
    let error!: NessieProviderError;
    try { await client.getCustomer('c1'); } catch (e) { error = e as NessieProviderError; }
    expect(error.kind).toBe('invalid-response');
    expect(error.message).not.toContain('secret-key');
  });
});
