import type { PurchaseRef } from './types.js';

export type CandidateInput = {
  id: string;
  label: string;
  cents: number;
  date: string;
  capturedAt: number;
  coordinateExpiresAt: number;
};

type CandidateRecord = {
  accountId: string;
  candidate: CandidateInput;
  reference: PurchaseRef;
};

export class CandidateRegistry {
  private readonly records = new Map<string, CandidateRecord>();

  public registerCandidate(accountId: string, candidate: CandidateInput): string {
    if (!accountId || !candidate.id || !candidate.label || !Number.isSafeInteger(candidate.cents)) {
      throw new Error('Candidate requires an account, label, ID, and safe integer cents.');
    }
    this.records.set(candidate.id, {
      accountId,
      candidate: { ...candidate },
      reference: {
        id: candidate.id,
        label: candidate.label,
        cents: candidate.cents,
        date: candidate.date,
        origin: 'screen',
        confirmed: false,
      },
    });
    return candidate.id;
  }

  public getFreshCandidate(
    accountId: string,
    candidateId: string,
    now: number,
  ): PurchaseRef | undefined {
    const record = this.records.get(candidateId);
    if (!record || record.accountId !== accountId || now >= record.candidate.coordinateExpiresAt) {
      return undefined;
    }
    return { ...record.reference };
  }

  public confirmCandidate(
    accountId: string,
    candidateId: string,
    now: number,
  ): PurchaseRef | undefined {
    const record = this.records.get(candidateId);
    if (!record || record.accountId !== accountId) {
      return undefined;
    }
    if (!record.reference.confirmed && !this.getFreshCandidate(accountId, candidateId, now)) {
      return undefined;
    }
    record.reference.confirmed = true;
    return { ...record.reference };
  }

  public getConfirmedReference(
    accountId: string,
    candidateId: string,
    _now: number,
  ): PurchaseRef | undefined {
    const record = this.records.get(candidateId);
    if (!record || record.accountId !== accountId || !record.reference.confirmed) {
      return undefined;
    }
    return { ...record.reference };
  }

  public clearAccount(accountId: string): void {
    for (const [id, record] of this.records) {
      if (record.accountId === accountId) {
        this.records.delete(id);
      }
    }
  }
}
