import Fastify from 'fastify';
import { z } from 'zod';
import { SnapshotStore, type SnapshotProvider } from './snapshot';
import { forecast } from '../domain/forecast';
import { createConversationManager } from './conversation/controller';
import { isGenericHelpRequest } from './conversation/router';
import { createDemoAuthProvider, type CappyAuthProvider, type CappySession } from './auth';
import { ProfileStore } from './profile';
import { assertAccountAccess, requireVerification } from './policy';
import { createCappyToolRegistry, type CappyToolRegistry } from './tools';
import { createDeterministicFormatter, type CappyModelProvider } from './model';
import { unavailableVerificationGate, VerificationError, VerificationStore, type VerificationGate, type PendingOperation } from './verification';

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
  tools?: CappyToolRegistry;
  model?: CappyModelProvider;
  verification?: VerificationGate;
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
  const verification = deps.verification ?? unavailableVerificationGate;
  const verificationStore = verification instanceof VerificationStore ? verification : undefined;
  const tools = deps.tools ?? createCappyToolRegistry({ snapshot: accountId => store.get(accountId, false), verification });
  const model = deps.model ?? createDeterministicFormatter();
  const authenticated = new WeakMap<object, CappySession>();
  const protectedRequests = new WeakMap<object, string | undefined>();
  const conversationOwners = new Map<string, string>();
  const replyRequests = new Map<string, { owner: string; body: unknown; sensitive: boolean }>();
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
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof VerificationError) {
      const session = authenticated.get(request);
      const resumable = ['/snapshot', '/forecast', '/tool', '/turn', '/profile', '/speak'].includes(request.routeOptions.url ?? '');
      const speechRequest = request.routeOptions.url === '/speak'
        ? replyRequests.get((request.body as { replyId: string }).replyId) : undefined;
      const operation: PendingOperation = speechRequest && speechRequest.owner === session?.id
        ? { method: 'POST', url: '/turn', body: speechRequest.body }
        : { method: request.method as PendingOperation['method'], url: request.url, body: request.body };
      const requestId = session && resumable && error.code === 'verification_required' && (request.routeOptions.url !== '/speak' || speechRequest?.owner === session.id)
        ? verificationStore?.remember(session, operation) : undefined;
      return reply.code(error.statusCode).send({ error: error.message, code: error.code, ...(requestId ? { requestId } : {}) });
    }
    if (error instanceof z.ZodError || error instanceof RangeError || error instanceof TypeError) {
      return reply.code(400).send({ error: 'Invalid request or financial data' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    return reply.code(status && status >= 400 && status < 500 ? status : 503)
      .send({ error: status === 403 ? 'Unknown account or session' : 'Service unavailable. Try again or use an explicit stale preview.' });
  });
  server.addHook('onSend', async (request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    if (reply.statusCode < 400 && protectedRequests.has(request)) {
      await recheck(request);
      protectedRequests.delete(request);
    }
    return payload;
  });
  function account(id: string) {
    if (!config.accountIds.includes(id)) throw Object.assign(new Error('Unknown account'), { statusCode: 403 });
    return id;
  }
  function current(request: object) { const value = authenticated.get(request); if (!value) throw Object.assign(new Error('Unknown session'), { statusCode: 401 }); return value; }
  function accountFor(request: object, id: string) { return assertAccountAccess(current(request), account(id)); }
  function protectedAccountFor(request: object, id: string) {
    const accountId = requireVerification(current(request), account(id), 'account-sensitive-read', verification);
    protectedRequests.set(request, verification.grantId?.(current(request)));
    return accountId;
  }
  async function recheck(request: object) {
    const session = await auth.validate(current(request).id);
    requireVerification(session, session.accountId, 'account-sensitive-read', verification);
    // A newly approved grant must not revive work started under a revoked grant.
    if (verification.grantId && protectedRequests.get(request) !== verification.grantId(session)) {
      throw new VerificationError('verification_required', 'Verification changed. Continue with a fresh request.');
    }
  }
  function saveReplyRequest(replyId: string, session: CappySession, body: unknown, sensitive: boolean) {
    if (replyRequests.size >= 100) replyRequests.delete(replyRequests.keys().next().value!);
    replyRequests.set(replyId, { owner: session.id, body, sensitive });
  }
  function conversationSession(id: string, request: object) {
    const value = conversation.getSession(id);
    if (!value || conversationOwners.get(id) !== current(request).id) throw Object.assign(new Error('Unknown conversation session'), { statusCode: 403 });
    return value.accountId;
  }
  server.get('/health', async () => ({ ok: true }));
  server.post('/auth/login', async request => {
    const body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) }).strict().parse(request.body);
    return auth.login(body.email, body.password);
  });
  server.post('/auth/logout', async request => {
    const session = current(request);
    verificationStore?.revoke(session.id);
    for (const [id, saved] of replyRequests) if (saved.owner === session.id) replyRequests.delete(id);
    for (const [id, owner] of conversationOwners) if (owner === session.id) { conversation.cancel(id); conversation.forget(id); conversationOwners.delete(id); }
    await auth.logout(session.id); return { ok: true };
  });
  server.get('/auth/session', async request => current(request));
  const verificationInput = z.object({ requestId: identifier }).strict();
  function flow() { if (!verificationStore) throw new VerificationError('verification_unavailable', 'Identity verification is unavailable.'); return verificationStore; }
  server.post('/verification/start', async request => flow().start(current(request), verificationInput.parse(request.body).requestId));
  server.get('/verification/status', async request => flow().status(current(request), verificationInput.parse(request.query).requestId));
  server.post('/verification/cancel', async request => { flow().cancel(current(request), verificationInput.parse(request.body).requestId); return { ok: true }; });
  server.post('/verification/lock', async request => { z.object({}).strict().parse(request.body); verificationStore?.revoke(current(request).id); return { ok: true }; });
  server.post('/verification/resume', async (request, reply) => {
    const session = current(request);
    const operation = flow().consume(session, verificationInput.parse(request.body).requestId);
    protectedAccountFor(request, session.accountId);
    // Replay only the validated operation stored by this server, under the same auth session.
    const response = await server.inject({ method: operation.method, url: operation.url,
      headers: { authorization: `Bearer ${session.id}` }, payload: operation.body as Record<string, unknown> | undefined });
    if (response.statusCode >= 400) return reply.code(response.statusCode).send(response.json());
    return reply.code(response.statusCode).send({ result: response.json(), operation: new URL(operation.url, 'http://local').pathname,
      expiresAt: verification.expiresAt?.(session) });
  });
  server.get('/profile', async request => {
    const session = current(request); const query = z.object({ accountId: identifier.optional() }).strict().parse(request.query);
    protectedAccountFor(request, query.accountId ?? session.accountId);
    return profiles.get(session.userId, session.accountId);
  });
  server.put('/profile', async request => {
    const session = current(request); const body = z.object({ accountId: identifier.optional(), reserveCents: z.number().int().nonnegative(), riskStyle: z.enum(['calm', 'direct', 'detailed']), language: z.literal('en-US'), monitoringEnabled: z.boolean() }).strict().parse(request.body);
    protectedAccountFor(request, body.accountId ?? session.accountId);
    return profiles.update(session.userId, session.accountId, body);
  });
  server.get('/snapshot', async request => {
    const query = z.object({ accountId: identifier, refresh: z.enum(['true', 'false']).optional() }).strict().parse(request.query);
    return store.get(protectedAccountFor(request, query.accountId), query.refresh === 'true');
  });
  server.post('/tool', async request => {
    const body = z.object({ name: identifier, input: z.unknown() }).strict().parse(request.body);
    const session = current(request);
    const input = z.object({ accountId: identifier }).passthrough().parse(body.input);
    protectedAccountFor(request, input.accountId);
    return tools.call(body.name, body.input, { session, profile: profiles.get(session.userId, session.accountId) });
  });
  server.post('/forecast', async (request, reply) => {
    const body = z.object({ accountId: identifier, purchaseCents: cents, reserveCents: cents, allowStale: z.boolean().optional() }).strict().parse(request.body);
    const snapshot = await store.get(protectedAccountFor(request, body.accountId), true);
    if (snapshot.stale && !body.allowStale) return reply.code(409).send({ error: 'Snapshot is stale. Confirm a stale preview to continue.' });
    return forecast(snapshot, body.purchaseCents, body.reserveCents);
  });
  server.post('/session', async request => {
    const body = z.object({ accountId: identifier }).strict().parse(request.body);
    // One desktop session per account; creating another invalidates the old memory.
    const accountId = accountFor(request, body.accountId);
    const result = conversation.createSession(accountId, config.mode);
    conversationOwners.set(result.id, current(request).id);
    return { sessionId: result.id };
  });
  server.post('/candidate', async request => {
    const body = z.object({ sessionId: identifier, purchase: z.object({
      id: identifier, label: z.string().min(1).max(120), cents, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      origin: z.enum(['screen', 'spoken', 'typed']), confirmed: z.boolean(),
    }).strict() }).strict().parse(request.body);
    const authSession = current(request); if (conversationSession(body.sessionId, request) !== authSession.accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    conversation.registerCandidate(body.sessionId, body.purchase);
    return { ok: true };
  });
  server.post('/turn', async request => {
    const body = z.object({ sessionId: identifier, turnId: identifier, text: z.string().trim().min(1).max(2000),
      candidateId: identifier.optional(), allowStale: z.boolean().optional(), hover: z.boolean().optional() }).strict().parse(request.body);
    const authSession = current(request); if (conversationSession(body.sessionId, request) !== authSession.accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    if (isGenericHelpRequest(body.text)) {
      const reply = conversation.help(body);
      saveReplyRequest(reply.replyId, authSession, body, false);
      return { ...reply, sensitive: false };
    }
    const accountId = protectedAccountFor(request, authSession.accountId);
    const snapshot = await store.get(accountId, !body.hover);
    await recheck(request);
    const reply = await conversation.turn(body, snapshot);
    await recheck(request);
    saveReplyRequest(reply.replyId, authSession, body, true);
    const access = { sensitive: true, verificationExpiresAt: verification.expiresAt?.(authSession) };
    // The formatter is deliberately downstream of deterministic tool/forecast results.
    // It may shape wording, but it never supplies financial facts.
    if (model && snapshot.mode === 'synthetic' && reply.state === 'idle') {
      const formatted = await model.complete({ system: 'Format the grounded Cappy answer without changing facts.', user: reply.text, tools: [] });
      return { ...reply, ...access, text: formatted.text || reply.text };
    }
    return { ...reply, ...access };
  });
  server.post('/cancel', async request => { const { sessionId } = sessionInput.parse(request.body); if (conversationSession(sessionId, request) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 }); conversation.cancel(sessionId); return { ok: true }; });
  server.post('/forget', async request => { const { sessionId } = sessionInput.parse(request.body); if (conversationSession(sessionId, request) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 }); verificationStore?.revoke(current(request).id); conversation.forget(sessionId); return { ok: true }; });
  server.post('/transcribe', async (request, reply) => {
    const body = z.object({ sessionId: identifier, audio: z.string().max(14 * 1024 * 1024),
      mime: z.enum(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']),
      durationMs: z.number().positive().max(30000) }).strict().parse(request.body);
    if (conversationSession(body.sessionId, request) !== current(request).accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    if (!deps.transcribe) return reply.code(503).send({ error: 'Transcription is unavailable. Type your question.' });
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(body.audio)) throw new TypeError('Invalid audio');
    const audio = Buffer.from(body.audio, 'base64');
    if (!audio.length || audio.length > 10 * 1024 * 1024) throw new TypeError('Invalid audio size');
    return { text: await deps.transcribe(audio, body.mime, body.durationMs) };
  });
  server.post('/speak', async (request, reply) => {
    const body = z.object({ sessionId: identifier, replyId: identifier }).strict().parse(request.body);
    const authSession = current(request); if (conversationSession(body.sessionId, request) !== authSession.accountId) throw Object.assign(new Error('Unknown account or session'), { statusCode: 403 });
    const saved = replyRequests.get(body.replyId);
    if (!saved || saved.owner !== authSession.id || saved.sensitive) protectedAccountFor(request, authSession.accountId);
    const answer = conversation.getReply(body.sessionId, body.replyId);
    if (!answer) return reply.code(404).send({ error: 'Reply expired' });
    if (!deps.synthesize) return reply.code(503).send({ error: 'Speech is unavailable' });
    const audio = await deps.synthesize(answer.text);
    await auth.validate(authSession.id);
    return { audio: Buffer.from(audio).toString('base64') };
  });
  return server;
}
