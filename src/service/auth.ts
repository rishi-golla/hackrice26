import { timingSafeEqual } from 'node:crypto';

import { createSessionStore } from './session';

export type CappyUser = { id: string; displayName: string; accountIds: string[] };
export type CappySession = { id: string; userId: string; accountId: string; issuedAt: string; expiresAt: string };
export interface CappyAuthProvider {
  login(email: string, password: string): Promise<CappySession>;
  logout(sessionId: string): Promise<void>;
  validate(sessionId: string): Promise<CappySession>;
}
export interface CappySessionStore {
  create(userId: string, accountId: string): CappySession;
  revoke(sessionId: string): void;
  get(sessionId: string): CappySession | undefined;
}

const demoUser: CappyUser = { id: 'demo-user', displayName: 'Demo Customer', accountIds: ['demo-checking'] };
function sameSecret(actual: string, expected: string) {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export class InMemoryCappyAuthProvider implements CappyAuthProvider {
  readonly user: CappyUser;
  private readonly sessions: CappySessionStore;
  // accountId defaults to the synthetic fixture's id for backward compatibility;
  // entry.ts passes the actually-configured account (which may be a live
  // Nessie account id) so a live-mode session isn't bound to a demo account
  // it can't access.
  constructor(sessions: CappySessionStore = createSessionStore(), accountId: string = demoUser.accountIds[0]) {
    this.sessions = sessions;
    this.user = { ...demoUser, accountIds: [accountId] };
  }
  async login(email: string, password: string) {
    // Credential comparison stays here; callers never receive or log the password.
    if (!sameSecret(email, 'demo@example.com') || !sameSecret(password, 'demo-password')) throw Object.assign(new Error('Invalid credentials'), { statusCode: 401 });
    return this.sessions.create(this.user.id, this.user.accountIds[0]);
  }
  async logout(sessionId: string) { this.sessions.revoke(sessionId); }
  async validate(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== this.user.id || !this.user.accountIds.includes(session.accountId)) throw Object.assign(new Error('Unknown session'), { statusCode: 401 });
    return session;
  }
}

export function createDemoAuthProvider(sessions?: CappySessionStore, accountId?: string) { return new InMemoryCappyAuthProvider(sessions, accountId); }
