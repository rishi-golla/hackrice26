import { ModelTimeoutError, type CappyModelProvider } from '../model';

export type HttpModelProviderOptions = { baseUrl?: string; model?: string; fetchImpl?: typeof fetch; timeoutMs?: number };

export function createHttpModelProvider(options: HttpModelProviderOptions = {}): CappyModelProvider {
  const baseUrl = options.baseUrl ?? process.env.CAPPY_MODEL_BASE_URL;
  const model = options.model ?? process.env.CAPPY_MODEL;
  const timeoutMs = options.timeoutMs ?? Number(process.env.CAPPY_MODEL_TIMEOUT_MS ?? 10_000);
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!baseUrl || !model) throw new Error('CAPPY_MODEL_BASE_URL and CAPPY_MODEL are required');
  return {
    async complete(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ model, messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }], tools: input.tools }),
        });
        if (!response.ok) throw new Error(`Model provider failed (${response.status})`);
        const body = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }> };
        const message = body.choices?.[0]?.message;
        return { text: message?.content ?? '', toolCalls: message?.tool_calls ?? [] };
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') throw new ModelTimeoutError();
        throw error;
      } finally { clearTimeout(timer); }
    },
  };
}
