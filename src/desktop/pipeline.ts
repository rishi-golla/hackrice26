import type { Frame } from './types';

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
