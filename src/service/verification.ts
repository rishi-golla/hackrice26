import type { CappySession } from './auth';

export type VerificationScope = 'account-sensitive-read';
export type VerificationCode = 'verification_required' | 'verification_unavailable';

export interface VerificationGate {
  isConfigured(): boolean;
  isApproved(session: CappySession, accountId: string, scope: VerificationScope): boolean;
}

export class VerificationError extends Error {
  readonly statusCode: number;

  constructor(readonly code: VerificationCode, message: string) {
    super(message);
    this.name = 'VerificationError';
    this.statusCode = code === 'verification_required' ? 403 : 503;
  }
}

// Until Task 2 supplies the Persona-backed implementation, protected data is unavailable.
export const unavailableVerificationGate: VerificationGate = {
  isConfigured: () => false,
  isApproved: () => false,
};
