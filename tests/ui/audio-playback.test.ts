import { describe, expect, it, vi } from 'vitest';
import { SpeechPlayback, type AudioRuntime } from '../../src/ui/audioPlayback.js';

function fakeRuntime() {
  const players: Array<{ play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; muted: boolean; onended?: () => void; onerror?: () => void }> = [];
  const runtime: AudioRuntime = {
    createObjectUrl: vi.fn(() => 'blob:test'),
    revokeObjectUrl: vi.fn(),
    createAudio: vi.fn(() => {
      const player = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn(),
        muted: false,
        onended: undefined as (() => void) | undefined,
        onerror: undefined as (() => void) | undefined,
      };
      players.push(player);
      return player;
    }),
  };
  return { runtime, players };
}

describe('speech playback', () => {
  it('plays bytes and revokes the object URL when playback ends', async () => {
    const { runtime, players } = fakeRuntime();
    const playback = new SpeechPlayback(runtime);
    const playing = playback.play(new Uint8Array([1, 2]));
    players[0]!.onended?.();
    await expect(playing).resolves.toBeUndefined();
    expect(runtime.createObjectUrl).toHaveBeenCalledOnce();
    expect(runtime.revokeObjectUrl).toHaveBeenCalledWith('blob:test');
  });

  it('stops old audio when a new reply barges in and supports mute', async () => {
    const { runtime, players } = fakeRuntime();
    const playback = new SpeechPlayback(runtime);
    const first = playback.play(new Uint8Array([1]));
    playback.setMuted(true);
    const second = playback.play(new Uint8Array([2]));

    expect(players[0]?.pause).toHaveBeenCalledOnce();
    expect(players[1]?.muted).toBe(true);
    players[1]?.onended?.();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('stops active playback and cleans up on explicit cancellation', async () => {
    const { runtime, players } = fakeRuntime();
    const playback = new SpeechPlayback(runtime);
    const playing = playback.play(new Uint8Array([1]));

    playback.stop();

    expect(players[0]?.pause).toHaveBeenCalledOnce();
    await expect(playing).resolves.toBeUndefined();
    expect(runtime.revokeObjectUrl).toHaveBeenCalledWith('blob:test');
  });
});
