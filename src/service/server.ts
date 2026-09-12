import Fastify from 'fastify';
import { z } from 'zod';
import { SnapshotStore, type SnapshotProvider } from './snapshot';
import { forecast } from '../domain/forecast';
import { createConversationManager } from './conversation/controller';
import { createDemoAuthProvider, type CappyAuthProvider, type CappySession } from './auth';
import { ProfileStore } from './profile';
import { assertAccountAccess } from './policy';

export interface ServerConfig {
  sessionToken: string;
  accountIds: string[];
  mode: 'synthetic' | 'recorded-sandbox' | 'live-sandbox';
}
export interface ServiceDependencies {
  conversation?: ReturnType<typeof createConversationManager>;
  transcribe?: (audio: Uint8Array, mime: string, durationMs: number) => Promise<string>;
  synthesize?: (text: string) => Promise<Uint8Array>;
  auth?: CappyAuthProvider;
  profiles?: ProfileStore;
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
  const auth = deps.auth ?? createDemoAuthProvider();
  const profiles = deps.profiles ?? new ProfileStore();
  const authenticated = new WeakMap<object, CappySession>();
  const validServiceToken = (value: string | undefined) => value === `Bearer ${config.sessionToken}`;
  server.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' && request.method === 'GET') return;
    if (request.headers.origin) return reply.code(401).send({ error: 'Unauthorized' });
    if (request.url === '/auth/login' && request.method === 'POST') {
      if (!validServiceToken(request.headers.authorization)) return reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : '';
    try { authenticated.set(request, await auth.validate(token)); }
    catch { return reply.code(401).send({ error: 'Unauthorized' }); }
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
  function current(request: object) { const value = authenticated.get(request); if (!value) throw Object.assign(new Error('Unknown session'), { statusCode: 401 }); return value; }
  function accountFor(request: object, id: string) { return assertAccountAccess(current(request), account(id)); }
  function conversationSession(id: string) {
    const value = conversation.getSession(id);
    if (!value) throw Object.assign(new Error('Unknown conversation session'), { statusCode: 403 });
    return value.accountId;
  }
  server.get('/health', async () => ({ ok: true }));
  server.post('/auth/login', async request => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict().parse(request.body);
    return auth.login(body.email, body.password);
  });
  server.post('/auth/logout', async request => { await auth.logout(current(request).id); return { ok: true }; });
  server.get('/auth/session', async request => current(request));
  server.get('/profile', async request => {
    const session = current(request); const query = z.object({ accountId: identifier.optional() }).strict().parse(request.query);
    if (query.accountId) assertAccountAccess(session, query.accountId);
    return profiles.get(session.userId, session.accountId);
  });
  server.put('/profile', async request => {
    const session = current(request); const body = z.object({ accountId: identifier.optional(), reserveCents: z.number().int().nonnegative(), riskStyle: z.enum(['calm', 'direct', 'detailed']), language: z.literal('en-US'), monitoringEnabled: z.boolean() }).strict().parse(request.body);
    if (body.accountId) assertAccountAccess(session, body.accountId);
    return profiles.update(session.userId, session.accountId, body);
  });
  server.get('/snapshot', async request => {
    const query = z.object({ accountId: identifier, refresh: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    return store.get(accountFor(request, query.accountId), query.refresh === 'true');
  });
  server.post('/forecast', async (request, reply) => {
    const body = z.object({ accountId: identifier, purchaseCents: cents, reserveCents: cents, allowStale: z.boolean().optional() }).strict().parse(request.body);
    const snapshot = await store.get(accountFor(request, body.accountId), true);
    if (snapshot.stale && !body.allowStale) return reply.code(409).send({ error: 'Snapshot is stale. Confirm a stale preview to continue.' });
    return forecast(snapshot, body.purchaseCents, body.reserveCents);
  });
  server.post('/session', async request => {
    const body = z.object({ accountId: identifier }).strict().parse(request.body);
    // One desktop session per account; creating another invalidates the old memory.
    const accountId = accountFor(request, body.accountId);
    const result = conversation.createSession(accountId, config.mode);
    return { sessionId: result.id };
  });
  server.post('/candidate', async request => {
    const body = z.object({ sessionId: identifier, purchase: z.object({
      id: identifier, label: z.string().min(1).max(120), cents, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      origin: z.enum(['screen', 'spoken', 'typed']), confirmed: z.boolean(),
    }).strict() }).strict().parse(request.body);
    const authSession = current(request); if (conversationSession(body.sessionId) !== authSession.accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    conversation.registerCandidate(body.sessionId, body.purchase);
    return { ok: true };
  });
  server.post('/turn', async request => {
    const body = z.object({ sessionId: identifier, turnId: identifier, text: z.string().trim().min(1).max(2000),
      candidateId: identifier.optional(), allowStale: z.boolean().optional(), hover: z.boolean().optional() }).strict().parse(request.body);
    const authSession = current(request); if (conversationSession(body.sessionId) !== authSession.accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    const snapshot = await store.get(authSession.accountId, !body.hover);
    return conversation.turn(body, snapshot);
  });
  server.post('/cancel', async request => { const { sessionId } = sessionInput.parse(request.body); if (conversationSession(sessionId) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 }); conversation.cancel(sessionId); return { ok: true }; });
  server.post('/forget', async request => { const { sessionId } = sessionInput.parse(request.body); if (conversationSession(sessionId) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 }); conversation.forget(sessionId); return { ok: true }; });
  server.post('/transcribe', async (request, reply) => {
    const body = z.object({ sessionId: identifier, audio: z.string().max(14 * 1024 * 1024),
      mime: z.enum(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']),
      durationMs: z.number().positive().max(30000) }).strict().parse(request.body);
    if (conversationSession(body.sessionId) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    if (!deps.transcribe) return reply.code(503).send({ error: 'Transcription is unavailable. Type your question.' });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio)) throw new TypeError('Invalid audio');
    const audio = Buffer.from(body.audio, 'base64');
    if (!audio.length || audio.length > 10 * 1024 * 1024) throw new TypeError('Invalid audio size');
    return { text: await deps.transcribe(audio, body.mime, body.durationMs) };
  });
  server.post('/speak', async (request, reply) => {
    const body = z.object({ sessionId: identifier, replyId: identifier }).strict().parse(request.body);
    if (conversationSession(body.sessionId) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    const answer = conversation.getReply(body.sessionId, body.replyId);
    if (!answer) return reply.code(404).send({ error: 'Reply expired' });
    if (!deps.synthesize) return reply.code(503).send({ error: 'Speech is unavailable' });
    const audio = await deps.synthesize(answer.text);
    return { audio: Buffer.from(audio).toString('base64') };
  });
  return server;
}
