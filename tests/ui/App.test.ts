import { describe, expect, it, vi } from 'vitest';
import { createAnalysisCoordinator } from '../../src/ui/App';

describe('analysis generation coordinator', () => {
  it('does not publish a result invalidated by a newer screen state', async () => {
    let resolveAnalysis!: (value: string) => void;
    const publish = vi.fn();
    const coordinator = createAnalysisCoordinator(
      () => new Promise<string>((resolve) => { resolveAnalysis = resolve; }),
      publish,
    );

    const pending = coordinator.request({ purchaseCents: 20_000, allowStale: false });
    coordinator.invalidate();
    resolveAnalysis('old forecast');

    await expect(pending).resolves.toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});
