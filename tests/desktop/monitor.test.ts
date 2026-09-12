import { describe, expect, it, vi } from 'vitest';
import { createMonitor } from '../../src/desktop/monitor';
import type { CursorSample } from '../../src/desktop/types';

const sample = (at: number, x = 10, y = 20, displayId = 'primary'): CursorSample => ({ x, y, displayId, at });

describe('createMonitor', () => {
  it('fires once at 700 ms but not at 699 ms', () => {
    const onDwell = vi.fn();
    const monitor = createMonitor(onDwell);
    monitor.setEnabled(true);

    monitor.sample(sample(0));
    monitor.sample(sample(699));
    expect(onDwell).not.toHaveBeenCalled();

    monitor.sample(sample(700));
    expect(onDwell).toHaveBeenCalledTimes(1);
    expect(onDwell).toHaveBeenLastCalledWith(sample(700));
  });

  it('measures drift from a fixed anchor and resets dwell after crossing 8 DIP', () => {
    const onDwell = vi.fn();
    const monitor = createMonitor(onDwell);
    monitor.setEnabled(true);

    monitor.sample(sample(0, 0, 0));
    monitor.sample(sample(300, 6, 0));
    monitor.sample(sample(600, 9, 0));
    monitor.sample(sample(1_299, 9, 0));
    expect(onDwell).not.toHaveBeenCalled();

    monitor.sample(sample(1_300, 9, 0));
    expect(onDwell).toHaveBeenCalledTimes(1);
  });

  it('enforces a five-second cooldown without queueing callbacks', () => {
    const onDwell = vi.fn();
    const monitor = createMonitor(onDwell);
    monitor.setEnabled(true);

    monitor.sample(sample(0));
    monitor.sample(sample(700));
    monitor.sample(sample(1_400));
    monitor.sample(sample(5_699));
    expect(onDwell).toHaveBeenCalledTimes(1);

    monitor.sample(sample(5_700));
    expect(onDwell).toHaveBeenCalledTimes(2);
  });

  it('resets dwell and cooldown when the display changes or monitoring is disarmed', () => {
    const onDwell = vi.fn();
    const monitor = createMonitor(onDwell);
    monitor.setEnabled(true);
    monitor.sample(sample(0));
    monitor.sample(sample(700));

    monitor.sample(sample(701, 10, 20, 'secondary'));
    monitor.sample(sample(1_400, 10, 20, 'secondary'));
    expect(onDwell).toHaveBeenCalledTimes(1);
    monitor.sample(sample(1_401, 10, 20, 'secondary'));
    expect(onDwell).toHaveBeenCalledTimes(2);

    monitor.setEnabled(false);
    monitor.sample(sample(5_000, 10, 20, 'secondary'));
    monitor.setEnabled(true);
    monitor.sample(sample(5_001, 10, 20, 'secondary'));
    monitor.sample(sample(5_700, 10, 20, 'secondary'));
    expect(onDwell).toHaveBeenCalledTimes(2);
    monitor.sample(sample(5_701, 10, 20, 'secondary'));
    expect(onDwell).toHaveBeenCalledTimes(3);
  });

  it('stops permanently after disposal', () => {
    const onDwell = vi.fn();
    const monitor = createMonitor(onDwell);
    monitor.setEnabled(true);
    monitor.sample(sample(0));
    monitor.dispose();
    monitor.sample(sample(700));
    monitor.setEnabled(true);
    monitor.sample(sample(1_400));
    expect(onDwell).not.toHaveBeenCalled();
  });
});
