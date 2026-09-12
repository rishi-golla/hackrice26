import { useEffect, useState, type CSSProperties } from 'react';
import { clampBubble, type Point, type Rect, type Size } from './position.js';

export type ConversationBubbleProps = {
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';
  text: string;
  anchor: Point;
  size: Size;
  workArea: Rect;
  pinned?: boolean;
  onPin?: () => void;
  onDismiss?: () => void;
};

export function ConversationBubble({
  state,
  text,
  anchor,
  size,
  workArea,
  pinned = false,
  onPin,
  onDismiss,
}: ConversationBubbleProps) {
  const position = clampBubble(anchor, size, workArea);
  const style: CSSProperties = { left: position.x, top: position.y, width: size.width };
  const persistent = state === 'clarifying';
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (persistent || pinned || paused || !onDismiss) {
      return undefined;
    }
    const timer = setTimeout(onDismiss, 8_000);
    return () => clearTimeout(timer);
  }, [onDismiss, paused, persistent, pinned]);

  return (
    <div
      className="conversation-bubble"
      data-state={state}
      data-pinned={pinned}
      role={persistent ? 'dialog' : 'status'}
      aria-label="Cursor response"
      tabIndex={0}
      style={style}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <p>{text}</p>
      {onPin ? (
        <button type="button" aria-pressed={pinned} onClick={onPin}>
          {pinned ? 'Unpin' : 'Pin'}
        </button>
      ) : null}
      {!persistent && onDismiss ? (
        <button type="button" aria-label="Dismiss response" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </div>
  );
}
