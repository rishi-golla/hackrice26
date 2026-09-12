import type { Forecast, DataMode } from '../domain/types';

export type CursorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';
export interface DisplayChoice { id: string; label: string }
export interface Capabilities { router: boolean; transcription: boolean; speech: boolean; financialActions: false }
export interface PublicConfig {
  mode: DataMode; accountId: string; displays: DisplayChoice[]; displayId: string;
  monitoring: boolean; microphoneConsent: boolean; capabilities: Capabilities;
  shortcut: string; shortcutAvailable: boolean; permission: string;
}
export interface Answer {
  turnId: string; replyId: string; state: string; text: string;
  forecast?: Forecast; scenario?: unknown;
}
export interface CandidateView {
  id: string; amountCents: number | null; sourceText: string;
  state: 'preview' | 'confirm' | 'no-candidate'; reason: string;
}
export interface PassiveState {
  cursor: { x: number; y: number }; state: CursorState; monitoring: boolean;
  annotation?: { x: number; y: number; width: number; height: number };
}
export type DesktopEvent =
  | { type: 'config'; config: PublicConfig }
  | { type: 'candidate'; candidate: CandidateView }
  | { type: 'answer'; answer: Answer }
  | { type: 'error'; message: string }
  | { type: 'state'; state: CursorState }
  | { type: 'voice-toggle' }
  | { type: 'cancel' };

/** Renderer has no generic HTTP, filesystem, shell, or financial-write capability. */
export interface FlickyBridge {
  initial(): Promise<PublicConfig>;
  monitor(enabled: boolean): Promise<PublicConfig>;
  selectDisplay(id: string): Promise<PublicConfig>;
  capture(): Promise<void>;
  turn(text: string, candidateId?: string, allowStale?: boolean): Promise<Answer>;
  cancel(): Promise<void>;
  forget(): Promise<void>;
  hide(): Promise<void>;
  resize(height: number): Promise<void>;
  consent(enabled: boolean): Promise<PublicConfig>;
  transcribe(audio: Uint8Array, mimeType: string, durationMs: number): Promise<string>;
  speak(replyId: string): Promise<Uint8Array>;
  state(state: CursorState): Promise<void>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
  onPassive(listener: (state: PassiveState) => void): () => void;
}
declare global { interface Window { flicky: FlickyBridge } }
