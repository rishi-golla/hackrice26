export class ProviderUnavailableError extends Error { constructor(message: string) { super(message); this.name = 'ProviderUnavailableError'; } }
const allowed = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav']);
const elevenLabsAllowed = new Set([...allowed, 'audio/x-wav', 'audio/mpeg']);

type SpeechFetchOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  zeroRetention?: boolean;
  modelId?: string;
};

async function fetchWithDeadline(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  operation: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`ElevenLabs ${operation} timed out`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validateSpeechAudio(audio: Uint8Array, mime: string, durationMs: number, allowedMimes: Set<string>) {
  if (audio.byteLength > 10 * 1024 * 1024) throw new Error('Audio exceeds 10 MB');
  if (durationMs > 30_000) throw new Error('Audio exceeds 30 seconds');
  if (!allowedMimes.has(mime)) throw new Error('Unsupported audio MIME type');
}

export function createElevenLabsTranscriber(options: SpeechFetchOptions) {
  return {
    async transcribe(audio: Uint8Array, mime: string, durationMs: number) {
      if (!options.apiKey) throw new ProviderUnavailableError('ElevenLabs unavailable: API key missing');
      validateSpeechAudio(audio, mime, durationMs, elevenLabsAllowed);

      const audioBuffer = new ArrayBuffer(audio.byteLength);
      new Uint8Array(audioBuffer).set(audio);
      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: mime }), 'voice-input');
      form.append('model_id', options.modelId ?? 'scribe_v2');
      const url = new URL('https://api.elevenlabs.io/v1/speech-to-text');
      if (options.zeroRetention) url.searchParams.set('enable_logging', 'false');
      const response = await fetchWithDeadline(
        options.fetchImpl ?? fetch,
        url.toString(),
        { method: 'POST', headers: { 'xi-api-key': options.apiKey }, body: form },
        options.timeoutMs ?? 15_000,
        'transcription',
      );
      if (!response.ok) throw new Error(`ElevenLabs transcription failed with HTTP ${response.status}`);
      const body = await response.json() as { text?: unknown };
      if (typeof body.text !== 'string') throw new Error('ElevenLabs transcription returned no text');
      return body.text.trim();
    },
  };
}

export function createAssemblyAITranscriber(options: { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number; pollIntervalMs?: number }) { return { async transcribe(audio: Uint8Array, mime: string, durationMs: number) { if (!options.apiKey) throw new ProviderUnavailableError('AssemblyAI unavailable: API key missing'); if (audio.byteLength > 10 * 1024 * 1024) throw new Error('Audio exceeds 10 MB'); if (durationMs > 30_000) throw new Error('Audio exceeds 30 seconds'); if (!allowed.has(mime)) throw new Error('Unsupported audio MIME type'); const fetcher = options.fetchImpl ?? fetch; const headers = { authorization: options.apiKey, 'content-type': mime }; const upload = await fetcher('https://api.assemblyai.com/v2/upload', { method: 'POST', headers, body: audio as unknown as BodyInit }); if (!upload.ok) throw new Error('Audio upload failed'); const uploadUrl = (await upload.json() as { upload_url: string }).upload_url; const created = await fetcher('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { authorization: options.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: uploadUrl }) }); const job = await created.json() as { id: string }; for (;;) { const result = await fetcher(`https://api.assemblyai.com/v2/transcript/${job.id}`, { headers: { authorization: options.apiKey } }); const value = await result.json() as { status: string; text?: string; error?: string }; if (value.status === 'completed') return value.text ?? ''; if (value.status === 'error') throw new Error(value.error ?? 'Transcription failed'); await new Promise(resolve => setTimeout(resolve, options.pollIntervalMs ?? 500)); } } }; }
export function createElevenLabsSynthesizer(options: SpeechFetchOptions & { voiceId?: string }) { return { async synthesizeValidatedReply(text: string) { if (!options.apiKey || !options.voiceId) throw new ProviderUnavailableError('ElevenLabs unavailable: credentials missing'); if (!text.trim() || text.length > 4000) throw new Error('Invalid reply text'); const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/stream?output_format=mp3_44100_128`); if (options.zeroRetention) url.searchParams.set('enable_logging', 'false'); const response = await fetchWithDeadline(options.fetchImpl ?? fetch, url.toString(), { method: 'POST', headers: { 'xi-api-key': options.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ text, ...(options.modelId ? { model_id: options.modelId } : {}) }) }, options.timeoutMs ?? 15_000, 'synthesis'); if (!response.ok) throw new Error(`ElevenLabs synthesis failed with HTTP ${response.status}`); const audio = new Uint8Array(await response.arrayBuffer()); if (audio.byteLength === 0) throw new Error('ElevenLabs synthesis returned no audio'); return audio; } }; }
