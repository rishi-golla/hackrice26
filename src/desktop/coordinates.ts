import type { Frame, Rect } from './types';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

const requireFiniteRect = (rect: Rect, label: string): void => {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 0 || rect.height < 0) {
    throw new RangeError(`${label} must contain finite coordinates and non-negative dimensions`);
  }
};

export const toDesktopRect = (imageRect: Rect, frame: Frame): Rect => {
  requireFiniteRect(imageRect, 'image rectangle');
  requireFiniteRect(frame.bounds, 'display bounds');
  if (!Number.isFinite(frame.imageWidth) || !Number.isFinite(frame.imageHeight) || frame.imageWidth <= 0 || frame.imageHeight <= 0) {
    throw new RangeError('Frame image dimensions must be positive finite numbers');
  }

  const scaleX = frame.bounds.width / frame.imageWidth;
  const scaleY = frame.bounds.height / frame.imageHeight;
  return {
    x: frame.bounds.x + imageRect.x * scaleX,
    y: frame.bounds.y + imageRect.y * scaleY,
    width: imageRect.width * scaleX,
    height: imageRect.height * scaleY,
  };
};

export const clampCard = (anchor: Point, size: Size, workArea: Rect): Rect => {
  requireFiniteRect(workArea, 'work area');
  if (![anchor.x, anchor.y, size.width, size.height].every(Number.isFinite) || size.width < 0 || size.height < 0) {
    throw new RangeError('Card anchor and size must be finite with non-negative dimensions');
  }

  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  const maximumX = workArea.x + workArea.width - width;
  const maximumY = workArea.y + workArea.height - height;

  return {
    x: Math.min(Math.max(anchor.x, workArea.x), maximumX),
    y: Math.min(Math.max(anchor.y, workArea.y), maximumY),
    width,
    height,
  };
};
