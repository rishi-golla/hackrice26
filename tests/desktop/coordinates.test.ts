import { describe, expect, it } from 'vitest';
import { clampCard, toDesktopRect, type Frame, type Rect } from '../../src/desktop/coordinates';

describe('display coordinates', () => {
  it('maps OCR pixels to desktop coordinates without scaling twice', () => {
    const frame: Frame = {
      displayId: 'retina-display',
      bounds: { x: -1440, y: 40, width: 1440, height: 900 },
      workArea: { x: -1440, y: 40, width: 1440, height: 860 },
      imageWidth: 2880,
      imageHeight: 1800,
      scaleFactor: 2,
    };

    expect(toDesktopRect({ x: 720, y: 300, width: 400, height: 200 }, frame)).toEqual({
      x: -1080,
      y: 190,
      width: 200,
      height: 100,
    });
  });

  it('clamps a card inside a work area with a negative origin', () => {
    const workArea: Rect = { x: -1280, y: 0, width: 1280, height: 720 };

    expect(clampCard({ x: 100, y: 650 }, { width: 360, height: 200 }, workArea)).toEqual({
      x: -360,
      y: 520,
    });
  });
});