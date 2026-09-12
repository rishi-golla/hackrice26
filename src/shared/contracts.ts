import type { Forecast, DataMode } from '../domain/types';

export type CursorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';
export interface DisplayChoice { id: string; label: string }
export interface Capabilities { router: boolean; transcription: boolean; speech: boolean; financialActions: false }
export interface PublicConfig {
  mode: DataMode; accountId: string; displays: DisplayChoice[]; displayId: string;
  monitoring: boolean; microphoneConsent: boolean; capabilities: Capabilities;
  shortcut: string; shortcutAvailable: boolean; permission: string;
}
export type CappyProfile = { reserveCents: number; riskStyle: 'calm' | 'direct' | 'detailed'; language: 'en-US'; monitoringEnabled: boolean };
export type CappySession = { id: string; userId: string; accountId: string; issuedAt: string; expiresAt: string };

export type UpcomingBillView = { id: string; label: string; date: string; cents: number; recurring: boolean };
export type ExpectedIncomeView = { id: string; label: string; date: string; cents: number };
export type FinancialInsightsView = {
  balanceCents: number;
  safeToSpendCents: number;
  upcomingBills: UpcomingBillView[];
  expectedIncome: ExpectedIncomeView[];
  recurringOutflowCents: number;
  loanObligationsCents: number;
  rewardsPoints: number | null;
  recentDepositsCents: number;
  recentWithdrawalsCents: number;
  coverage: { mode: string; complete: boolean; stale: boolean; sources: string[] };
  highlights: string[];
  account: { type?: string; nickname?: string; last4?: string };
};

export interface Answer {
  turnId: string; replyId: string; state: string; text: string;
  forecast?: Forecast; scenario?: unknown;
  insights?: FinancialInsightsView;
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
  | { type: 'voice-start' }
  | { type: 'voice-stop' }
  | { type: 'voice-toggle' }
  | { type: 'cancel' };

/** Renderer has no generic HTTP, filesystem, shell, or financial-write capability. */
export interface FlickyBridge {
  login(email: string, password: string): Promise<CappySession>;
  logout(): Promise<void>;
  getSession(): Promise<CappySession>;
  getProfile(): Promise<CappyProfile>;
  updateProfile(profile: CappyProfile): Promise<CappyProfile>;
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
