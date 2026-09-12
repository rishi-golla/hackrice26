export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Rect = Point & Size;

export function clampBubble(
  anchor: Point,
  size: Size,
  workArea: Rect,
  inset = 12,
): Point {
  const minX = workArea.x + inset;
  const minY = workArea.y + inset;
  const maxX = workArea.x + Math.max(inset, workArea.width - size.width - inset);
  const maxY = workArea.y + Math.max(inset, workArea.height - size.height - inset);
  return {
    x: Math.min(Math.max(anchor.x, minX), maxX),
    y: Math.min(Math.max(anchor.y, minY), maxY),
  };
}
