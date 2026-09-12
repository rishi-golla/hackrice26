import type { DataMode, Forecast } from '../../domain/types.js';

export type HypotheticalPurchase = {
  id: string;
  label: string;
  cents: number;
  date: string;
};

export type PurchaseRef = HypotheticalPurchase & {
  origin: 'screen' | 'spoken' | 'typed';
  confirmed: boolean;
};

export type ConversationTurn = {
  role: 'user' | 'assistant';
  text: string;
};

export type ConversationSession = {
  id: string;
  accountId: string;
  mode: DataMode;
  lastActivityAt: number;
  references: PurchaseRef[];
  turns: ConversationTurn[];
  lastScenario: HypotheticalPurchase[];
};

export type CursorState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'clarifying' | 'error';

export type TurnRequest = {
  sessionId: string;
  turnId: string;
  text: string;
  candidateId?: string;
};

export type TurnReply = {
  turnId: string;
  replyId: string;
  state: CursorState;
  text: string;
  forecast?: Forecast;
  scenario: HypotheticalPurchase[];
};

export type Intent =
  | { kind: 'evaluate'; purchaseIds: string[]; amountCents?: number; date?: string }
  | { kind: 'remember'; purchaseId: string }
  | { kind: 'explain' }
  | { kind: 'forget' }
  | { kind: 'clarify'; question: string }
  | { kind: 'unsupported' };

export type RouterReference = {
  id: string;
  label: string;
  cents: number;
  date: string;
  origin: PurchaseRef['origin'];
};

export type IntentRouterRequest = {
  utterance: string;
  references: RouterReference[];
  allowedIntents: readonly Intent['kind'][];
};

export type IntentRouterProvider = (
  request: IntentRouterRequest,
) => Promise<unknown>;

export type SessionClock = {
  now(): number;
};
