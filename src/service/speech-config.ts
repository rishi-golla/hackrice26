import { createElevenLabsSynthesizer, createElevenLabsTranscriber } from './providers/speech';

type Environment = Record<string, string | undefined>;

export type SpeechDependencies = {
  capabilities: { transcription: boolean; speech: boolean };
  transcribe?: (audio: Uint8Array, mime: string, durationMs: number) => Promise<string>;
  synthesize?: (text: string) => Promise<Uint8Array>;
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function createSpeechDependencies(environment: Environment = process.env): SpeechDependencies {
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  const voiceId = environment.ELEVENLABS_VOICE_ID?.trim();
  const common = {
    apiKey,
    timeoutMs: positiveInteger(environment.ELEVENLABS_TIMEOUT_MS, 15_000),
    zeroRetention: environment.ELEVENLABS_ZERO_RETENTION?.toLowerCase() === 'true',
  };
  const transcriber = apiKey
    ? createElevenLabsTranscriber({
        ...common,
        modelId: environment.ELEVENLABS_STT_MODEL_ID?.trim() || 'scribe_v2',
      })
    : undefined;
  const synthesizer = apiKey && voiceId
    ? createElevenLabsSynthesizer({
        ...common,
        voiceId,
        modelId: environment.ELEVENLABS_TTS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
      })
    : undefined;

  return {
    capabilities: { transcription: Boolean(transcriber), speech: Boolean(synthesizer) },
    transcribe: transcriber?.transcribe,
    synthesize: synthesizer?.synthesizeValidatedReply,
  };
}
