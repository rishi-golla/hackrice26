import type { Answer, BrowserContext, CursorState, FinancialInsightsView, FlickyBridge } from '../shared/contracts';
import { Conversation } from '@11labs/client';

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
      const answer = await this.bridge.turn(transcript, candidateId);
      if (generation !== this.generation) return;
      this.setState(answer.state === 'clarify' || answer.state === 'clarifying' ? 'clarifying' : 'speaking');
      const responseAudio = await this.bridge.speak(answer.replyId);
      if (generation !== this.generation) return;
      await this.play(responseAudio, generation);
    } catch (error) {
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

// ── ElevenLabs Conversational AI Controller ───────────────────────────────────

type ConvAIBridge = Pick<FlickyBridge, 'getConvaiToken' | 'executeTool' | 'state' | 'cancel' | 'openUrl' | 'searchProducts' | 'getScreenText'>;

export type ComparisonResult = {
  results: Array<{ title: string; price: string; url: string; source: string; rating?: number }>;
  searchUrls: Record<string, string>;
  query?: string;
};

export type ConvAICallbacks = {
  onState?: (state: CursorState) => void;
  onError?: (message: string) => void;
  onInsights?: (insights: FinancialInsightsView) => void;
  onTranscript?: (speaker: 'user' | 'agent', text: string) => void;
  onComparison?: (result: ComparisonResult) => void;
  onNavigation?: (url: string, reason: string) => void;
};

/**
 * Manages an ElevenLabs Conversational AI session.
 *
 * Architecture:
 * 1. `start()` gets a signed URL from the Fastify service (API key stays server-side).
 *    The server injects the user's live financial snapshot + screen context into the
 *    agent session as dynamic variables so the agent has full situational awareness.
 * 2. `@11labs/client` opens a WebSocket to ElevenLabs, handles bidirectional PCM audio,
 *    VAD, TTS playback, and turn-taking automatically.
 * 3. When the agent needs data (`get_financial_insights`, `forecast_purchase`), it sends
 *    a client tool call via WebSocket. We execute it against the local Fastify service
 *    via IPC, and the tool result also updates the visual dashboard in real time.
 * 4. `stop()` cleanly ends the ElevenLabs session.
 */
export class ConvAIVoiceController {
  private conversation: Conversation | null = null;
  private active = false;

  constructor(
    private readonly bridge: ConvAIBridge,
    private readonly accountId: string,
    private readonly reserveCents: number,
    private readonly callbacks: ConvAICallbacks = {},
  ) {}

  public isActive(): boolean {
    return this.active;
  }

  public async start(context: BrowserContext = {}): Promise<void> {
    if (this.active) {
      await this.stop();
    }

    this.active = true;
    this.setState('thinking');

    try {
      // Get a short-lived signed WebSocket URL — the server injects live financial
      // data and screen context before creating the ElevenLabs session.
      const signedUrl = await this.bridge.getConvaiToken(context);

      // Build client tools — the agent calls these to get real-time financial data.
      // Each tool also updates the visual dashboard alongside the voice response.
      const clientTools: Record<string, (params: Record<string, unknown>) => Promise<string>> = {
        get_financial_insights: async () => {
          try {
            const result = await this.bridge.executeTool('getFinancialInsights', {
              accountId: this.accountId,
            }) as { insights?: FinancialInsightsView; accountId?: string; mode?: string; asOf?: string };

            const insights = result.insights ?? (result as unknown as FinancialInsightsView);
            if (insights && typeof insights.balanceCents === 'number') {
              this.callbacks.onInsights?.(insights);
            }
            return JSON.stringify(result);
          } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : 'Failed to fetch insights' });
          }
        },

        forecast_purchase: async (params) => {
          try {
            const amountCents = typeof params.amount_cents === 'number' ? params.amount_cents : 0;
            const result = await this.bridge.executeTool('forecastPurchase', {
              accountId: this.accountId,
              purchaseCents: amountCents,
              reserveCents: this.reserveCents,
            });
            return JSON.stringify(result);
          } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : 'Forecast failed' });
          }
        },

        search_products: async (params) => {
          try {
            const query = typeof params.query === 'string' ? params.query : String(params.query ?? '');
            const result = await this.bridge.searchProducts(query);
            this.callbacks.onComparison?.(result);
            return JSON.stringify(result);
          } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' });
          }
        },

        navigate_browser: async (params) => {
          try {
            const url = typeof params.url === 'string' ? params.url : '';
            const reason = typeof params.reason === 'string' ? params.reason : 'Navigating to better deal';
            if (!url.startsWith('https://')) return JSON.stringify({ error: 'URL must start with https://' });
            await this.bridge.openUrl(url);
            this.callbacks.onNavigation?.(url, reason);
            return JSON.stringify({ success: true, url, message: 'Opened in your browser' });
          } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : 'Navigation failed' });
          }
        },

        get_screen_context: async () => {
          try {
            const text = await this.bridge.getScreenText();
            return JSON.stringify({ screenText: text || 'No screen text available', captured: !!text });
          } catch (error) {
            return JSON.stringify({ error: error instanceof Error ? error.message : 'Screen capture failed' });
          }
        },
      };

      this.conversation = await Conversation.startSession({
        signedUrl,
        clientTools,

        onConnect: () => {
          this.setState('listening');
        },

        onDisconnect: () => {
          this.active = false;
          this.conversation = null;
          this.setState('idle');
          void this.bridge.cancel().catch(() => undefined);
        },

        onError: (message) => {
          this.callbacks.onError?.(
            typeof message === 'string' ? message : 'Conversational AI error',
          );
          if (this.active) this.setState('error');
        },

        onModeChange: ({ mode }) => {
          if (!this.active) return;
          if (mode === 'speaking') this.setState('speaking');
          else if (mode === 'listening') this.setState('listening');
        },
      } as Parameters<typeof Conversation.startSession>[0]);
    } catch (error) {
      this.active = false;
      this.conversation = null;
      const message =
        error instanceof Error
          ? error.message.includes('not configured')
            ? 'ConvAI agent not configured. Run: node scripts/setup-elevenlabs-agent.mjs'
            : error.message
          : 'Failed to start conversation';
      this.callbacks.onError?.(message);
      this.setState('error');
    }
  }

  public async stop(): Promise<void> {
    this.active = false;
    const conv = this.conversation;
    this.conversation = null;
    if (conv) {
      try {
        await conv.endSession();
      } catch {
        // Ignore errors when ending session
      }
    }
    this.setState('idle');
    void this.bridge.cancel().catch(() => undefined);
  }

  public async toggle(context: BrowserContext = {}): Promise<void> {
    if (this.active) await this.stop();
    else await this.start(context);
  }

  private setState(state: CursorState): void {
    this.callbacks.onState?.(state);
    void this.bridge.state(state).catch(() => undefined);
  }
}
