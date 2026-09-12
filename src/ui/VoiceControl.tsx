import { useRef } from 'react';

export type VoiceControlProps = {
  listening: boolean;
  muted: boolean;
  onStart: () => void;
  onStop: () => void;
  onMute: () => void;
};

export function VoiceControl({
  listening,
  muted,
  onStart,
  onStop,
  onMute,
}: VoiceControlProps) {
  const keyActive = useRef(false);
  return (
    <div className="voice-control" data-listening={listening}>
      <button
        type="button"
        aria-label={listening ? 'Release to stop' : 'Hold to talk'}
        aria-pressed={listening}
        onPointerDown={(event) => {
          event.preventDefault();
          onStart();
        }}
        onPointerUp={(event) => {
          event.preventDefault();
          onStop();
        }}
        onPointerCancel={onStop}
        onKeyDown={(event) => {
          if ((event.key === 'Enter' || event.key === ' ') && !event.repeat && !keyActive.current) {
            keyActive.current = true;
            onStart();
          }
        }}
        onKeyUp={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            keyActive.current = false;
            onStop();
          }
        }}
      >
        {listening ? 'Listening…' : 'Hold to talk'}
      </button>
      <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute}>
        {muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}
