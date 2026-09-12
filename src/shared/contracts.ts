import type { Forecast, DataMode } from '../domain/types';

export type CursorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';
export interface DisplayChoice { id: string; label: string }
export interface Capabilities { router: boolean; transcription: boolean; speech: boolean; financialActions: false; convai: boolean }
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

export type ProductSearchResult = {
  results: Array<{ title: string; price: string; url: string; source: string; rating?: number }>;
  searchUrls: Record<string, string>;
  query?: string;
  note?: string;
};

/** Context about what the user is currently viewing in their browser / on screen. */
export interface BrowserContext {
  browserUrl?: string;
  pageTitle?: string;
  ocrText?: string;
  /** Candidate purchase amount in cents detected via OCR, if any. */
  candidateCents?: number;
}

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
  /**
   * Get a short-lived ElevenLabs Conversational AI signed URL.
   * The server injects live financial data + screen context into the agent session.
   * The API key never reaches the renderer.
   */
  getConvaiToken(context: BrowserContext): Promise<string>;
  openScreenPermissions(): Promise<void>;
  getScreenText(): Promise<string>;
  openUrl(url: string): Promise<void>;
  searchProducts(q: string): Promise<ProductSearchResult>;
  /**
   * Execute a registered financial tool (read-only) on behalf of the ConvAI agent.
   * Authenticated via the active session; account-scoped per policy.
   */
  executeTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  onEvent(listener: (event: DesktopEvent) => void): () => void;
  onPassive(listener: (state: PassiveState) => void): () => void;
}
declare global { interface Window { flicky: FlickyBridge } }
