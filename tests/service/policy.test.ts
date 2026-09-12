import { describe, expect, it } from 'vitest';
import { assertAccountAccess, readOnlyAccountPolicy } from '../../src/service/policy';

describe('Cappy policy', () => {
  it('allows only the authenticated account', () => {
    const session = { id: 's', userId: 'u', accountId: 'a', issuedAt: '', expiresAt: '' };
    expect(assertAccountAccess(session, 'a')).toBe('a');
    expect(() => assertAccountAccess(session, 'b')).toThrow(/account/i);
  });
  it('is explicitly read-only and session/account scoped', () => { expect(readOnlyAccountPolicy).toEqual({ readOnly: true, requiresSession: true, accountScoped: true }); });
});
