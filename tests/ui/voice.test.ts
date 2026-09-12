import { describe, expect, it, vi } from 'vitest';
import { VoiceTurnController, type VoiceRuntime, type RecorderLike } from '../../src/ui/voice';

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.onstop?.();
  }

  emitAudio(bytes: number[]) {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }) });
  }
}

describe('voice turn controller', () => {
  it('transcribes released audio, routes the turn, and plays the server reply', async () => {
    const recorder = new FakeRecorder();
    const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), onended: undefined as (() => void) | undefined, src: '' };
    const bridge = {
      transcribe: vi.fn().mockResolvedValue('Can I afford this?'),
      turn: vi.fn().mockResolvedValue({ replyId: 'reply-1', state: 'idle', text: 'Yes.', turnId: 'turn-1', scenario: [] }),
      speak: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      state: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = fakeRuntime(recorder, audio);
    const controller = new VoiceTurnController(bridge, runtime);

    await controller.start('candidate-1');
    recorder.emitAudio([1, 2, 3]);
    controller.stop();
    await vi.waitFor(() => expect(bridge.speak).toHaveBeenCalledWith('reply-1'));

    expect(bridge.transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), 'audio/webm;codecs=opus', expect.any(Number));
    expect(bridge.turn).toHaveBeenCalledWith('Can I afford this?', 'candidate-1');
    expect(audio.play).toHaveBeenCalledOnce();
  });

  it('cancels an active recording and playback when a new turn barges in', async () => {
    const recorder = new FakeRecorder();
    const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), onended: undefined as (() => void) | undefined, src: '' };
    const bridge = {
      transcribe: vi.fn().mockResolvedValue('Why?'),
      turn: vi.fn().mockResolvedValue({ replyId: 'reply-2', state: 'idle', text: 'Because.', turnId: 'turn-2', scenario: [] }),
      speak: vi.fn().mockResolvedValue(new Uint8Array([1])),
      state: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new VoiceTurnController(bridge, fakeRuntime(recorder, audio));

    await controller.start();
    recorder.emitAudio([4]);
    controller.stop();
    await vi.waitFor(() => expect(audio.play).toHaveBeenCalledOnce());
    await controller.start();

    expect(audio.pause).toHaveBeenCalledOnce();
    expect(bridge.cancel).toHaveBeenCalled();
  });

  it('does not let its own host cancellation cancel the new recording', async () => {
    const recorder = new FakeRecorder();
    const bridge = {
      transcribe: vi.fn(),
      turn: vi.fn(),
      speak: vi.fn(),
      state: vi.fn().mockResolvedValue(undefined),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new VoiceTurnController(bridge, fakeRuntime(recorder, { play: vi.fn(), pause: vi.fn(), src: '' }));

    await controller.start();
    controller.handleHostCancel();

    expect(controller.isRecording()).toBe(true);
    controller.stop();
  });
});

function fakeRuntime(recorder: FakeRecorder, audio: { play: () => Promise<void>; pause: () => void; onended?: (() => void) | undefined; src: string }): VoiceRuntime {
  return {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    createRecorder: vi.fn().mockReturnValue(recorder),
    createAudio: vi.fn().mockReturnValue(audio),
    createObjectUrl: vi.fn().mockReturnValue('blob:test'),
    revokeObjectUrl: vi.fn(),
    now: (() => {
      let value = 1_000;
      return () => (value += 250);
    })(),
  };
}
