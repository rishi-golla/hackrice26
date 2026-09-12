import { describe, expect, it, vi } from 'vitest';
import { configureAnnotationWindow, overlayPolicy } from '../../src/desktop/windows';

describe('overlay windows', () => {
  it('uses secure transparent always-on-top options for the overlay', () => {
    expect(overlayPolicy()).toEqual({
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  });

  it('makes the annotation window click-through and unfocusable', () => {
    const annotationWindow = {
      setIgnoreMouseEvents: vi.fn(),
      setFocusable: vi.fn(),
    };

    configureAnnotationWindow(annotationWindow);

    expect(annotationWindow.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
    expect(annotationWindow.setFocusable).toHaveBeenCalledWith(false);
  });
});