import Fastify from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { SnapshotStore, type SnapshotProvider } from './snapshot';
import { forecast } from '../domain/forecast';
import { createConversationManager } from './conversation/controller';

export interface ServerConfig {
  sessionToken: string;
  accountIds: string[];
  mode: 'synthetic' | 'recorded-sandbox' | 'live-sandbox';
}
export interface ServiceDependencies {
  conversation?: ReturnType<typeof createConversationManager>;
  transcribe?: (audio: Uint8Array, mime: string, durationMs: number) => Promise<string>;
  synthesize?: (text: string) => Promise<Uint8Array>;
}
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const identifier = z.string().min(1).max(120);
const sessionInput = z.object({ sessionId: identifier }).strict();

/** Only main holds this bearer token. Origin-bearing web requests are denied. */
export function buildServer(config: ServerConfig, provider: SnapshotProvider, deps: ServiceDependencies = {}) {
  if (config.sessionToken.length < 32 || config.accountIds.length === 0) throw new Error('Invalid service configuration');
  const server = Fastify({ logger: false, bodyLimit: 14 * 1024 * 1024 });
  const store = new SnapshotStore(provider);
  const conversation = deps.conversation ?? createConversationManager();
  const sessions = new Map<string, string>();
  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' && request.method === 'GET') return;
    const expected = Buffer.from(`Bearer ${config.sessionToken}`);
    const actual = Buffer.from(request.headers.authorization ?? '');
    if (request.headers.origin || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });
  server.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError || error instanceof RangeError || error instanceof TypeError) {
      return reply.code(400).send({ error: 'Invalid request or financial data' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    return reply.code(status && status >= 400 && status < 500 ? status : 503)
      .send({ error: status === 403 ? 'Unknown account or session' : 'Service unavailable. Try again or use an explicit stale preview.' });
  });
  function account(id: string) {
    if (!config.accountIds.includes(id)) throw Object.assign(new Error('Unknown account'), { statusCode: 403 });
    return id;
  }
  function session(id: string) {
    const accountId = sessions.get(id);
    if (!accountId) throw Object.assign(new Error('Unknown session'), { statusCode: 403 });
    return account(accountId);
  }
  server.get('/health', async () => ({ ok: true }));
  server.get('/snapshot', async request => {
    const query = z.object({ accountId: identifier, refresh: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    return store.get(account(query.accountId), query.refresh === 'true');
  });
  server.post('/forecast', async (request, reply) => {
    const body = z.object({ accountId: identifier, purchaseCents: cents, reserveCents: cents, allowStale: z.boolean().optional() }).strict().parse(request.body);
    const snapshot = await store.get(account(body.accountId), true);
    if (snapshot.stale && !body.allowStale) return reply.code(409).send({ error: 'Snapshot is stale. Confirm a stale preview to continue.' });
    return forecast(snapshot, body.purchaseCents, body.reserveCents);
  });
  server.post('/session', async request => {
    const body = z.object({ accountId: identifier }).strict().parse(request.body);
    // One desktop session per account; creating another invalidates the old memory.
    const accountId = account(body.accountId);
    for (const [id, existing] of sessions) if (existing === accountId) { conversation.forget(id); sessions.delete(id); }
    const result = conversation.createSession(accountId, config.mode);
    sessions.set(result.id, accountId);
    return { sessionId: result.id };
  });
  server.post('/candidate', async request => {
    const body = z.object({ sessionId: identifier, purchase: z.object({
      id: identifier, label: z.string().min(1).max(120), cents, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      origin: z.enum(['screen', 'spoken', 'typed']), confirmed: z.boolean(),
    }).strict() }).strict().parse(request.body);
    session(body.sessionId);
    conversation.registerCandidate(body.sessionId, body.purchase);
    return { ok: true };
  });
  server.post('/turn', async request => {
    const body = z.object({ sessionId: identifier, turnId: identifier, text: z.string().trim().min(1).max(2000),
      candidateId: identifier.optional(), allowStale: z.boolean().optional(), hover: z.boolean().optional() }).strict().parse(request.body);
    const snapshot = await store.get(session(body.sessionId), !body.hover);
    return conversation.turn(body, snapshot);
  });
  server.post('/cancel', async request => { const { sessionId } = sessionInput.parse(request.body); session(sessionId); conversation.cancel(sessionId); return { ok: true }; });
  server.post('/forget', async request => { const { sessionId } = sessionInput.parse(request.body); session(sessionId); conversation.forget(sessionId); return { ok: true }; });
  server.post('/transcribe', async (request, reply) => {
    const body = z.object({ sessionId: identifier, audio: z.string().max(14 * 1024 * 1024),
      mime: z.enum(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']),
      durationMs: z.number().positive().max(30000) }).strict().parse(request.body);
    session(body.sessionId);
    if (!deps.transcribe) return reply.code(503).send({ error: 'Transcription is unavailable. Type your question.' });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio)) throw new TypeError('Invalid audio');
    const audio = Buffer.from(body.audio, 'base64');
    if (!audio.length || audio.length > 10 * 1024 * 1024) throw new TypeError('Invalid audio size');
    return { text: await deps.transcribe(audio, body.mime, body.durationMs) };
  });
  server.post('/speak', async (request, reply) => {
    const body = z.object({ sessionId: identifier, replyId: identifier }).strict().parse(request.body);
    session(body.sessionId);
    const answer = conversation.getReply(body.sessionId, body.replyId);
    if (!answer) return reply.code(404).send({ error: 'Reply expired' });
    if (!deps.synthesize) return reply.code(503).send({ error: 'Speech is unavailable' });
    const audio = await deps.synthesize(answer.text);
    return { audio: Buffer.from(audio).toString('base64') };
  });
  return server;
}
