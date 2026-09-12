import { describe, expect, it, vi } from 'vitest';
import { captureSelectedDisplay, capturePermissionState } from '../../src/desktop/capture';

describe('selected-display capture', () => {
  it('exposes recovery and manual entry when screen permission is denied', () => {
    expect(capturePermissionState('denied')).toEqual({
      canCapture: false,
      manualAmountEntry: true,
      retryRequiresUserAction: true,
      message: 'Screen capture permission is required. Grant access, then retry.',
    });
  });

  it('captures the source matching the selected display ID', async () => {
    const captureSource = vi.fn((source: { display_id: string }) => source.display_id);
    const hideOverlays = vi.fn();
    const restoreOverlays = vi.fn();

    const result = await captureSelectedDisplay('display-2', {
      desktopCapturer: {
        getSources: vi.fn().mockResolvedValue([
          { display_id: 'display-1' },
          { display_id: 'display-2' },
        ]),
      },
      captureSource,
      hideOverlays,
      restoreOverlays,
    });

    expect(result).toBe('display-2');
    expect(captureSource).toHaveBeenCalledWith({ display_id: 'display-2' });
    expect(hideOverlays).toHaveBeenCalledOnce();
    expect(restoreOverlays).toHaveBeenCalledOnce();
  });

  it('restores overlays when capture fails', async () => {
    const restoreOverlays = vi.fn();
    const captureError = new Error('capture failed');

    await expect(
      captureSelectedDisplay('display-1', {
        desktopCapturer: {
          getSources: vi.fn().mockResolvedValue([{ display_id: 'display-1' }]),
        },
        captureSource: vi.fn().mockRejectedValue(captureError),
        hideOverlays: vi.fn(),
        restoreOverlays,
      }),
    ).rejects.toThrow(captureError);

    expect(restoreOverlays).toHaveBeenCalledOnce();
  });
});