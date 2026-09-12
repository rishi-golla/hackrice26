import { z } from 'zod';

export interface InquiryDecision {
  id: string;
  referenceId: string;
  templateId: string;
  environmentId: string;
  status: string;
}
export interface PersonaProvider {
  createInquiry(referenceId: string): Promise<InquiryDecision>;
  getInquiryDecision(inquiryId: string): Promise<InquiryDecision>;
}
export interface PersonaConfig {
  apiKey: string;
  templateId: string;
  environmentId: string;
}
export class PersonaError extends Error {
  constructor(readonly reason: 'http' | 'network' | 'invalid_response', readonly httpStatus?: number) {
    super('Identity verification is temporarily unavailable.');
    this.name = 'PersonaError';
  }
}
const inquiryId = z.string().regex(/^inq_[A-Za-z0-9]+$/);
const inquiry = z.object({ data: z.object({
  type: z.literal('inquiry'), id: inquiryId,
  attributes: z.object({ status: z.string(), 'reference-id': z.string().min(1) }),
  relationships: z.object({ 'inquiry-template': z.object({ data: z.object({
    type: z.literal('inquiry-template'), id: z.string().regex(/^itmpl_[A-Za-z0-9]+$/),
  }) }) }),
}) });

// Pinned to Persona's published 2025-10-27 OpenAPI schema. Only decision metadata survives parsing.
export function createPersonaProvider(config: PersonaConfig, fetcher: typeof fetch = fetch): PersonaProvider {
  async function request(path: string, body?: unknown): Promise<InquiryDecision> {
    try {
      const response = await fetcher('https://api.withpersona.com/api/v1/inquiries' + path, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', 'Persona-Version': '2025-10-27' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new PersonaError('http', response.status);
      const parsed = inquiry.safeParse(await response.json());
      const environmentId = response.headers.get('Persona-Environment-Id');
      if (!parsed.success || environmentId !== config.environmentId) throw new PersonaError('invalid_response');
      const { data } = parsed.data;
      return { id: data.id, referenceId: data.attributes['reference-id'], status: data.attributes.status,
        templateId: data.relationships['inquiry-template'].data.id, environmentId };
    } catch (error) {
      if (error instanceof PersonaError) throw error;
      throw new PersonaError('network');
    }
  }
  return {
    createInquiry: referenceId => request('', { data: { attributes: { 'inquiry-template-id': config.templateId } },
      meta: { 'auto-create-account': true, 'auto-create-account-reference-id': referenceId } }),
    getInquiryDecision: id => request('/' + inquiryId.parse(id)),
  };
}
