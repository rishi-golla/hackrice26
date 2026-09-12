import type { SpeechProviderConfig } from './providers/speech.js';

type Environment = Record<string, string | undefined>;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadSpeechConfig(environment: Environment = process.env): SpeechProviderConfig | undefined {
  const apiKey = environment.ELEVENLABS_API_KEY?.trim();
  const voiceId = environment.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) {
    return undefined;
  }
  return {
    apiKey,
    voiceId,
    sttModelId: environment.ELEVENLABS_STT_MODEL_ID?.trim() || 'scribe_v2',
    ttsModelId: environment.ELEVENLABS_TTS_MODEL_ID?.trim() || 'eleven_flash_v2_5',
    outputFormat: environment.ELEVENLABS_OUTPUT_FORMAT?.trim() || 'mp3_44100_128',
    timeoutMs: positiveInteger(environment.ELEVENLABS_TIMEOUT_MS, 15_000),
    maxAudioBytes: positiveInteger(environment.ELEVENLABS_MAX_AUDIO_BYTES, 10 * 1024 * 1024),
    zeroRetention: environment.ELEVENLABS_ZERO_RETENTION?.toLowerCase() === 'true',
  };
}
