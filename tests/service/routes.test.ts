import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../../src/fixtures/demo.js';
import { ConversationController } from '../../src/service/conversation/controller.js';
import { createConversationServer } from '../../src/service/conversation/routes.js';
import type { SpeechProvider } from '../../src/service/providers/speech.js';

async function createServer() {
  const controller = new ConversationController({
    routerProvider: async () => ({ kind: 'unsupported' }),
    snapshotProvider: async () => demoSnapshot(),
    reserveCents: 10_000,
    now: () => 1_000,
  });
  controller.createSession('session-1', 'demo-checking', 'synthetic');
  const app = await createConversationServer({ controller, sessionToken: 'secret' });
  return { app, controller };
}

describe('conversation routes', () => {
  it('requires the per-launch session token', async () => {
    const { app } = await createServer();
    const response = await app.inject({
      method: 'POST',
      url: '/conversation/turn',
      payload: { sessionId: 'session-1', turnId: 'turn-1', text: 'Why?' },
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('rejects malformed requests and forwards valid turns to the controller', async () => {
    const { app } = await createServer();
    const headers = { 'x-session-token': 'secret' };
    const invalid = await app.inject({
      method: 'POST',
      url: '/conversation/turn',
      headers,
      payload: { sessionId: 'session-1', text: 42 },
    });
    expect(invalid.statusCode).toBe(400);

    const valid = await app.inject({
      method: 'POST',
      url: '/conversation/turn',
      headers,
      payload: { sessionId: 'session-1', turnId: 'turn-1', text: 'Why?' },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toMatchObject({ state: 'clarifying' });
    await app.close();
  });

  it('clears a session through the authenticated route', async () => {
    const { app, controller } = await createServer();
    await app.inject({
      method: 'POST',
      url: '/conversation/turn',
      headers: { 'x-session-token': 'secret' },
      payload: { sessionId: 'session-1', turnId: 'turn-1', text: 'Why?' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/conversation/clear',
      headers: { 'x-session-token': 'secret' },
      payload: { sessionId: 'session-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(controller.getSession('session-1')?.turns).toEqual([]);
    await app.close();
  });

  it('keeps speech endpoints authenticated and server-owned', async () => {
    const speech: SpeechProvider = {
      transcribe: async (audio, mime) => `${mime}:${audio.byteLength}`,
      synthesize: async () => new Uint8Array([1, 2]),
    };
    const controller = new ConversationController({
      routerProvider: async () => ({ kind: 'unsupported' }),
      snapshotProvider: async () => demoSnapshot(),
      speechProvider: speech,
      reserveCents: 10_000,
      now: () => 1_000,
    });
    controller.createSession('session-1', 'demo-checking', 'synthetic');
    const app = await createConversationServer({
      controller,
      sessionToken: 'secret',
      speechProvider: speech,
    });
    const headers = { 'x-session-token': 'secret' };
    const transcribed = await app.inject({
      method: 'POST',
      url: '/speech/transcribe',
      headers,
      payload: { audioBase64: Buffer.from([9, 8]).toString('base64'), mime: 'audio/wav' },
    });
    expect(transcribed.statusCode).toBe(200);
    expect(transcribed.json()).toEqual({ text: 'audio/wav:2' });

    const turn = await app.inject({
      method: 'POST',
      url: '/conversation/turn',
      headers,
      payload: { sessionId: 'session-1', turnId: 'turn-1', text: 'Why?' },
    });
    const synthesized = await app.inject({
      method: 'POST',
      url: '/speech/synthesize',
      headers,
      payload: { sessionId: 'session-1', replyId: turn.json().replyId },
    });
    expect(synthesized.statusCode).toBe(200);
    expect(synthesized.headers['content-type']).toContain('audio/mpeg');
    expect(synthesized.rawPayload).toEqual(Buffer.from([1, 2]));
    await app.close();
  });
});
