// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Annotation, CursorHalo } from '../../src/ui/Annotation';

const frame = {
  displayId: 'display-1',
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  workArea: { x: 0, y: 0, width: 100, height: 100 },
  imageWidth: 100,
  imageHeight: 100,
  scaleFactor: 1,
};

describe('Annotation', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('expires a fresh warning after five seconds', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { container } = render(<Annotation
      buttonBox={{ x: 10, y: 10, width: 20, height: 10 }}
      confirmed
      frame={frame}
      frameAgeMs={0}
      onExpire={onExpire}
      status="negative"
    />);

    expect(container.querySelector('.annotation')).toBeTruthy();
    vi.advanceTimersByTime(4_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  it('renders the custom cursor image at the pointer position', () => {
    const { container } = render(<CursorHalo x={100} y={200} />);

    const cursor = container.querySelector('img');
    expect(cursor?.getAttribute('src')).toBe('./cursor.png');
    expect(cursor?.getAttribute('alt')).toBe('');
    expect(cursor?.getAttribute('aria-hidden')).toBe('true');
    expect(cursor?.style.left).toBe('118px');
    expect(cursor?.style.top).toBe('218px');
  });
});
