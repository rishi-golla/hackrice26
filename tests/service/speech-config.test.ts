import { describe, expect, it } from 'vitest';
import { createSpeechDependencies } from '../../src/service/speech-config';

describe('service speech configuration', () => {
  it('keeps hosted speech disabled when credentials are absent', () => {
    const dependencies = createSpeechDependencies({});

    expect(dependencies.capabilities).toEqual({ transcription: false, speech: false });
    expect(dependencies.transcribe).toBeUndefined();
    expect(dependencies.synthesize).toBeUndefined();
  });

  it('enables transcription with a key and synthesis when a voice is configured', () => {
    const dependencies = createSpeechDependencies({
      ELEVENLABS_API_KEY: 'test-key',
      ELEVENLABS_VOICE_ID: 'pNInz6obpgDQGcFmaJgB',
    });

    expect(dependencies.capabilities).toEqual({ transcription: true, speech: true });
    expect(dependencies.transcribe).toEqual(expect.any(Function));
    expect(dependencies.synthesize).toEqual(expect.any(Function));
  });

  it('keeps synthesis disabled when the key has no voice ID', () => {
    const dependencies = createSpeechDependencies({ ELEVENLABS_API_KEY: 'test-key' });

    expect(dependencies.capabilities).toEqual({ transcription: true, speech: false });
    expect(dependencies.transcribe).toEqual(expect.any(Function));
    expect(dependencies.synthesize).toBeUndefined();
  });
});
