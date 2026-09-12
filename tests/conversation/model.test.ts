import { describe, expect, it, vi } from 'vitest';
import { createDeterministicFormatter, ModelTimeoutError } from '../../src/service/model';
import { createHttpModelProvider } from '../../src/service/providers/model';

describe('Cappy model boundary', () => {
  it('formats offline replies deterministically', async () => {
    const provider = createDeterministicFormatter();
    await expect(provider.complete({ system: 'x', user: 'Yes, projected low is $20.00.', tools: [] })).resolves.toEqual({ text: 'Yes, projected low is $20.00.', toolCalls: [] });
  });
  it('maps provider timeouts to ModelTimeoutError', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => { await new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }); return new Response('{}'); }) as typeof fetch;
    const provider = createHttpModelProvider({ baseUrl: 'http://model.test', model: 'offline-test', fetchImpl, timeoutMs: 1 });
    await expect(provider.complete({ system: 'x', user: 'y', tools: [] })).rejects.toBeInstanceOf(ModelTimeoutError);
  });
});
