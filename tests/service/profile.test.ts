import { describe, expect, it } from 'vitest';
import { ProfileStore, validateProfile } from '../../src/service/profile';

describe('Cappy profiles', () => {
  it('scopes profiles by user and account', () => {
    const store = new ProfileStore();
    store.update('u', 'a', { reserveCents: 2500, riskStyle: 'detailed', language: 'en-US', monitoringEnabled: true });
    expect(store.get('u', 'a').reserveCents).toBe(2500);
    expect(store.get('u', 'b').reserveCents).toBe(10000);
  });
  it('rejects malformed or out of bounds profile values', () => {
    expect(() => validateProfile({ reserveCents: 1.5, riskStyle: 'calm', language: 'en-US', monitoringEnabled: false })).toThrow();
    expect(() => validateProfile({ reserveCents: 1, riskStyle: 'wild', language: 'en-US', monitoringEnabled: false })).toThrow();
  });
});
