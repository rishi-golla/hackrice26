import { describe, expect, it, vi } from 'vitest';
import { demoSnapshot } from '../../src/fixtures/demo.js';
import {
  ConversationController,
  VoiceTurnError,
} from '../../src/service/conversation/controller.js';
import type { SpeechProvider } from '../../src/service/providers/speech.js';

describe('voice conversation controller', () => {
  it('transcribes user audio, handles the turn, and synthesizes the server-owned reply', async () => {
    const speech: SpeechProvider = {
      transcribe: vi.fn().mockResolvedValue('Can I afford these?'),
      synthesize: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    };
    const controller = new ConversationController({
      routerProvider: async () => ({ kind: 'unsupported' }),
      snapshotProvider: async () => demoSnapshot(),
      speechProvider: speech,
      reserveCents: 10_000,
      now: () => 1_000,
    });
    controller.createSession('session-1', 'demo-checking', 'synthetic');

    const result = await controller.handleVoiceTurn({
      sessionId: 'session-1',
      turnId: 'turn-1',
      audio: new Uint8Array([9]),
      mime: 'audio/wav',
      durationMs: 1_000,
    });

    expect(result.transcript).toBe('Can I afford these?');
    expect(result.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(speech.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/wav');
    expect(speech.synthesize).toHaveBeenCalledWith(result.reply.replyId);
  });

  it('rejects audio longer than thirty seconds before contacting the provider', async () => {
    const speech: SpeechProvider = {
      transcribe: vi.fn(),
      synthesize: vi.fn(),
    };
    const controller = new ConversationController({
      routerProvider: async () => ({ kind: 'unsupported' }),
      snapshotProvider: async () => demoSnapshot(),
      speechProvider: speech,
      reserveCents: 10_000,
      now: () => 1_000,
    });
    controller.createSession('session-1', 'demo-checking', 'synthetic');

    await expect(
      controller.handleVoiceTurn({
        sessionId: 'session-1',
        turnId: 'turn-1',
        audio: new Uint8Array([9]),
        mime: 'audio/wav',
        durationMs: 30_001,
      }),
    ).rejects.toBeInstanceOf(VoiceTurnError);
    expect(speech.transcribe).not.toHaveBeenCalled();
  });
});
