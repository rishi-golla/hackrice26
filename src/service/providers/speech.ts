const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-wav',
]);

export type SpeechErrorCode =
  | 'invalid-audio'
  | 'unknown-reply'
  | 'authentication'
  | 'rate-limit'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'provider-response'
  | 'network';

export class SpeechProviderError extends Error {
  public readonly name = 'SpeechProviderError';

  public constructor(
    public readonly code: SpeechErrorCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export type SpeechProviderConfig = {
  apiKey: string;
  voiceId: string;
  sttModelId: string;
  ttsModelId: string;
  outputFormat: string;
  timeoutMs: number;
  maxAudioBytes: number;
  zeroRetention: boolean;
};

export type GeneratedReply = {
  text: string;
};

type FetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

type SpeechProviderOptions = {
  config: SpeechProviderConfig;
  replies?: ReadonlyMap<string, GeneratedReply>;
  fetchImpl?: FetchImplementation;
};

export type SpeechProvider = {
  transcribe(audio: Uint8Array, mime: string, signal?: AbortSignal): Promise<string>;
  synthesize(replyId: string, signal?: AbortSignal): Promise<Uint8Array>;
};

function createRequestUrl(path: string, query: Record<string, string | undefined>): string {
  const url = new URL(`${ELEVENLABS_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function providerErrorFromStatus(status: number, operation: string): SpeechProviderError {
  if (status === 401 || status === 403) {
    return new SpeechProviderError(
      'authentication',
      `ElevenLabs ${operation} authentication was rejected.`,
      status,
    );
  }
  if (status === 429) {
    return new SpeechProviderError(
      'rate-limit',
      `ElevenLabs ${operation} was rate limited.`,
      status,
    );
  }
  if (status >= 500) {
    return new SpeechProviderError(
      'unavailable',
      `ElevenLabs ${operation} is unavailable.`,
      status,
    );
  }
  return new SpeechProviderError(
    'provider-response',
    `ElevenLabs ${operation} failed with HTTP ${status}.`,
    status,
  );
}

async function requestWithDeadline(
  fetchImpl: FetchImplementation,
  input: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  operation: string,
): Promise<Response> {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) {
      throw new SpeechProviderError('cancelled', `ElevenLabs ${operation} was cancelled.`);
    }
    if (controller.signal.aborted) {
      throw new SpeechProviderError('timeout', `ElevenLabs ${operation} timed out.`);
    }
    throw new SpeechProviderError('network', `ElevenLabs ${operation} could not be reached.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function readJson(response: Response, operation: string): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new SpeechProviderError(
      'provider-response',
      `ElevenLabs returned an invalid ${operation} response.`,
      response.status,
    );
  }
}

export function createElevenLabsSpeechProvider({
  config,
  replies = new Map(),
  fetchImpl = (input, init) => fetch(input, init),
}: SpeechProviderOptions): SpeechProvider {
  const authHeaders = { 'xi-api-key': config.apiKey };

  return {
    async transcribe(audio, mime, signal) {
      if (
        audio.byteLength === 0 ||
        audio.byteLength > config.maxAudioBytes ||
        !ALLOWED_AUDIO_MIME_TYPES.has(mime)
      ) {
        throw new SpeechProviderError(
          'invalid-audio',
          'Audio must use an allowed MIME type and stay within the configured size limit.',
        );
      }

      const audioBuffer = new ArrayBuffer(audio.byteLength);
      new Uint8Array(audioBuffer).set(audio);
      const form = new FormData();
      form.append('file', new Blob([audioBuffer], { type: mime }), 'conversation-audio');
      form.append('model_id', config.sttModelId);
      const url = createRequestUrl('/speech-to-text', {
        enable_logging: config.zeroRetention ? 'false' : undefined,
      });
      const response = await requestWithDeadline(
        fetchImpl,
        url,
        { method: 'POST', headers: authHeaders, body: form },
        config.timeoutMs,
        signal,
        'transcription',
      );
      if (!response.ok) {
        throw providerErrorFromStatus(response.status, 'transcription');
      }
      const body = await readJson(response, 'transcription');
      if (typeof body.text !== 'string') {
        throw new SpeechProviderError(
          'provider-response',
          'ElevenLabs transcription did not include text.',
          response.status,
        );
      }
      return body.text;
    },

    async synthesize(replyId, signal) {
      const reply = replies.get(replyId);
      if (!reply) {
        throw new SpeechProviderError(
          'unknown-reply',
          'The requested reply is not owned by the conversation service.',
        );
      }

      const url = createRequestUrl(`/text-to-speech/${encodeURIComponent(config.voiceId)}/stream`, {
        output_format: config.outputFormat,
        enable_logging: config.zeroRetention ? 'false' : undefined,
      });
      const response = await requestWithDeadline(
        fetchImpl,
        url,
        {
          method: 'POST',
          headers: { ...authHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ text: reply.text, model_id: config.ttsModelId }),
        },
        config.timeoutMs,
        signal,
        'synthesis',
      );
      if (!response.ok) {
        throw providerErrorFromStatus(response.status, 'synthesis');
      }
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0) {
        throw new SpeechProviderError(
          'provider-response',
          'ElevenLabs synthesis returned no audio.',
          response.status,
        );
      }
      return audio;
    },
  };
}
