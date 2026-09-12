import { describe, expect, it } from 'vitest';
import { assertAccountAccess, readOnlyAccountPolicy, requireVerification } from '../../src/service/policy';

const session = { id: 's', userId: 'u', accountId: 'a', issuedAt: '', expiresAt: '' };

describe('Cappy policy', () => {
  it('allows only the authenticated account', () => {
    expect(assertAccountAccess(session, 'a')).toBe('a');
    expect(() => assertAccountAccess(session, 'b')).toThrow(/account/i);
  });
  it('is explicitly read-only and session/account scoped', () => { expect(readOnlyAccountPolicy).toEqual({ readOnly: true, requiresSession: true, accountScoped: true }); });
  it('fails closed when verification is unavailable or not approved', () => {
    expect(() => requireVerification(session, 'a', 'account-sensitive-read')).toThrowError(expect.objectContaining({ code: 'verification_unavailable', statusCode: 503 }));
    const unavailable = { isConfigured: () => true, isApproved: () => false };
    expect(() => requireVerification(session, 'a', 'account-sensitive-read', unavailable)).toThrowError(expect.objectContaining({ code: 'verification_required', statusCode: 403 }));
  });
  it('checks the authenticated account before the verification gate', () => {
    const gate = { isConfigured: () => true, isApproved: () => true };
    expect(() => requireVerification(session, 'b', 'account-sensitive-read', gate)).toThrow(/account/i);
  });
});
