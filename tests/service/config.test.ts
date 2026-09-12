import { describe, expect, it } from 'vitest';
import { loadSpeechConfig } from '../../src/service/config.js';

describe('speech configuration', () => {
  it('stays disabled until both the API key and voice ID are configured', () => {
    expect(loadSpeechConfig({})).toBeUndefined();
    expect(loadSpeechConfig({ ELEVENLABS_API_KEY: 'key' })).toBeUndefined();
    expect(loadSpeechConfig({ ELEVENLABS_VOICE_ID: 'voice' })).toBeUndefined();
  });

  it('loads bounded ElevenLabs settings without exposing secret values', () => {
    expect(
      loadSpeechConfig({
        ELEVENLABS_API_KEY: 'key',
        ELEVENLABS_VOICE_ID: 'voice',
        ELEVENLABS_STT_MODEL_ID: 'scribe_v2',
        ELEVENLABS_TTS_MODEL_ID: 'eleven_flash_v2_5',
        ELEVENLABS_OUTPUT_FORMAT: 'mp3_44100_128',
        ELEVENLABS_TIMEOUT_MS: '12000',
        ELEVENLABS_MAX_AUDIO_BYTES: '1000',
        ELEVENLABS_ZERO_RETENTION: 'true',
      }),
    ).toEqual({
      apiKey: 'key',
      voiceId: 'voice',
      sttModelId: 'scribe_v2',
      ttsModelId: 'eleven_flash_v2_5',
      outputFormat: 'mp3_44100_128',
      timeoutMs: 12_000,
      maxAudioBytes: 1_000,
      zeroRetention: true,
    });
  });
});
