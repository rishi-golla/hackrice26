import type { PurchaseCandidate } from './ocr/extract';

export type PurchaseRef = {
  id: string;
  cents: number;
  label: string;
  origin: 'screen';
  date?: string;
};

export type CandidateEvent = {
  id: string;
  candidate: PurchaseCandidate;
};

export type CandidateListener = (event: CandidateEvent) => void;

export type CandidateRegistry = {
  registerCandidate(candidate: PurchaseCandidate): string;
  confirmCandidate(id: string): PurchaseRef;
  onCandidate(listener: CandidateListener): () => void;
};

/** In-memory handoff boundary; confirmed references never imply execution. */
export function createCandidateRegistry(): CandidateRegistry {
  const candidates = new Map<string, PurchaseCandidate>();
  const confirmed = new Map<string, PurchaseRef>();
  const listeners = new Set<CandidateListener>();
  let nextId = 1;

  return {
    registerCandidate(candidate): string {
      if (candidate.state === 'no-candidate' || candidate.amountCents === null) {
        throw new Error('Only reviewable purchase candidates can be registered');
      }

      const id = `candidate-${nextId}`;
      nextId += 1;
      candidates.set(id, candidate);
      const event = { id, candidate };
      for (const listener of listeners) listener(event);
      return id;
    },

    confirmCandidate(id): PurchaseRef {
      const candidate = candidates.get(id);
      if (!candidate || candidate.amountCents === null) {
        throw new Error(`Unknown purchase candidate: ${id}`);
      }
      const existing = confirmed.get(id);
      if (existing) return existing;

      const reference: PurchaseRef = {
        id,
        cents: candidate.amountCents,
        label: 'Unlabeled screen purchase',
        origin: 'screen',
      };
      confirmed.set(id, reference);
      return reference;
    },

    onCandidate(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
