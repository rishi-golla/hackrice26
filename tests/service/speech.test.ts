import { describe, expect, it } from 'vitest';
import {
  createElevenLabsSpeechProvider,
  SpeechProviderError,
} from '../../src/service/providers/speech.js';

const config = {
  apiKey: 'test-key',
  voiceId: 'voice-1',
  sttModelId: 'scribe_v2',
  ttsModelId: 'eleven_flash_v2_5',
  outputFormat: 'mp3_44100_128',
  timeoutMs: 100,
  maxAudioBytes: 10,
  zeroRetention: true,
};

describe('ElevenLabs speech provider', () => {
  it('transcribes released audio through Scribe v2 without exposing audio to the renderer', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const provider = createElevenLabsSpeechProvider({
      config,
      fetchImpl: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return Response.json({ text: 'Can I afford these?' });
      },
    });

    await expect(provider.transcribe(new Uint8Array([1, 2, 3]), 'audio/wav')).resolves.toBe(
      'Can I afford these?',
    );

    expect(request?.url).toBe(
      'https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false',
    );
    expect(request?.init.headers).toMatchObject({
      'xi-api-key': 'test-key',
    });
    expect(request?.init.body).toBeInstanceOf(FormData);
    const form = request?.init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v2');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('synthesizes only a server-owned reply ID through ElevenLabs TTS', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const provider = createElevenLabsSpeechProvider({
      config,
      replies: new Map([['reply-1', { text: 'Your projected minimum is negative.' }]]),
      fetchImpl: async (url, init) => {
        request = { url: String(url), init: init ?? {} };
        return new Response(new Uint8Array([4, 5, 6]), { status: 200 });
      },
    });

    await expect(provider.synthesize('reply-1')).resolves.toEqual(new Uint8Array([4, 5, 6]));
    await expect(provider.synthesize('renderer-text')).rejects.toMatchObject({
      code: 'unknown-reply',
    });

    expect(request?.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/voice-1/stream?output_format=mp3_44100_128&enable_logging=false',
    );
    expect(request?.init.headers).toMatchObject({
      'xi-api-key': 'test-key',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      text: 'Your projected minimum is negative.',
      model_id: 'eleven_flash_v2_5',
    });
  });

  it('rejects unsupported audio and oversized audio before making a provider request', async () => {
    let calls = 0;
    const provider = createElevenLabsSpeechProvider({
      config,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({ text: 'unexpected' });
      },
    });

    await expect(provider.transcribe(new Uint8Array([1]), 'text/plain')).rejects.toMatchObject({
      code: 'invalid-audio',
    });
    await expect(provider.transcribe(new Uint8Array(11), 'audio/wav')).rejects.toMatchObject({
      code: 'invalid-audio',
    });
    expect(calls).toBe(0);
  });

  it('maps provider authentication failures to a recoverable speech error', async () => {
    const provider = createElevenLabsSpeechProvider({
      config,
      replies: new Map([['reply-1', { text: 'A grounded answer.' }]]),
      fetchImpl: async () => new Response('unauthorized', { status: 401 }),
    });

    await expect(provider.synthesize('reply-1')).rejects.toBeInstanceOf(SpeechProviderError);
    await expect(provider.synthesize('reply-1')).rejects.toMatchObject({
      code: 'authentication',
    });
  });

  it('maps rate limits and malformed provider payloads without leaking the response body', async () => {
    const rateLimited = createElevenLabsSpeechProvider({
      config,
      replies: new Map([['reply-1', { text: 'Answer' }]]),
      fetchImpl: async () => new Response('secret provider details', { status: 429 }),
    });
    await expect(rateLimited.synthesize('reply-1')).rejects.toMatchObject({ code: 'rate-limit' });

    const malformed = createElevenLabsSpeechProvider({
      config,
      fetchImpl: async () => Response.json({ language_code: 'en' }),
    });
    await expect(malformed.transcribe(new Uint8Array([1]), 'audio/wav')).rejects.toMatchObject({
      code: 'provider-response',
    });
  });

  it('rejects an empty successful TTS response as a provider error', async () => {
    const provider = createElevenLabsSpeechProvider({
      config,
      replies: new Map([['reply-1', { text: 'Answer' }]]),
      fetchImpl: async () => new Response(new Uint8Array(), { status: 200 }),
    });

    await expect(provider.synthesize('reply-1')).rejects.toMatchObject({
      code: 'provider-response',
    });
  });

  it('enforces a deadline and caller cancellation', async () => {
    const fetchImpl = async (_url: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    const provider = createElevenLabsSpeechProvider({ config: { ...config, timeoutMs: 1 }, fetchImpl });

    await expect(provider.transcribe(new Uint8Array([1]), 'audio/wav')).rejects.toMatchObject({
      code: 'timeout',
    });

    const controller = new AbortController();
    const cancelled = provider.transcribe(new Uint8Array([1]), 'audio/wav', controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
  });
});
