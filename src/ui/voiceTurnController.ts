import type { TurnReply, TurnRequest } from '../service/conversation/types.js';
import type { AudioCapture, AudioRecording } from './audioCapture.js';

export type { AudioCapture } from './audioCapture.js';

export type VoiceTurnState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

export type VoiceTurnPlayback = {
  play(bytes: Uint8Array): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
};

export type VoiceTurnTransport = {
  transcribe(audio: Uint8Array, mime: string, signal?: AbortSignal): Promise<string>;
  turn(request: TurnRequest, signal?: AbortSignal): Promise<TurnReply>;
  synthesize(sessionId: string, replyId: string, signal?: AbortSignal): Promise<Uint8Array>;
};

export type VoiceTurnControllerOptions = {
  capture: AudioCapture;
  transport: VoiceTurnTransport;
  playback: VoiceTurnPlayback;
  sessionId: string;
  candidateId?: string | (() => string | undefined);
  onState?: (state: VoiceTurnState) => void;
  onTranscript?: (text: string) => void;
  onReply?: (reply: TurnReply) => void;
  onError?: (error: unknown) => void;
};

export class VoiceTurnController {
  private generation = 0;
  private turnSequence = 0;
  private active = false;
  private abortController?: AbortController;

  public constructor(private readonly options: VoiceTurnControllerOptions) {}

  public async start(): Promise<void> {
    this.invalidateActive(false);
    const generation = this.generation;
    this.active = true;
    this.emit('listening');
    try {
      await this.options.capture.start();
    } catch (error) {
      if (generation !== this.generation || !this.active) {
        return;
      }
      this.active = false;
      this.emit('error');
      this.options.onError?.(error);
    }
  }

  public async stop(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.active = false;
    const generation = this.generation;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.emit('thinking');

    try {
      const recording = await this.options.capture.stop();
      this.assertCurrent(generation, abortController.signal);
      this.assertRecording(recording);

      const transcript = await this.options.transport.transcribe(
        recording.audio,
        recording.mime,
        abortController.signal,
      );
      this.assertCurrent(generation, abortController.signal);
      if (!transcript.trim()) {
        throw new Error('No speech was detected.');
      }
      this.options.onTranscript?.(transcript);

      const reply = await this.options.transport.turn(
        {
          sessionId: this.options.sessionId,
          turnId: `turn:${++this.turnSequence}`,
          text: transcript,
          candidateId: this.resolveCandidateId(),
        },
        abortController.signal,
      );
      this.assertCurrent(generation, abortController.signal);
      this.options.onReply?.(reply);

      const audio = await this.options.transport.synthesize(
        this.options.sessionId,
        reply.replyId,
        abortController.signal,
      );
      this.assertCurrent(generation, abortController.signal);
      if (audio.byteLength === 0) {
        throw new Error('The voice response contained no audio.');
      }

      this.emit('speaking');
      await this.options.playback.play(audio);
      this.assertCurrent(generation, abortController.signal);
      this.emit('idle');
    } catch (error) {
      if (generation !== this.generation || abortController.signal.aborted) {
        return;
      }
      this.emit('error');
      this.options.onError?.(error);
    } finally {
      if (this.abortController === abortController) {
        this.abortController = undefined;
      }
    }
  }

  public cancel(): void {
    this.invalidateActive(true);
  }

  public setMuted(muted: boolean): void {
    this.options.playback.setMuted(muted);
  }

  private invalidateActive(emitIdle: boolean): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = undefined;
    this.active = false;
    this.options.capture.cancel();
    this.options.playback.stop();
    if (emitIdle) {
      this.emit('idle');
    }
  }

  private resolveCandidateId(): string | undefined {
    return typeof this.options.candidateId === 'function'
      ? this.options.candidateId()
      : this.options.candidateId;
  }

  private assertRecording(recording: AudioRecording): void {
    if (
      recording.audio.byteLength === 0 ||
      recording.durationMs <= 0 ||
      recording.durationMs > 30_000
    ) {
      throw new Error('Voice recording must contain between 0 and 30 seconds of audio.');
    }
  }

  private assertCurrent(generation: number, signal: AbortSignal): void {
    if (generation !== this.generation || signal.aborted) {
      throw new Error('Voice turn was cancelled.');
    }
  }

  private emit(state: VoiceTurnState): void {
    this.options.onState?.(state);
  }
}

type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

type FetchVoiceTurnTransportOptions = {
  baseUrl: string;
  sessionToken: string;
  fetchImpl?: FetchImplementation;
};

export class VoiceTransportError extends Error {
  public readonly name = 'VoiceTransportError';

  public constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export function createFetchVoiceTurnTransport({
  baseUrl,
  sessionToken,
  fetchImpl = (input, init) => fetch(input, init),
}: FetchVoiceTurnTransportOptions): VoiceTurnTransport {
  const root = baseUrl.replace(/\/+$/, '');
  const headers = {
    'content-type': 'application/json',
    'x-session-token': sessionToken,
  };

  return {
    async transcribe(audio, mime, signal) {
      const response = await fetchImpl(`${root}/speech/transcribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ audioBase64: encodeBase64(audio), mime }),
        signal,
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new VoiceTransportError('Speech transcription failed.', response.status);
      }
      if (typeof body.text !== 'string') {
        throw new VoiceTransportError('Speech transcription returned an invalid response.', response.status);
      }
      return body.text;
    },

    async turn(request, signal) {
      const response = await fetchImpl(`${root}/conversation/turn`, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal,
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw new VoiceTransportError('Conversation turn failed.', response.status);
      }
      if (!isTurnReply(body)) {
        throw new VoiceTransportError('Conversation returned an invalid response.', response.status);
      }
      return body;
    },

    async synthesize(sessionId, replyId, signal) {
      const response = await fetchImpl(`${root}/speech/synthesize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId, replyId }),
        signal,
      });
      if (!response.ok) {
        throw new VoiceTransportError('Speech synthesis failed.', response.status);
      }
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0) {
        throw new VoiceTransportError('Speech synthesis returned no audio.', response.status);
      }
      return audio;
    },
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new VoiceTransportError('Voice service returned an invalid response.', response.status);
  }
}

function isTurnReply(value: Record<string, unknown>): value is Record<string, unknown> & TurnReply {
  return (
    typeof value.turnId === 'string' &&
    typeof value.replyId === 'string' &&
    typeof value.state === 'string' &&
    typeof value.text === 'string' &&
    Array.isArray(value.scenario)
  );
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
