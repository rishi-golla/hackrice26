import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConversationController, TurnCancelledError } from './controller.js';
import type { SpeechProvider } from '../providers/speech.js';

const turnRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
    text: z.string().min(1).max(4_000),
    candidateId: z.string().min(1).optional(),
  })
  .strict();

const clearRequestSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict();

const transcribeRequestSchema = z
  .object({
    audioBase64: z.string().min(1).max(14_000_000),
    mime: z.string().min(1),
  })
  .strict();

const synthesizeRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    replyId: z.string().min(1),
  })
  .strict();

export type ConversationServerOptions = {
  controller: ConversationController;
  sessionToken: string;
  speechProvider?: SpeechProvider;
};

export async function createConversationServer({
  controller,
  sessionToken,
  speechProvider,
}: ConversationServerOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addHook('onRequest', async (request, reply) => {
    if (request.headers['x-session-token'] !== sessionToken) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.post('/conversation/turn', async (request, reply) => {
    const parsed = turnRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      return reply.send(await controller.handleTurn(parsed.data));
    } catch (error) {
      if (error instanceof TurnCancelledError) {
        return reply.code(409).send({ error: 'cancelled' });
      }
      if (error instanceof Error && error.message.startsWith('Unknown conversation session')) {
        return reply.code(404).send({ error: 'unknown_session' });
      }
      return reply.code(500).send({ error: 'conversation_failed' });
    }
  });

  app.post('/conversation/clear', async (request, reply) => {
    const parsed = clearRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      controller.clearSession(parsed.data.sessionId);
      return reply.send({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Unknown conversation session')) {
        return reply.code(404).send({ error: 'unknown_session' });
      }
      return reply.code(500).send({ error: 'conversation_failed' });
    }
  });

  app.post('/speech/transcribe', async (request, reply) => {
    if (!speechProvider) {
      return reply.code(503).send({ error: 'speech_unavailable' });
    }
    const parsed = transcribeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      const audio = Buffer.from(parsed.data.audioBase64, 'base64');
      if (audio.length === 0) {
        return reply.code(400).send({ error: 'invalid_audio' });
      }
      const text = await speechProvider.transcribe(new Uint8Array(audio), parsed.data.mime);
      return reply.send({ text });
    } catch {
      return reply.code(502).send({ error: 'speech_failed' });
    }
  });

  app.post('/speech/synthesize', async (request, reply) => {
    if (!speechProvider) {
      return reply.code(503).send({ error: 'speech_unavailable' });
    }
    const parsed = synthesizeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    if (!controller.getGeneratedReply(parsed.data.replyId, parsed.data.sessionId)) {
      return reply.code(404).send({ error: 'unknown_reply' });
    }
    try {
      const audio = await speechProvider.synthesize(parsed.data.replyId);
      return reply.type('audio/mpeg').send(Buffer.from(audio));
    } catch {
      return reply.code(502).send({ error: 'speech_failed' });
    }
  });

  return app;
}
