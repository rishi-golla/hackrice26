import type { DataMode, HypotheticalPurchase, Snapshot } from '../../domain/types';
export type PurchaseRef = HypotheticalPurchase & { origin: 'screen' | 'spoken' | 'typed'; confirmed: boolean };
export type Intent =
  | { kind: 'evaluate'; purchaseIds: string[]; amountCents?: number; date?: string }
  | { kind: 'remember'; purchaseId: string }
  | { kind: 'explain' }
  | { kind: 'forget' }
  | { kind: 'clarify'; question: string }
  | { kind: 'unsupported' };
export type RouterInput = { text: string; references: PurchaseRef[]; candidates: PurchaseRef[]; lastScenario: HypotheticalPurchase[]; today: string; timezone: string };
export interface IntentRouter { mode: string; route(input: RouterInput): Promise<unknown> }
export type ConversationSession = { id: string; accountId: string; mode: DataMode; lastActivityAt: number; references: PurchaseRef[]; turns: { role: 'user' | 'assistant'; text: string }[]; lastScenario: HypotheticalPurchase[] };
export type TurnRequest = { sessionId: string; turnId: string; text: string; candidateId?: string; allowStale?: boolean };
export type TurnReply = { turnId: string; replyId: string; state: string; text: string; forecast?: import('../../domain/types').Forecast; scenario: HypotheticalPurchase[] };
export type SnapshotForRouter = Pick<Snapshot, 'today' | 'timezone'>;
