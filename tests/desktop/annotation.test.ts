import { describe, expect, it } from 'vitest';
import { annotationCanRender, anchoredCardPosition } from '../../src/ui/Annotation';

const frame = {
  id: 'frame-1',
  capturedAt: 1,
  displayId: 'display-1',
  bounds: { x: -1280, y: 40, width: 1280, height: 720 },
  workArea: { x: -1280, y: 40, width: 1280, height: 680 },
  imageWidth: 2560,
  imageHeight: 1440,
  scaleFactor: 2,
  png: new Uint8Array([1]),
};

describe('passive warning annotation', () => {
  it('renders only for a fresh confirmed negative result', () => {
    const base = { buttonBox: { x: 100, y: 100, width: 120, height: 30 }, frame, frameAgeMs: 100, status: 'negative' as const, confirmed: true };
    expect(annotationCanRender(base)).toBe(true);
    expect(annotationCanRender({ ...base, frameAgeMs: 3_001 })).toBe(false);
    expect(annotationCanRender({ ...base, status: 'below-reserve' })).toBe(false);
    expect(annotationCanRender({ ...base, confirmed: false })).toBe(false);
  });

  it('clamps the anchored card inside a negative-origin work area', () => {
    expect(anchoredCardPosition({ x: 100, y: 650 }, { width: 360, height: 200 }, frame.workArea)).toEqual({
      x: -360,
      y: 520,
      width: 360,
      height: 200,
    });
  });
});
