import type { KeyboardEvent, PointerEvent } from 'react';
import type { CursorState } from '../shared/contracts';

type VoiceControlProps = {
  state: CursorState;
  muted: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
};

export function VoiceControl({ state, muted, disabled, onStart, onStop, onToggleMute }: VoiceControlProps) {
  const active = state === 'listening';
  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onStart();
  };
  const handlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button === 0) onStop();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onStart();
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onStop();
    }
  };

  return <div className="voice-controls">
    <button
      type="button"
      className={`voice-button${active ? ' active' : ''}`}
      aria-label={active ? 'Release to send voice question' : 'Hold to talk'}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={onStop}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={onStop}
    >
      {active ? 'Release to send' : 'Hold to talk'}
    </button>
    <button type="button" className="mute-button" aria-label={muted ? 'Unmute voice response' : 'Mute voice response'} onClick={onToggleMute}>
      {muted ? 'Unmute' : 'Mute'}
    </button>
  </div>;
}
