import type { CappySession } from './auth';

export type CappyToolPolicy = { readOnly: true; requiresSession: true; accountScoped: true };
export function assertAccountAccess(session: CappySession, accountId: string) {
  if (session.accountId !== accountId) throw Object.assign(new Error('Unknown account'), { statusCode: 403 });
  return accountId;
}
export const readOnlyAccountPolicy: CappyToolPolicy = { readOnly: true, requiresSession: true, accountScoped: true };
