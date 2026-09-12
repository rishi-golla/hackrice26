import type { Answer, CursorState, FlickyBridge } from '../shared/contracts';
import { ServiceError } from '../shared/verification';

export type RecorderLike = {
  state: 'inactive' | 'recording' | string;
  ondataavailable?: ((event: { data: Blob }) => void) | null;
  onstop?: (() => void) | null;
  onerror?: (() => void) | null;
  start(): void;
  stop(): void;
};

type StreamLike = { getTracks(): Array<{ stop(): void }> };

type AudioLike = {
  src: string;
  onended: (() => void) | null;
  volume?: number;
  play(): Promise<void>;
  pause(): void;
};

export type VoiceRuntime = {
  getUserMedia(constraints: { audio: true }): Promise<StreamLike>;
  createRecorder(stream: StreamLike, mimeType: string): RecorderLike;
  supportsMimeType?: (mimeType: string) => boolean;
  createAudio(): AudioLike;
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  now(): number;
};

type VoiceBridge = Pick<FlickyBridge, 'transcribe' | 'turn' | 'speak' | 'state' | 'cancel'>;

const recordingMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'];

export function chooseRecordingMimeType(supportsMimeType?: (mimeType: string) => boolean): string {
  return recordingMimeTypes.find(mimeType => supportsMimeType?.(mimeType) ?? true) ?? 'audio/webm';
}

export class VoiceTurnController {
  private recorder?: RecorderLike;
  private stream?: StreamLike;
  private audio?: AudioLike;
  private audioUrl?: string;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private generation = 0;
  private candidateId?: string;
  private muted = false;
  private suppressNextHostCancel = false;

  public constructor(
    private readonly bridge: VoiceBridge,
    private readonly runtime: VoiceRuntime,
    private readonly onState?: (state: CursorState) => void,
    private readonly onError?: (message: string) => void,
  ) {}

  public isRecording(): boolean {
    return this.recorder?.state === 'recording';
  }

  public async start(candidateId?: string): Promise<void> {
    const generation = ++this.generation;
    this.stopRecorder();
    this.stopAudio();
    this.suppressNextHostCancel = true;
    void this.bridge.cancel().catch(() => { this.suppressNextHostCancel = false; });
    this.candidateId = candidateId;

    try {
      const stream = await this.runtime.getUserMedia({ audio: true });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      const mimeType = chooseRecordingMimeType(this.runtime.supportsMimeType);
      const recorder = this.runtime.createRecorder(stream, mimeType);
      this.stream = stream;
      this.recorder = recorder;
      this.chunks = [];
      this.startedAt = this.runtime.now();
      recorder.ondataavailable = event => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onerror = () => this.fail(generation, 'Voice recording failed. You can type your question instead.');
      recorder.onstop = () => {
        this.recorder = undefined;
        this.stopStream(stream);
        void this.finish(generation, this.chunks, this.startedAt, mimeType, this.candidateId);
      };
      recorder.start();
      this.setState('listening');
    } catch (error) {
      this.fail(generation, error instanceof Error ? error.message : 'Microphone access failed.');
    }
  }

  public stop(): void {
    if (this.recorder?.state === 'recording') {
      this.recorder.stop();
      return;
    }
    this.generation += 1;
    void this.bridge.cancel().catch(() => undefined);
  }

  public async cancel(): Promise<void> {
    this.cancelLocal();
    this.suppressNextHostCancel = true;
    await this.bridge.cancel().catch(() => { this.suppressNextHostCancel = false; });
  }

  public handleHostCancel(): void {
    if (this.suppressNextHostCancel) {
      this.suppressNextHostCancel = false;
      return;
    }
    this.cancelLocal();
  }

  public cancelLocal(): void {
    this.generation += 1;
    this.stopRecorder();
    this.stopAudio();
    this.setState('idle');
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.audio?.volume !== undefined) this.audio.volume = muted ? 0 : 1;
  }

  public async readAloud(replyId: string): Promise<void> {
    this.cancelLocal();
    const generation = this.generation;
    try {
      this.setState('speaking');
      const bytes = await this.bridge.speak(replyId);
      if (generation === this.generation) await this.play(bytes, generation);
    } catch (error) {
      this.fail(generation, error instanceof Error ? error.message : 'Speech unavailable.');
    }
  }

  public async toggle(candidateId?: string): Promise<void> {
    if (this.isRecording()) this.stop();
    else await this.start(candidateId);
  }

  private stopRecorder(): void {
    const recorder = this.recorder;
    this.recorder = undefined;
    if (recorder?.state === 'recording') recorder.stop();
    if (this.stream) this.stopStream(this.stream);
    this.stream = undefined;
  }

  private stopStream(stream: StreamLike): void {
    stream.getTracks().forEach(track => track.stop());
    if (this.stream === stream) this.stream = undefined;
  }

  private stopAudio(): void {
    this.audio?.pause();
    this.audio = undefined;
    if (this.audioUrl) this.runtime.revokeObjectUrl(this.audioUrl);
    this.audioUrl = undefined;
  }

  private async finish(
    generation: number,
    chunks: Blob[],
    startedAt: number,
    mimeType: string,
    candidateId?: string,
  ): Promise<void> {
    if (generation !== this.generation) return;
    try {
      if (chunks.length === 0) throw new Error('No audio was captured. You can type your question instead.');
      this.setState('thinking');
      const blob = new Blob(chunks, { type: mimeType });
      const audio = new Uint8Array(await blob.arrayBuffer());
      const durationMs = Math.max(1, Math.min(30_000, this.runtime.now() - startedAt));
      const transcript = await this.bridge.transcribe(audio, mimeType, durationMs);
      if (generation !== this.generation) return;
      if (!transcript.trim()) throw new Error('No speech was detected. You can type your question instead.');
      this.suppressNextHostCancel = true;
      let answer: Answer;
      try {
        answer = await this.bridge.turn(transcript, candidateId);
      } finally {
        this.suppressNextHostCancel = false;
      }
      if (generation !== this.generation) return;
      // Account replies require a separate Read aloud click. Unknown sensitivity stays silent.
      if (answer.sensitive !== false) {
        this.setState(answer.state === 'clarifying' ? 'clarifying' : 'idle');
        return;
      }
      this.setState(answer.state === 'clarify' || answer.state === 'clarifying' ? 'clarifying' : 'speaking');
      const responseAudio = await this.bridge.speak(answer.replyId);
      if (generation !== this.generation) return;
      await this.play(responseAudio, generation);
    } catch (error) {
      if (error instanceof ServiceError && error.code?.startsWith('verification_')) { this.setState('idle'); return; }
      this.fail(generation, error instanceof Error ? error.message : 'Voice turn failed. You can type your question instead.');
    }
  }

  private async play(bytes: Uint8Array, generation: number): Promise<void> {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const audio = this.runtime.createAudio();
    const url = this.runtime.createObjectUrl(new Blob([buffer], { type: 'audio/mpeg' }));
    this.audio = audio;
    this.audioUrl = url;
    audio.src = url;
    if (audio.volume !== undefined) audio.volume = this.muted ? 0 : 1;
    audio.onended = () => {
      if (generation === this.generation) {
        this.stopAudio();
        this.setState('idle');
      }
    };
    await audio.play();
  }

  private setState(state: CursorState): void {
    this.onState?.(state);
    void this.bridge.state(state).catch(() => undefined);
  }

  private fail(generation: number, message: string): void {
    if (generation !== this.generation) return;
    this.stopRecorder();
    this.onError?.(message);
    this.setState('error');
  }
}

export function createBrowserVoiceRuntime(): VoiceRuntime {
  return {
    getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, mimeType) => new MediaRecorder(stream as MediaStream, { mimeType }) as unknown as RecorderLike,
    supportsMimeType: mimeType => MediaRecorder.isTypeSupported(mimeType),
    createAudio: () => new Audio() as unknown as AudioLike,
    createObjectUrl: blob => URL.createObjectURL(blob),
    revokeObjectUrl: url => URL.revokeObjectURL(url),
    now: () => Date.now(),
  };
}
