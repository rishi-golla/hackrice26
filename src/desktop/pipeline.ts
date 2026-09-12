import type { DwellCursorSample } from './coordinates';
import type { Frame } from './types';

const DWELL_MS = 700;
const MAX_DWELL_DISTANCE_DIP = 8;
const COOLDOWN_MS = 5000;

export type CaptureHandler = (sample: DwellCursorSample) => Promise<void> | void;

export class DwellPipeline {
  private armed = false;
  private anchor?: DwellCursorSample;
  private dwellStartedAt?: number;
  private lastCaptureAt?: number;
  private captureInFlight = false;

  public constructor(private readonly capture: CaptureHandler) {}

  public arm(): void {
    this.armed = true;
    this.resetAnchor();
  }

  public disarm(): void {
    this.armed = false;
    this.resetAnchor();
  }

  public async observe(sample: DwellCursorSample): Promise<void> {
    if (!this.armed || this.captureInFlight) {
      return;
    }

    if (!this.anchor || sample.displayId !== this.anchor.displayId || this.distanceFromAnchor(sample) > MAX_DWELL_DISTANCE_DIP) {
      this.anchor = sample;
      this.dwellStartedAt = sample.timestamp;
      return;
    }

    if (sample.timestamp - (this.dwellStartedAt ?? sample.timestamp) < DWELL_MS) {
      return;
    }

    if (this.lastCaptureAt !== undefined && sample.timestamp - this.lastCaptureAt < COOLDOWN_MS) {
      return;
    }

    this.captureInFlight = true;
    this.lastCaptureAt = sample.timestamp;
    this.anchor = sample;
    this.dwellStartedAt = sample.timestamp;

    try {
      await this.capture(sample);
    } finally {
      this.captureInFlight = false;
    }
  }

  private distanceFromAnchor(sample: DwellCursorSample): number {
    return Math.hypot(sample.x - this.anchor!.x, sample.y - this.anchor!.y);
  }

  private resetAnchor(): void {
    this.anchor = undefined;
    this.dwellStartedAt = undefined;
  }
}
export type Pipeline = {
  run(frame: Frame): Promise<void>;
  invalidate(): void;
};

export const createPipeline = <T>(extract: (frame: Frame) => Promise<T>, publish: (value: T) => void): Pipeline => {
  let generation = 0;
  let busy = false;

  return {
    async run(frame) {
      if (busy) return;
      const runGeneration = generation;
      busy = true;
      try {
        const value = await extract(frame);
        if (runGeneration === generation) publish(value);
      } finally {
        busy = false;
      }
    },

    invalidate() {
      generation += 1;
    },
  };
};
