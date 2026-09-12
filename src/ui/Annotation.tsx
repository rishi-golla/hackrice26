import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { clampCard, toDesktopRect, type CardSize, type Frame, type Rect } from '../desktop/coordinates';

export type AnnotationProps = {
  buttonBox: Rect | null;
  frame: Frame | null;
  frameAgeMs: number;
  status: 'negative' | 'below-reserve' | 'within-reserve';
  confirmed: boolean;
  warning?: string;
  onExpire?: () => void;
};

export type CursorHaloProps = {
  x: number;
  y: number;
};

export function annotationCanRender(props: Pick<AnnotationProps, 'buttonBox' | 'frame' | 'frameAgeMs' | 'status' | 'confirmed'>): boolean {
  return props.confirmed
    && props.status === 'negative'
    && props.buttonBox !== null
    && props.frame !== null
    && Number.isFinite(props.frameAgeMs)
    && props.frameAgeMs >= 0
    && props.frameAgeMs <= 3_000;
}

export function anchoredCardPosition(anchor: { x: number; y: number }, size: CardSize, workArea: Rect): Rect {
  return { ...clampCard({ x: anchor.x + 16, y: anchor.y + 16 }, size, workArea), width: size.width, height: size.height };
}

export function CursorHalo({ x, y }: CursorHaloProps): ReactElement {
  return <span aria-hidden="true" className="cursor-halo" style={{ left: x + 16, top: y + 16 }} />;
}

export function Annotation({ buttonBox, frame, frameAgeMs, status, confirmed, warning = 'Purchase may take your balance below zero', onExpire }: AnnotationProps): ReactElement | null {
  const canRender = annotationCanRender({ buttonBox, frame, frameAgeMs, status, confirmed });

  useEffect(() => {
    if (!canRender || !onExpire) return undefined;
    const timer = window.setTimeout(onExpire, 5_000);
    return () => window.clearTimeout(timer);
  }, [buttonBox, frame, frameAgeMs, status, confirmed, onExpire, canRender]);

  if (!canRender || !buttonBox || !frame) return null;
  const desktopBox = toDesktopRect(buttonBox, frame);
  const padding = 6;

  return (
    <div className="annotation" aria-hidden="true" style={{ left: desktopBox.x - padding, top: desktopBox.y - padding, width: desktopBox.width + padding * 2, height: desktopBox.height + padding * 2 }}>
      <div className="annotation__outline" />
      <svg className="annotation__arrow" viewBox="0 0 46 34" preserveAspectRatio="none">
        <path d="M 42 4 C 28 6, 22 14, 7 27" />
        <path d="M 7 27 L 17 26 M 7 27 L 12 18" />
      </svg>
      <span className="annotation__text">{warning}</span>
    </div>
  );
}
