import type { CSSProperties } from 'react';

export type CursorCharacterState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';

export type CursorCharacterProps = {
  state: CursorCharacterState;
  pointer: { x: number; y: number };
  reducedMotion?: boolean;
  offset?: number;
};

const stateLabels: Record<CursorCharacterState, string> = {
  idle: 'Ready',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  clarifying: 'Needs clarification',
  error: 'Error',
};

export function CursorCharacter({
  state,
  pointer,
  reducedMotion = false,
  offset = 18,
}: CursorCharacterProps) {
  const style: CSSProperties = {
    left: pointer.x + offset,
    top: pointer.y + offset,
  };
  return (
    <div
      className="cursor-character"
      data-state={state}
      data-reduced-motion={reducedMotion}
      role="status"
      aria-label={stateLabels[state]}
      style={style}
    >
      <img
        aria-hidden="true"
        alt=""
        className="cursor-character__image"
        draggable={false}
        src="./cursor.png"
      />
      {state === 'listening' ? (
        <span aria-hidden="true" className="cursor-character__dots">
          {[0, 1, 2].map((dot) => (
            <span key={dot} data-cursor-dot className="cursor-character__dot" />
          ))}
        </span>
      ) : null}
      <span className="sr-only">{stateLabels[state]}</span>
    </div>
  );
}
