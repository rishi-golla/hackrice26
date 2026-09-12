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
  it('never plays speech that arrives after local access is cleared', async () => {
    let finish!: (value: Uint8Array) => void;
    const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), src: '' };
    const bridge = { transcribe: vi.fn(), turn: vi.fn(),
      speak: vi.fn(() => new Promise<Uint8Array>(resolve => { finish = resolve; })),
      state: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) };
    const controller = new VoiceTurnController(bridge, fakeRuntime(new FakeRecorder(), audio));
    const work = controller.readAloud('protected');
    await vi.waitFor(() => expect(bridge.speak).toHaveBeenCalledOnce());
    controller.cancelLocal(); finish(new Uint8Array([1])); await work;
    expect(audio.play).not.toHaveBeenCalled();
  });
  it('keeps protected answers silent until Read aloud is explicitly requested', async () => {
    const recorder = new FakeRecorder();
    const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), src: '' };
    const bridge = { transcribe: vi.fn().mockResolvedValue('Can I afford $10?'),
      turn: vi.fn().mockResolvedValue({ replyId: 'protected', sensitive: true, state: 'idle' }),
      speak: vi.fn().mockResolvedValue(new Uint8Array([1])), state: vi.fn().mockResolvedValue(undefined), cancel: vi.fn().mockResolvedValue(undefined) };
    const controller = new VoiceTurnController(bridge, fakeRuntime(recorder, audio));
    await controller.start(); recorder.emitAudio([1]); controller.stop();
    await vi.waitFor(() => expect(bridge.turn).toHaveBeenCalledOnce());
    expect(bridge.speak).not.toHaveBeenCalled(); expect(audio.play).not.toHaveBeenCalled();
    await controller.readAloud('protected');
    expect(bridge.speak).toHaveBeenCalledWith('protected'); expect(audio.play).toHaveBeenCalledOnce();
  });
  it('transcribes released audio, routes the turn, and plays the server reply', async () => {
    const recorder = new FakeRecorder();
    const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), onended: undefined as (() => void) | undefined, src: '' };
    const bridge = {
      transcribe: vi.fn().mockResolvedValue('Can I afford this?'),
      turn: vi.fn().mockResolvedValue({ replyId: 'reply-1', state: 'idle', text: 'Here is how I can help.', turnId: 'turn-1', scenario: [], sensitive: false }),
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
      turn: vi.fn().mockResolvedValue({ replyId: 'reply-2', state: 'idle', text: 'Here is how I can help.', turnId: 'turn-2', scenario: [], sensitive: false }),
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
