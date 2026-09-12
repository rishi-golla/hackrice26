import type { KeyboardEvent, PointerEvent } from 'react';
import type { CursorState } from '../shared/contracts';

type VoiceControlProps = {
  state: CursorState;
  muted: boolean;
  disabled: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
  useToggle?: boolean;
};

export function VoiceControl({ state, muted, disabled, onStart, onStop, onToggleMute, useToggle }: VoiceControlProps) {
  const active = state === 'listening' || state === 'speaking' || state === 'thinking';

  if (useToggle) {
    return <div className="voice-controls">
      <button
        type="button"
        className={`voice-button${active ? ' active' : ''}`}
        aria-label={active ? 'End advisor session' : 'Start advisor'}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => { if (active) onStop(); else onStart(); }}
      >
        {active ? 'End session' : 'Start advisor'}
      </button>
      <button type="button" className="mute-button" aria-label={muted ? 'Unmute voice response' : 'Mute voice response'} onClick={onToggleMute}>
        {muted ? 'Unmute' : 'Mute'}
      </button>
    </div>;
  }

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
      className={`voice-button${state === 'listening' ? ' active' : ''}`}
      aria-label={state === 'listening' ? 'Release to send voice question' : 'Hold to talk'}
      aria-pressed={state === 'listening'}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={onStop}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={onStop}
    >
      {state === 'listening' ? 'Release to send' : 'Hold to talk'}
    </button>
    <button type="button" className="mute-button" aria-label={muted ? 'Unmute voice response' : 'Mute voice response'} onClick={onToggleMute}>
      {muted ? 'Unmute' : 'Mute'}
    </button>
  </div>;
}
