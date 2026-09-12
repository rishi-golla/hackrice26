import { resolveConversationDate } from '../../domain/date-resolver.js';
import type { IntentRouterProvider, RouterReference } from './types.js';

function readableLabel(reference: RouterReference): string {
  try {
    const parsed: unknown = JSON.parse(reference.label);
    return typeof parsed === 'string' ? parsed : reference.label;
  } catch {
    return reference.label;
  }
}

function chooseReference(utterance: string, references: RouterReference[]): RouterReference | undefined {
  const normalized = utterance.toLowerCase();
  return references.find((reference) => normalized.includes(readableLabel(reference).toLowerCase())) ??
    (references.length === 1 ? references[0] : undefined);
}

function extractDate(utterance: string, today: string | undefined): string | undefined {
  if (!today) {
    return undefined;
  }
  const match = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(utterance);
  return match ? resolveConversationDate(match[0], today) : undefined;
}

export function createDeterministicIntentProvider(): IntentRouterProvider {
  return async ({ utterance, references, today }) => {
    const normalized = utterance.trim().toLowerCase();
    const date = extractDate(normalized, today);
    if (normalized.includes('forget') || normalized.includes('clear this conversation')) {
      return { kind: 'forget' };
    }
    if (normalized === 'why' || normalized.includes('why?') || normalized.includes('explain')) {
      return { kind: 'explain' };
    }
    if (normalized.includes('remember') || normalized.includes('save')) {
      const reference = chooseReference(normalized, references);
      return reference
        ? { kind: 'remember', purchaseId: reference.id }
        : { kind: 'clarify', question: 'Which purchase should I remember?' };
    }
    if (normalized.includes('both')) {
      return references.length === 2
        ? { kind: 'evaluate', purchaseIds: references.map((reference) => reference.id), ...(date ? { date } : {}) }
        : { kind: 'clarify', question: 'Which two purchases do you mean?' };
    }
    if (date || normalized.includes('afford') || normalized.includes('buy') || normalized.includes('purchase')) {
      const reference = chooseReference(normalized, references);
      return { kind: 'evaluate', purchaseIds: reference ? [reference.id] : [], ...(date ? { date } : {}) };
    }
    return { kind: 'unsupported' };
  };
}
