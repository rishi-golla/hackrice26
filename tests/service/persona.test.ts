import { describe, expect, it, vi } from 'vitest';
import { createPersonaProvider, PersonaError } from '../../src/service/providers/persona';

const config = { apiKey: 'test-key', templateId: 'itmpl_test', environmentId: 'env_test' };
function response(environment = 'env_test') {
  return new Response(JSON.stringify({ data: { type: 'inquiry', id: 'inq_test',
    attributes: { status: 'approved', 'reference-id': 'binding', fields: { private: 'discard me' } },
    relationships: { 'inquiry-template': { data: { type: 'inquiry-template', id: 'itmpl_test' } } },
  } }), { headers: { 'Persona-Environment-Id': environment } });
}
describe('Persona adapter', () => {
  it('uses the pinned API and documented binding fields and retains only decision metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response());
    const provider = createPersonaProvider(config, fetcher);
    const result = await provider.createInquiry('binding');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.withpersona.com/api/v1/inquiries');
    expect(init?.headers).toMatchObject({ 'Persona-Version': '2025-10-27' });
    expect(JSON.parse(init!.body as string)).toEqual({ data: { attributes: { 'inquiry-template-id': 'itmpl_test' } },
      meta: { 'auto-create-account': true, 'auto-create-account-reference-id': 'binding' } });
    expect(result).toEqual({ id: 'inq_test', status: 'approved', referenceId: 'binding', templateId: 'itmpl_test', environmentId: 'env_test' });
  });
  it('rejects a mismatched environment, malformed response and provider errors without exposing payloads', async () => {
    for (const value of [response('env_other'), new Response('{}'), new Response('secret provider details', { status: 401 })]) {
      const provider = createPersonaProvider(config, vi.fn<typeof fetch>().mockResolvedValue(value));
      await expect(provider.getInquiryDecision('inq_test')).rejects.toBeInstanceOf(PersonaError);
    }
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('credential in network error'));
    await expect(createPersonaProvider(config, fetcher).createInquiry('binding')).rejects.toThrow('Identity verification is temporarily unavailable.');
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
