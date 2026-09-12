export type VerificationState = 'locked' | 'pending' | 'approved' | 'declined' | 'expired' | 'unavailable' | 'retry' | 'canceled';
export type VerificationStatus = { requestId: string; state: VerificationState; expiresAt?: number; pollAfterMs?: number };
export type VerificationView = Omit<VerificationStatus, 'requestId' | 'state'> & { requestId?: string; state: VerificationState | 'unlocked' };
export class ServiceError extends Error {
  constructor(message: string, readonly code?: string, readonly requestId?: string, readonly status?: number) {
    super(message); this.name = 'ServiceError';
  }
}
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string; requestId?: string; status?: number } };

/** Only the documented Hosted Flow origin and inquiry-specific path may leave the app. */
export function validatePersonaUrl(value: string): string {
  const url = new URL(value);
  if (url.origin !== 'https://inquiry.withpersona.com' || url.username || url.password || url.pathname !== '/verify' || url.hash ||
    !/^inq_[A-Za-z0-9]+$/.test(url.searchParams.get('inquiry-id') ?? '') ||
    [...url.searchParams.keys()].some(key => key !== 'inquiry-id') || url.searchParams.getAll('inquiry-id').length !== 1) {
    throw new Error('Invalid identity verification link.');
  }
  return url.href;
}
