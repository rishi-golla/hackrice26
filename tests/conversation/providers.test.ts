import { describe, expect, it, vi } from 'vitest';
import { createAnthropicIntentRouter } from '../../src/service/providers/anthropic';
import { createAssemblyAITranscriber, createElevenLabsSynthesizer, createElevenLabsTranscriber, ProviderUnavailableError } from '../../src/service/providers/speech';

describe('hosted provider boundaries', () => {
  it('reports missing credentials as explicitly unavailable', async () => {
    await expect(createAnthropicIntentRouter({ model: 'configured-model' }).route({ text: 'Why?', references: [], candidates: [], lastScenario: [], today: '2026-09-12', timezone: 'America/Chicago' })).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(createAssemblyAITranscriber({}).transcribe(new Uint8Array([1]), 'audio/wav', 1_000)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(createElevenLabsTranscriber({}).transcribe(new Uint8Array([1]), 'audio/wav', 1_000)).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(createElevenLabsSynthesizer({}).synthesizeValidatedReply('Validated reply')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('rejects oversized, overlong, and unsupported audio before upload', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transcriber = createAssemblyAITranscriber({ apiKey: 'test', fetchImpl });
    await expect(transcriber.transcribe(new Uint8Array(10 * 1024 * 1024 + 1), 'audio/wav', 1_000)).rejects.toThrow(/10 MB/);
    await expect(transcriber.transcribe(new Uint8Array([1]), 'audio/wav', 30_001)).rejects.toThrow(/30 seconds/);
    await expect(transcriber.transcribe(new Uint8Array([1]), 'text/plain', 1_000)).rejects.toThrow(/MIME/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uploads raw audio, submits, and polls AssemblyAI in memory', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ upload_url: 'https://upload.example/audio' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'transcript-1', status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'transcript-1', status: 'completed', text: 'Can I afford this?' }));
    const transcriber = createAssemblyAITranscriber({ apiKey: 'test', fetchImpl, pollIntervalMs: 0 });

    await expect(transcriber.transcribe(new Uint8Array([1, 2]), 'audio/webm', 2_000)).resolves.toBe('Can I afford this?');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.assemblyai.com/v2/upload');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'POST', body: expect.any(Uint8Array) });
  });

  it('sends only validated reply text to ElevenLabs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const synthesizer = createElevenLabsSynthesizer({ apiKey: 'test', voiceId: 'voice', modelId: 'model', fetchImpl });

    await expect(synthesizer.synthesizeValidatedReply('The checked reply.')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchImpl).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/text-to-speech/voice?output_format=mp3_44100_128', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ text: 'The checked reply.', model_id: 'model' });
  });

  it('sends released audio to ElevenLabs Scribe v2 and returns the transcript', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ text: 'Can I afford this?' }));
    const transcriber = createElevenLabsTranscriber({ apiKey: 'test', fetchImpl });

    await expect(transcriber.transcribe(new Uint8Array([1, 2, 3]), 'audio/wav', 1_000)).resolves.toBe('Can I afford this?');

    expect(fetchImpl).toHaveBeenCalledWith('https://api.elevenlabs.io/v1/speech-to-text', expect.objectContaining({ method: 'POST' }));
    const body = fetchImpl.mock.calls[0][1]?.body as FormData;
    expect(body.get('model_id')).toBe('scribe_v2');
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('rejects invalid Scribe audio before making a request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const transcriber = createElevenLabsTranscriber({ apiKey: 'test', fetchImpl });

    await expect(transcriber.transcribe(new Uint8Array(10 * 1024 * 1024 + 1), 'audio/wav', 1_000)).rejects.toThrow(/10 MB/);
    await expect(transcriber.transcribe(new Uint8Array([1]), 'audio/wav', 30_001)).rejects.toThrow(/30 seconds/);
    await expect(transcriber.transcribe(new Uint8Array([1]), 'text/plain', 1_000)).rejects.toThrow(/MIME/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
