export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Frame {
  /** Capture metadata is optional for coordinate-only callers. */
  id?: string;
  capturedAt?: number;
  displayId: string;
  bounds: Rect;
  workArea: Rect;
  imageWidth: number;
  imageHeight: number;
  scaleFactor: number;
  png?: Uint8Array;
}

export interface CursorSample {
  displayId: string;
  x: number;
  y: number;
  timestamp: number;
}

export interface CardSize {
  width: number;
  height: number;
}

export function toDesktopRect(box: Rect, frame: Frame): Rect {
  return {
    x: frame.bounds.x + (box.x * frame.bounds.width) / frame.imageWidth,
    y: frame.bounds.y + (box.y * frame.bounds.height) / frame.imageHeight,
    width: (box.width * frame.bounds.width) / frame.imageWidth,
    height: (box.height * frame.bounds.height) / frame.imageHeight,
  };
}

export function clampCard(anchor: Pick<Rect, 'x' | 'y'>, size: CardSize, workArea: Rect): Pick<Rect, 'x' | 'y'> {
  return {
    x: Math.min(Math.max(anchor.x, workArea.x), workArea.x + workArea.width - size.width),
    y: Math.min(Math.max(anchor.y, workArea.y), workArea.y + workArea.height - size.height),
  };
}
