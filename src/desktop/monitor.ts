import type { CursorSample } from './types';

const DWELL_MS = 700;
const ANCHOR_RADIUS_DIP = 8;
const COOLDOWN_MS = 5_000;

export type Monitor = {
  setEnabled(enabled: boolean): void;
  sample(value: CursorSample): void;
  dispose(): void;
};

export const createMonitor = (onDwell: (sample: CursorSample) => void): Monitor => {
  let enabled = false;
  let disposed = false;
  let anchor: CursorSample | null = null;
  let lastTriggerAt: number | null = null;

  const reset = (): void => {
    anchor = null;
    lastTriggerAt = null;
  };

  return {
    setEnabled(value) {
      if (disposed || enabled === value) return;
      enabled = value;
      reset();
    },

    sample(value) {
      if (disposed || !enabled) return;
      if (![value.x, value.y, value.at].every(Number.isFinite)) return;

      if (anchor === null || anchor.displayId !== value.displayId || value.at < anchor.at) {
        reset();
        anchor = value;
        return;
      }

      const distanceFromAnchor = Math.hypot(value.x - anchor.x, value.y - anchor.y);
      if (distanceFromAnchor > ANCHOR_RADIUS_DIP) {
        anchor = value;
        return;
      }

      if (value.at - anchor.at < DWELL_MS) return;
      if (lastTriggerAt !== null && value.at - lastTriggerAt < COOLDOWN_MS) return;

      lastTriggerAt = value.at;
      anchor = value;
      onDwell(value);
    },

    dispose() {
      disposed = true;
      enabled = false;
      reset();
    },
  };
};
