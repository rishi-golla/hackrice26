import { describe, expect, it } from 'vitest';
import { clampCard, toDesktopRect } from '../../src/desktop/coordinates';
import type { Frame } from '../../src/desktop/types';

const frame = (overrides: Partial<Frame> = {}): Frame => ({
  id: 'frame-1',
  capturedAt: 0,
  displayId: 'left',
  bounds: { x: -1440, y: 0, width: 1440, height: 900 },
  workArea: { x: -1440, y: 0, width: 1440, height: 860 },
  imageWidth: 2880,
  imageHeight: 1800,
  png: new Uint8Array(),
  ...overrides,
});

describe('toDesktopRect', () => {
  it('maps Retina pixels onto a display with a negative desktop origin', () => {
    expect(toDesktopRect({ x: 200, y: 100, width: 400, height: 80 }, frame())).toEqual({
      x: -1340,
      y: 50,
      width: 200,
      height: 40,
    });
  });

  it('uses image dimensions once for a 125 percent capture', () => {
    const scaled = frame({
      bounds: { x: 1920, y: -120, width: 1536, height: 864 },
      workArea: { x: 1920, y: -120, width: 1536, height: 824 },
      imageWidth: 1920,
      imageHeight: 1080,
    });

    expect(toDesktopRect({ x: 125, y: 250, width: 375, height: 50 }, scaled)).toEqual({
      x: 2020,
      y: 80,
      width: 300,
      height: 40,
    });
  });

  it('rejects invalid capture dimensions instead of emitting infinite coordinates', () => {
    expect(() => toDesktopRect({ x: 0, y: 0, width: 10, height: 10 }, frame({ imageWidth: 0 }))).toThrow(
      /image dimensions/i,
    );
  });
});

describe('clampCard', () => {
  it('keeps a card inside a negative-origin work area at the bottom-right edge', () => {
    expect(
      clampCard(
        { x: -100, y: 800 },
        { width: 360, height: 240 },
        { x: -1440, y: -100, width: 1440, height: 900 },
      ),
    ).toEqual({ x: -360, y: 560, width: 360, height: 240 });
  });

  it('shrinks an oversized card to the available work area', () => {
    expect(clampCard({ x: 50, y: 50 }, { width: 500, height: 400 }, { x: 10, y: 20, width: 300, height: 200 })).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 200,
    });
  });
});
