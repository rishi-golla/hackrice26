import type { DataMode } from '../../domain/types.js';
import type {
  ConversationSession,
  ConversationTurn,
  PurchaseRef,
} from './types.js';

export const MAX_TURNS = 10;
export const MAX_REFERENCES = 10;
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;

type SessionOptions = {
  id: string;
  accountId: string;
  mode: DataMode;
  now: number;
};

export function createSession(options: SessionOptions): ConversationSession {
  return {
    id: options.id,
    accountId: options.accountId,
    mode: options.mode,
    lastActivityAt: options.now,
    references: [],
    turns: [],
    lastScenario: [],
  };
}

export function appendTurn(
  session: ConversationSession,
  turn: ConversationTurn,
  now: number,
): void {
  session.turns.push(turn);
  if (session.turns.length > MAX_TURNS) {
    session.turns.splice(0, session.turns.length - MAX_TURNS);
  }
  session.lastActivityAt = now;
}

export function rememberPurchase(
  session: ConversationSession,
  purchase: PurchaseRef,
  now: number,
): boolean {
  if (!purchase.confirmed || session.references.some((item) => item.id === purchase.id)) {
    return false;
  }

  session.references.push(purchase);
  if (session.references.length > MAX_REFERENCES) {
    session.references.splice(0, session.references.length - MAX_REFERENCES);
  }
  session.lastActivityAt = now;
  return true;
}

export function isSessionExpired(session: ConversationSession, now: number): boolean {
  return now - session.lastActivityAt >= SESSION_IDLE_TIMEOUT_MS;
}

export function clearSession(session: ConversationSession, now: number): void {
  session.references = [];
  session.turns = [];
  session.lastScenario = [];
  session.lastActivityAt = now;
}

export function switchSessionContext(
  session: ConversationSession,
  context: Pick<ConversationSession, 'accountId' | 'mode'>,
  now: number,
): void {
  const changed = session.accountId !== context.accountId || session.mode !== context.mode;
  session.accountId = context.accountId;
  session.mode = context.mode;
  if (changed) {
    clearSession(session, now);
    return;
  }
  session.lastActivityAt = now;
}
