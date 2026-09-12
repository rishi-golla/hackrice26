export type AudioPlayer = {
  muted: boolean;
  onended?: () => void;
  onerror?: () => void;
  play(): Promise<void>;
  pause(): void;
};

export type AudioRuntime = {
  createObjectUrl(bytes: Uint8Array): string;
  revokeObjectUrl(url: string): void;
  createAudio(url: string): AudioPlayer;
};

type ActivePlayback = {
  url: string;
  player: AudioPlayer;
  finish: (error?: Error) => void;
};

export class SpeechPlayback {
  private active?: ActivePlayback;
  private muted = false;

  public constructor(private readonly runtime: AudioRuntime) {}

  public async play(bytes: Uint8Array): Promise<void> {
    this.stop();
    const url = this.runtime.createObjectUrl(bytes);
    const player = this.runtime.createAudio(url);
    player.muted = this.muted;
    let settled = false;
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (this.active?.player === player) {
        this.active = undefined;
      }
      this.runtime.revokeObjectUrl(url);
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    };
    this.active = { url, player, finish };
    player.onended = () => finish();
    player.onerror = () => finish(new Error('Audio playback failed.'));
    try {
      await player.play();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Audio playback failed.'));
    }
    return promise;
  }

  public stop(): void {
    if (!this.active) {
      return;
    }
    const active = this.active;
    active.player.pause();
    active.finish();
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.active) {
      this.active.player.muted = muted;
    }
  }
}
