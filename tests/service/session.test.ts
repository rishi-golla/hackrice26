import { describe, expect, it } from 'vitest';
import type { PurchaseRef } from '../../src/service/conversation/types.js';
import {
  appendTurn,
  clearSession,
  createSession,
  isSessionExpired,
  rememberPurchase,
  switchSessionContext,
} from '../../src/service/conversation/session.js';

const purchase = (id: string, confirmed = true): PurchaseRef => ({
  id,
  label: id,
  cents: 2_000,
  date: '2026-09-12',
  origin: 'typed',
  confirmed,
});

describe('conversation session', () => {
  it('stores no more than ten individual user or assistant turns', () => {
    const session = createSession({
      id: 'session-1',
      accountId: 'checking',
      mode: 'synthetic',
      now: 1_000,
    });

    for (let index = 0; index < 11; index += 1) {
      appendTurn(session, { role: 'user', text: `turn-${index}` }, 1_000 + index);
    }

    expect(session.turns).toHaveLength(10);
    expect(session.turns[0]?.text).toBe('turn-1');
    expect(session.turns.at(-1)?.text).toBe('turn-10');
  });

  it('keeps at most ten confirmed purchase references and refuses unconfirmed ones', () => {
    const session = createSession({
      id: 'session-1',
      accountId: 'checking',
      mode: 'synthetic',
      now: 1_000,
    });

    expect(rememberPurchase(session, purchase('unconfirmed', false), 1_001)).toBe(false);

    for (let index = 0; index < 11; index += 1) {
      expect(rememberPurchase(session, purchase(`purchase-${index}`), 1_002 + index)).toBe(true);
    }

    expect(session.references).toHaveLength(10);
    expect(session.references[0]?.id).toBe('purchase-1');
    expect(session.references.at(-1)?.id).toBe('purchase-10');
  });

  it('clears turns and references when the account or data mode changes', () => {
    const session = createSession({
      id: 'session-1',
      accountId: 'checking',
      mode: 'synthetic',
      now: 1_000,
    });
    appendTurn(session, { role: 'user', text: 'hello' }, 1_001);
    rememberPurchase(session, purchase('tickets'), 1_002);

    switchSessionContext(session, { accountId: 'savings', mode: 'recorded-sandbox' }, 1_003);

    expect(session.accountId).toBe('savings');
    expect(session.mode).toBe('recorded-sandbox');
    expect(session.turns).toEqual([]);
    expect(session.references).toEqual([]);
    expect(session.lastScenario).toEqual([]);
  });

  it('clears all conversational state explicitly', () => {
    const session = createSession({
      id: 'session-1',
      accountId: 'checking',
      mode: 'synthetic',
      now: 1_000,
    });
    appendTurn(session, { role: 'user', text: 'hello' }, 1_001);
    rememberPurchase(session, purchase('tickets'), 1_002);

    clearSession(session, 1_003);

    expect(session.turns).toEqual([]);
    expect(session.references).toEqual([]);
    expect(session.lastScenario).toEqual([]);
    expect(session.lastActivityAt).toBe(1_003);
  });

  it('expires after thirty minutes of inactivity but not before', () => {
    const session = createSession({
      id: 'session-1',
      accountId: 'checking',
      mode: 'synthetic',
      now: 1_000,
    });

    expect(isSessionExpired(session, 1_000 + 30 * 60 * 1_000 - 1)).toBe(false);
    expect(isSessionExpired(session, 1_000 + 30 * 60 * 1_000)).toBe(true);
  });
});
