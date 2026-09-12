import { describe, expect, it, vi } from 'vitest';
import { DwellPipeline } from '../../src/desktop/pipeline';
import type { CursorSample } from '../../src/desktop/coordinates';

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