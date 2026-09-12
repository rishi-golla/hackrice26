import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserAudioCapture,
  type AudioCaptureRuntime,
  type MediaRecorderLike,
  type MediaStreamLike,
} from '../../src/ui/audioCapture.js';

function fakeRuntime() {
  const stream: MediaStreamLike = {
    getTracks: () => [{ stop: vi.fn() }],
  };
  let recorder: MediaRecorderLike | undefined;
  let now = 10_000;
  const runtime: AudioCaptureRuntime = {
    getUserMedia: vi.fn().mockResolvedValue(stream),
    createRecorder: vi.fn((_nextStream, options) => {
      recorder = {
        state: 'inactive',
        mimeType: options?.mimeType ?? 'audio/webm',
        ondataavailable: null,
        onstop: null,
        onerror: null,
        start: vi.fn(() => {
          recorder!.state = 'recording';
        }),
        stop: vi.fn(() => {
          recorder!.state = 'inactive';
        }),
      };
      return recorder;
    }),
    now: () => now,
  };
  return {
    runtime,
    stream,
    get recorder() {
      return recorder;
    },
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('browser audio capture', () => {
  it('records the released microphone audio and reports its duration and MIME type', async () => {
    const source = fakeRuntime();
    const capture = createBrowserAudioCapture({ maxDurationMs: 30_000 }, source.runtime);

    await capture.start();
    source.advance(1_250);
    source.recorder?.ondataavailable?.({
      data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }),
    });

    const recordingPromise = capture.stop();
    source.recorder?.onstop?.();
    await expect(recordingPromise).resolves.toMatchObject({
      mime: 'audio/webm',
      durationMs: 1_250,
    });
    await expect(recordingPromise).resolves.toMatchObject({
      audio: new Uint8Array([1, 2, 3]),
    });
  });

  it('cancels the recorder and discards buffered audio', async () => {
    const source = fakeRuntime();
    const capture = createBrowserAudioCapture({ maxDurationMs: 30_000 }, source.runtime);

    await capture.start();
    source.recorder?.ondataavailable?.({ data: new Blob([new Uint8Array([9])]) });
    capture.cancel();

    expect(source.recorder?.stop).toHaveBeenCalledOnce();
    await expect(capture.stop()).rejects.toMatchObject({ code: 'not-recording' });
  });
});
