import type { CappyProfile } from '../shared/contracts';

export type { CappyProfile };
export const defaultProfile: CappyProfile = { reserveCents: 10_000, riskStyle: 'calm', language: 'en-US', monitoringEnabled: false };
const styles = new Set<CappyProfile['riskStyle']>(['calm', 'direct', 'detailed']);
export function validateProfile(value: unknown): CappyProfile {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid profile');
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.reserveCents) || (input.reserveCents as number) < 0) throw new TypeError('reserveCents must be a non-negative integer');
  if (!styles.has(input.riskStyle as CappyProfile['riskStyle']) || input.language !== 'en-US' || typeof input.monitoringEnabled !== 'boolean') throw new TypeError('Invalid profile');
  return { reserveCents: input.reserveCents as number, riskStyle: input.riskStyle as CappyProfile['riskStyle'], language: 'en-US', monitoringEnabled: input.monitoringEnabled };
}
export class ProfileStore {
  private readonly profiles = new Map<string, CappyProfile>();
  get(userId: string, accountId: string) { return structuredClone(this.profiles.get(`${userId}:${accountId}`) ?? defaultProfile); }
  update(userId: string, accountId: string, value: unknown) { const profile = validateProfile(value); this.profiles.set(`${userId}:${accountId}`, profile); return structuredClone(profile); }
}
