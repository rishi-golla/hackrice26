import { describe, expect, it, vi } from 'vitest';
import { createPipeline } from '../../src/desktop/pipeline';
import type { Frame } from '../../src/desktop/types';

const frame = (id: string): Frame => ({
  id,
  capturedAt: 0,
  displayId: 'primary',
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  workArea: { x: 0, y: 0, width: 100, height: 100 },
  imageWidth: 100,
  imageHeight: 100,
  png: new Uint8Array(),
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('createPipeline', () => {
  it('allows only one extraction and drops work submitted while busy', async () => {
    const first = deferred<string>();
    const extract = vi.fn(() => first.promise);
    const publish = vi.fn();
    const pipeline = createPipeline(extract, publish);

    const firstRun = pipeline.run(frame('first'));
    await pipeline.run(frame('dropped'));
    first.resolve('first-result');
    await firstRun;

    expect(extract).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('first-result');
  });

  it('discards a late result after invalidation and accepts later work', async () => {
    const first = deferred<string>();
    const extract = vi.fn((value: Frame) => (value.id === 'first' ? first.promise : Promise.resolve('second-result')));
    const publish = vi.fn();
    const pipeline = createPipeline(extract, publish);

    const firstRun = pipeline.run(frame('first'));
    pipeline.invalidate();
    first.resolve('stale-result');
    await firstRun;
    expect(publish).not.toHaveBeenCalled();

    await pipeline.run(frame('second'));
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('second-result');
  });

  it('releases the single-flight guard when extraction fails', async () => {
    const extract = vi.fn().mockRejectedValueOnce(new Error('OCR failed')).mockResolvedValueOnce('recovered');
    const publish = vi.fn();
    const pipeline = createPipeline(extract, publish);

    await expect(pipeline.run(frame('bad'))).rejects.toThrow('OCR failed');
    await pipeline.run(frame('good'));
    expect(publish).toHaveBeenCalledWith('recovered');
  });
});
