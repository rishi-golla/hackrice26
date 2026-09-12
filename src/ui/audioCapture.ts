export type MediaStreamTrackLike = {
  stop(): void;
};

export type MediaStreamLike = {
  getTracks(): readonly MediaStreamTrackLike[];
};

export type MediaRecorderDataEvent = {
  data: Blob;
};

export type MediaRecorderLike = {
  state: 'inactive' | 'recording' | 'paused';
  mimeType: string;
  ondataavailable: ((event: MediaRecorderDataEvent) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(): void;
  stop(): void;
};

export type AudioCaptureRuntime = {
  getUserMedia(): Promise<MediaStreamLike>;
  createRecorder(stream: MediaStreamLike, options?: { mimeType?: string }): MediaRecorderLike;
  now(): number;
};

export type AudioCaptureOptions = {
  maxDurationMs?: number;
  mimeType?: string;
};

export type AudioRecording = {
  audio: Uint8Array;
  mime: string;
  durationMs: number;
};

export type AudioCapture = {
  start(): Promise<void>;
  stop(): Promise<AudioRecording>;
  cancel(): void;
};

export type AudioCaptureErrorCode =
  | 'not-recording'
  | 'permission'
  | 'capture-failed'
  | 'cancelled';

export class AudioCaptureError extends Error {
  public readonly name = 'AudioCaptureError';

  public constructor(public readonly code: AudioCaptureErrorCode, message: string) {
    super(message);
  }
}

const DEFAULT_MAX_DURATION_MS = 30_000;

export function createBrowserAudioCapture(
  options: AudioCaptureOptions = {},
  runtime: AudioCaptureRuntime = createDefaultRuntime(),
): AudioCapture {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  let stream: MediaStreamLike | undefined;
  let recorder: MediaRecorderLike | undefined;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<AudioRecording> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const clearTimer = () => {
    if (stopTimer !== undefined) {
      clearTimeout(stopTimer);
      stopTimer = undefined;
    }
  };

  const closeStream = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
  };

  const clearRecording = () => {
    clearTimer();
    recorder = undefined;
    chunks = [];
    closeStream();
  };

  const start = async (): Promise<void> => {
    if (recorder?.state === 'recording') {
      return;
    }
    if (startPromise) {
      return startPromise;
    }

    cancelled = false;
    startPromise = runtime
      .getUserMedia()
      .then((nextStream) => {
        if (cancelled) {
          nextStream.getTracks().forEach((track) => track.stop());
          throw new AudioCaptureError('cancelled', 'Microphone capture was cancelled.');
        }
        stream = nextStream;
        recorder = runtime.createRecorder(nextStream, options.mimeType ? { mimeType: options.mimeType } : undefined);
        chunks = [];
        startedAt = runtime.now();
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.start();
        stopTimer = setTimeout(() => {
          if (recorder?.state === 'recording') {
            void stop().catch(() => undefined);
          }
        }, maxDurationMs);
      })
      .catch((error) => {
        if (error instanceof AudioCaptureError) {
          throw error;
        }
        throw new AudioCaptureError('permission', 'Microphone permission was not available.');
      })
      .finally(() => {
        startPromise = undefined;
      });

    return startPromise;
  };

  const stop = (): Promise<AudioRecording> => {
    const pendingStart = startPromise;
    if (pendingStart) {
      return pendingStart.then(() => stop());
    }

    if (!recorder || recorder.state === 'inactive') {
      return Promise.reject(new AudioCaptureError('not-recording', 'No active microphone recording.'));
    }
    if (stopPromise) {
      return stopPromise;
    }

    const activeRecorder = recorder;
    stopPromise = new Promise<AudioRecording>((resolve, reject) => {
      const finish = async () => {
        clearTimer();
        const audioType = activeRecorder.mimeType || options.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunks, { type: audioType });
        const durationMs = Math.max(0, runtime.now() - startedAt);
        try {
          const bytes = new Uint8Array(await audioBlob.arrayBuffer());
          clearRecording();
          resolve({ audio: bytes, mime: audioType, durationMs });
        } catch {
          clearRecording();
          reject(new AudioCaptureError('capture-failed', 'Recorded audio could not be read.'));
        }
      };

      activeRecorder.onstop = () => {
        void finish();
      };
      activeRecorder.onerror = () => {
        clearRecording();
        reject(new AudioCaptureError('capture-failed', 'Microphone recording failed.'));
      };
      try {
        activeRecorder.stop();
      } catch {
        clearRecording();
        reject(new AudioCaptureError('capture-failed', 'Microphone recording could not stop.'));
      }
    }).finally(() => {
      stopPromise = undefined;
    });

    return stopPromise;
  };

  const cancel = () => {
    cancelled = true;
    clearTimer();
    chunks = [];
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        // The capture is being discarded; there is no result to publish.
      }
    }
    recorder = undefined;
    closeStream();
  };

  return { start, stop, cancel };
}

function createDefaultRuntime(): AudioCaptureRuntime {
  return {
    getUserMedia: () =>
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
    createRecorder: (stream, options) =>
      new MediaRecorder(stream as MediaStream, options) as unknown as MediaRecorderLike,
    now: () => Date.now(),
  };
}
