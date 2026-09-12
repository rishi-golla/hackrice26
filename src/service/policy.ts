import type { CappySession } from './auth';
import { unavailableVerificationGate, VerificationError, type VerificationGate, type VerificationScope } from './verification';

export type CappyToolPolicy = { readOnly: true; requiresSession: true; accountScoped: true };
export function assertAccountAccess(session: CappySession, accountId: string) {
  if (session.accountId !== accountId) throw Object.assign(new Error('Unknown account'), { statusCode: 403 });
  return accountId;
}

export function requireVerification(
  session: CappySession,
  accountId: string,
  scope: VerificationScope,
  gate: VerificationGate = unavailableVerificationGate,
) {
  const scopedAccountId = assertAccountAccess(session, accountId);
  if (!gate.isConfigured()) {
    throw new VerificationError('verification_unavailable', 'Identity verification is unavailable.');
  }
  if (!gate.isApproved(session, scopedAccountId, scope)) {
    throw new VerificationError('verification_required', 'Identity verification is required.');
  }
  return scopedAccountId;
}

export const readOnlyAccountPolicy: CappyToolPolicy = { readOnly: true, requiresSession: true, accountScoped: true };
