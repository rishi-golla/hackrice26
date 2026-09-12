import { randomUUID } from 'node:crypto';
import { evaluateScenario } from '../../domain/scenario';
import { explain } from '../../domain/explain';
import type { DataMode, HypotheticalPurchase, Snapshot } from '../../domain/types';
import { deterministicRouter, ValidatedIntentRouter } from './router';
import type { ConversationSession, IntentRouter, PurchaseRef, TurnReply, TurnRequest } from './types';
export type ConversationManager = ReturnType<typeof createConversationManager>;
export function createConversationManager(options: { router?: IntentRouter; reserveCents?: number; now?: () => number; id?: () => string } = {}) {
  const sessions = new Map<string, ConversationSession>(); const replies = new Map<string, Map<string, TurnReply>>(); const candidates = new Map<string, Map<string, PurchaseRef>>(); const canceled = new Map<string, number>();
  const now = options.now ?? Date.now; const id = options.id ?? randomUUID; const router = new ValidatedIntentRouter(options.router ?? deterministicRouter); const reserve = options.reserveCents ?? 10_000;
  const clear = (session: ConversationSession) => { session.references = []; session.turns = []; session.lastScenario = []; };
  const clarifying = (request: TurnRequest, text: string): TurnReply => ({ turnId: request.turnId, replyId: id(), state: 'clarifying', text, scenario: [] });
  async function turn(request: TurnRequest, snapshot: Snapshot): Promise<TurnReply> {
    const session = sessions.get(request.sessionId); if (!session) throw new Error('Unknown session');
    const started = canceled.get(session.id) ?? 0; const timestamp = now();
    if (timestamp - session.lastActivityAt > 30 * 60 * 1000) clear(session);
    session.lastActivityAt = timestamp;
    if (session.accountId !== snapshot.accountId || session.mode !== snapshot.mode) { session.accountId = snapshot.accountId; session.mode = snapshot.mode; clear(session); return save(session, clarifying(request, 'Account or data mode changed. Which purchase should I evaluate?')); }
    const map = candidates.get(session.id)!; const selected = request.candidateId ? map.get(request.candidateId) : undefined;
    const input = { text: request.text, references: session.references, candidates: selected ? [selected] : [], lastScenario: session.lastScenario, today: snapshot.today, timezone: snapshot.timezone };
    const intent = await router.route(input); if ((canceled.get(session.id) ?? 0) !== started) throw new Error('TURN_CANCELLED');
    let reply: TurnReply;
    if (snapshot.stale && !request.allowStale && intent.kind === 'evaluate') reply = clarifying(request, `Data snapshot is stale as of ${snapshot.asOf}. Say “use stale estimate” to continue.`);
    else if (intent.kind === 'forget') { clear(session); reply = { ...clarifying(request, 'Conversation memory cleared.'), state: 'idle' }; }
    else if (intent.kind === 'explain') reply = session.lastScenario.length ? grounded(request, session.lastScenario, evaluateScenario(snapshot, session.lastScenario, reserve), true, snapshot) : clarifying(request, 'I have no recent forecast to explain.');
    else if (intent.kind === 'remember') {
      const candidate = map.get(intent.purchaseId); if (!candidate || !candidate.confirmed) reply = clarifying(request, 'Confirm amount before I remember this purchase.'); else { session.references = [...session.references.filter(ref => ref.id !== candidate.id), candidate].slice(-10); reply = { ...clarifying(request, `${candidate.label} saved for this conversation.`), state: 'idle' }; }
    } else if (intent.kind === 'evaluate') {
      let scenario: HypotheticalPurchase[] = [];
      if (selected && (!intent.purchaseIds.length || intent.purchaseIds.includes(selected.id))) { scenario = [{ id: selected.id, label: selected.label, cents: intent.amountCents ?? selected.cents, date: intent.date ?? selected.date }]; if (selected.confirmed) session.references = [...session.references.filter(ref => ref.id !== selected.id), { ...selected, cents: intent.amountCents ?? selected.cents, date: intent.date ?? selected.date }].slice(-10); }
      else if (intent.purchaseIds.length) {
        const source = session.references.length ? session.references : session.lastScenario;
        if (intent.purchaseIds.length > 2) reply = clarifying(request, '“Both” is ambiguous with more than two saved purchases. Name the two you want.');
        else if (intent.purchaseIds.length !== 2 && intent.purchaseIds.some(candidateId => !source.some(ref => ref.id === candidateId))) reply = clarifying(request, 'Which saved purchase should I use?');
        else if (intent.purchaseIds.length !== 2 && source.length) { const latest = session.lastScenario.length ? session.lastScenario : source; scenario = latest.filter(ref => intent.purchaseIds.includes(ref.id)).map(ref => ({ id: ref.id, label: ref.label, cents: intent.amountCents ?? ref.cents, date: intent.date ?? ref.date })); }
        else if (intent.purchaseIds.length === 2 && intent.purchaseIds.some(candidateId => !session.references.some(ref => ref.id === candidateId))) reply = clarifying(request, 'Which two saved purchases should I combine?');
        else scenario = session.references.filter(ref => intent.purchaseIds.includes(ref.id)).map(ref => ({ id: ref.id, label: ref.label, cents: ref.cents, date: intent.date ?? ref.date }));
      }
      else if (intent.amountCents !== undefined) scenario = [{ id: id(), label: 'Typed purchase', cents: intent.amountCents, date: intent.date ?? snapshot.today }];
      else if (session.lastScenario.length) scenario = session.lastScenario.map(item => ({ ...item, cents: intent.amountCents ?? item.cents, date: intent.date ?? item.date }));
      else { reply = clarifying(request, 'What purchase should I evaluate? Give amount or select a checkout.'); }
      if (!reply!) { const result = evaluateScenario(snapshot, scenario, reserve); session.lastScenario = scenario; reply = grounded(request, scenario, result, false, snapshot); }
    } else reply = { ...clarifying(request, 'I can evaluate purchase cash flow, explain a forecast, or remember a confirmed purchase.'), state: 'error' };
    session.turns = [...session.turns, { role: 'user' as const, text: request.text }, { role: 'assistant' as const, text: reply.text }].slice(-10); return save(session, reply);
  }
  function grounded(request: TurnRequest, scenario: HypotheticalPurchase[], result: ReturnType<typeof evaluateScenario>, explanation: boolean, source: Snapshot): TurnReply { const headline = explanation ? explain(result) : result.status === 'negative' ? `No. ${result.minimumDate} reaches ${money(result.minimumCents)}.` : `Yes, projected low is ${money(result.minimumCents)} on ${result.minimumDate}.`; const qualifier = result.stale ? ` Data is stale as of ${source.asOf}.` : ''; return { turnId: request.turnId, replyId: id(), state: 'idle', text: `${headline}${qualifier} ${result.reasons[0] ?? ''}`.trim(), forecast: result, scenario }; }
  function save(session: ConversationSession, reply: TurnReply) { const own = replies.get(session.id) ?? new Map<string, TurnReply>(); own.set(reply.replyId, reply); replies.set(session.id, own); return reply; }
  return { createSession(accountId: string, mode: DataMode) { const session = { id: id(), accountId, mode, lastActivityAt: now(), references: [], turns: [], lastScenario: [] } as ConversationSession; sessions.set(session.id, session); candidates.set(session.id, new Map()); replies.set(session.id, new Map()); return session; }, registerCandidate(sessionId: string, purchase: PurchaseRef) { if (!sessions.has(sessionId)) throw new Error('Unknown session'); candidates.get(sessionId)!.set(purchase.id, purchase); }, getSession(sessionId: string) { return sessions.get(sessionId); }, turn, cancel(sessionId: string) { canceled.set(sessionId, (canceled.get(sessionId) ?? 0) + 1); }, forget(sessionId: string) { const session = sessions.get(sessionId); if (session) clear(session); }, getReply(sessionId: string, replyId: string) { return replies.get(sessionId)?.get(replyId); } };
}
function money(cents: number) { return `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`; }
