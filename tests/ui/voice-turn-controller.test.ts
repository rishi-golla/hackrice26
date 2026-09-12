import { describe, expect, it, vi } from 'vitest';
import {
  VoiceTurnController,
  createFetchVoiceTurnTransport,
  type AudioCapture,
  type VoiceTurnTransport,
} from '../../src/ui/voiceTurnController.js';
import type { TurnReply } from '../../src/service/conversation/types.js';

function fakeCapture(): AudioCapture {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue({
      audio: new Uint8Array([1, 2]),
      mime: 'audio/webm',
      durationMs: 1_000,
    }),
    cancel: vi.fn(),
  };
}

function fakeReply(): TurnReply {
  return {
    turnId: 'turn-1',
    replyId: 'reply-1',
    state: 'idle',
    text: 'Your projected minimum is safe.',
    scenario: [],
  };
}

function fakeTransport(): VoiceTurnTransport {
  return {
    transcribe: vi.fn().mockResolvedValue('Can I afford this?'),
    turn: vi.fn().mockResolvedValue(fakeReply()),
    synthesize: vi.fn().mockResolvedValue(new Uint8Array([7, 8])),
  };
}

function fakePlayback() {
  return {
    play: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    setMuted: vi.fn(),
  };
}

describe('voice turn controller', () => {
  it('runs released audio through transcription, grounded turn, synthesis, and playback', async () => {
    const capture = fakeCapture();
    const transport = fakeTransport();
    const playback = fakePlayback();
    const states: string[] = [];
    const controller = new VoiceTurnController({
      capture,
      transport,
      playback,
      sessionId: 'session-1',
      onState: (state) => states.push(state),
    });

    await controller.start();
    await controller.stop();

    expect(capture.start).toHaveBeenCalledOnce();
    expect(capture.stop).toHaveBeenCalledOnce();
    expect(transport.transcribe).toHaveBeenCalledWith(
      new Uint8Array([1, 2]),
      'audio/webm',
      expect.any(AbortSignal),
    );
    expect(transport.turn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1', text: 'Can I afford this?' }),
      expect.any(AbortSignal),
    );
    expect(transport.synthesize).toHaveBeenCalledWith('session-1', 'reply-1', expect.any(AbortSignal));
    expect(playback.play).toHaveBeenCalledWith(new Uint8Array([7, 8]));
    expect(states).toEqual(['listening', 'thinking', 'speaking', 'idle']);
  });

  it('cancels stale work and barges in over existing playback', async () => {
    const capture = fakeCapture();
    const transcript = deferred<string>();
    const transport = fakeTransport();
    vi.mocked(transport.transcribe).mockReturnValue(transcript.promise);
    const playback = fakePlayback();
    const controller = new VoiceTurnController({
      capture,
      transport,
      playback,
      sessionId: 'session-1',
    });

    await controller.start();
    const stopping = controller.stop();
    controller.cancel();
    transcript.resolve('stale answer');
    await stopping;

    expect(transport.turn).not.toHaveBeenCalled();
    expect(playback.play).not.toHaveBeenCalled();
    expect(playback.stop).toHaveBeenCalled();
  });

  it('reports provider failure without throwing into the hotkey host', async () => {
    const capture = fakeCapture();
    const transport = fakeTransport();
    vi.mocked(transport.transcribe).mockRejectedValue(new Error('provider unavailable'));
    const playback = fakePlayback();
    const states: string[] = [];
    const controller = new VoiceTurnController({
      capture,
      transport,
      playback,
      sessionId: 'session-1',
      onState: (state) => states.push(state),
    });

    await controller.start();
    await expect(controller.stop()).resolves.toBeUndefined();

    expect(states).toEqual(['listening', 'thinking', 'error']);
    expect(playback.play).not.toHaveBeenCalled();
  });
});

describe('fetch voice turn transport', () => {
  it('sends the launch token and released audio through the service routes', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const reply = fakeReply();
    const transport = createFetchVoiceTurnTransport({
      baseUrl: 'http://127.0.0.1:4310/',
      sessionToken: 'launch-token',
      fetchImpl: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        if (String(url).endsWith('/speech/transcribe')) {
          return Response.json({ text: 'Can I afford this?' });
        }
        if (String(url).endsWith('/conversation/turn')) {
          return Response.json(reply);
        }
        return new Response(new Uint8Array([3, 4]), { status: 200 });
      },
    });

    await expect(transport.transcribe(new Uint8Array([1, 2]), 'audio/webm')).resolves.toBe(
      'Can I afford this?',
    );
    await expect(
      transport.turn({ sessionId: 'session-1', turnId: 'turn-1', text: 'Can I afford this?' }),
    ).resolves.toEqual(reply);
    await expect(transport.synthesize('session-1', 'reply-1')).resolves.toEqual(
      new Uint8Array([3, 4]),
    );

    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request.init.headers).toMatchObject({ 'x-session-token': 'launch-token' });
    }
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      audioBase64: 'AQI=',
      mime: 'audio/webm',
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
