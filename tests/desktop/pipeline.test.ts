import { describe, expect, it, vi } from 'vitest';
import { createPipeline, DwellPipeline } from '../../src/desktop/pipeline';
import type { CursorSample } from '../../src/desktop/coordinates';
import type { Frame } from '../../src/desktop/types';

function sample(timestamp: number, x = 100, y = 100, displayId = 'display-1'): CursorSample {
  return { displayId, x, y, timestamp };
}

describe('dwell pipeline', () => {
  it('captures once at 700 ms and not at 699 ms', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const pipeline = new DwellPipeline(capture);

    pipeline.arm();
    await pipeline.observe(sample(0));
    await pipeline.observe(sample(699));
    expect(capture).not.toHaveBeenCalled();

    await pipeline.observe(sample(700));
    expect(capture).toHaveBeenCalledOnce();
  });

  it('resets dwell when the cursor moves more than 8 DIP', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const pipeline = new DwellPipeline(capture);

    pipeline.arm();
    await pipeline.observe(sample(0));
    await pipeline.observe(sample(700, 109, 100));
    await pipeline.observe(sample(1399, 109, 100));
    expect(capture).not.toHaveBeenCalled();

    await pipeline.observe(sample(1400, 109, 100));
    expect(capture).toHaveBeenCalledOnce();
  });

  it('resets dwell when the selected display changes', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const pipeline = new DwellPipeline(capture);

    pipeline.arm();
    await pipeline.observe(sample(0));
    await pipeline.observe(sample(700, 100, 100, 'display-2'));
    await pipeline.observe(sample(1399, 100, 100, 'display-2'));
    expect(capture).not.toHaveBeenCalled();

    await pipeline.observe(sample(1400, 100, 100, 'display-2'));
    expect(capture).toHaveBeenCalledOnce();
  });

  it('does not capture during cooldown or after disarm', async () => {
    const capture = vi.fn().mockResolvedValue(undefined);
    const pipeline = new DwellPipeline(capture);

    pipeline.arm();
    await pipeline.observe(sample(0));
    await pipeline.observe(sample(700));
    await pipeline.observe(sample(5699));
    expect(capture).toHaveBeenCalledOnce();

    pipeline.disarm();
    await pipeline.observe(sample(6400));
    expect(capture).toHaveBeenCalledOnce();
  });

  it('does not start a second capture while one is in flight', async () => {
    let releaseCapture!: () => void;
    const capture = vi.fn(() => new Promise<void>((resolve) => { releaseCapture = resolve; }));
    const pipeline = new DwellPipeline(capture);

    pipeline.arm();
    await pipeline.observe(sample(0));
    const firstCapture = pipeline.observe(sample(700));
    await pipeline.observe(sample(1400));
    expect(capture).toHaveBeenCalledOnce();

    releaseCapture();
    await firstCapture;
  });
});

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

describe('single-flight frame pipeline', () => {
  it('drops work submitted while an extraction is busy', async () => {
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
