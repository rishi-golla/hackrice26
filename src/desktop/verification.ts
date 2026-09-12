import { ServiceError, validatePersonaUrl, type VerificationStatus, type VerificationView } from '../shared/verification';

type Dependencies = {
  request<T>(route: string, body?: unknown): Promise<T>;
  open(url: string): Promise<void>;
  change(view: VerificationView): void;
  clear(): void;
};
export type ResumedOperation = { result: unknown; operation: string; expiresAt: number };

/** Owns only the desktop verification lifecycle; all approval decisions stay on the service. */
export class DesktopVerification {
  private view: VerificationView = { state: 'unlocked' };
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private starting = false;
  private resuming = false;
  constructor(private readonly deps: Dependencies) {}
  get blocked() { return this.view.state !== 'unlocked'; }
  private publish(view: VerificationView) { this.view = view; this.deps.change(view); }
  handle(error: unknown): boolean {
    if (!(error instanceof ServiceError) || !['verification_required', 'verification_unavailable'].includes(error.code ?? '')) return false;
    this.generation++;
    clearTimeout(this.timer);
    this.deps.clear();
    this.publish({ state: error.code === 'verification_required' ? 'locked' : 'unavailable', requestId: error.requestId });
    return true;
  }
  private assertCurrent(id: string, generation = this.generation) {
    if (this.view.requestId !== id || generation !== this.generation) throw new Error('Verification request changed.');
  }
  async start(id: string) {
    this.assertCurrent(id);
    if (this.starting) return this.view;
    this.starting = true;
    const own = this.generation;
    try {
      const response = await this.deps.request<VerificationStatus & { hostedUrl?: string }>('/verification/start', { requestId: id });
      this.assertCurrent(id, own);
      if (response.hostedUrl) await this.deps.open(validatePersonaUrl(response.hostedUrl));
      this.assertCurrent(id, own);
      const { hostedUrl: _hostedUrl, ...status } = response;
      this.publish(status);
      return this.view;
    } finally { this.starting = false; }
  }
  async status(id: string) {
    this.assertCurrent(id); const own = this.generation;
    const response = await this.deps.request<VerificationStatus>('/verification/status?requestId=' + encodeURIComponent(id));
    this.assertCurrent(id, own);
    this.publish(response);
    if (response.expiresAt) this.scheduleExpiry(response.expiresAt);
    return this.view;
  }
  private scheduleExpiry(expiresAt: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.lock('expired'); }, Math.max(0, expiresAt - Date.now()));
  }
  allow(expiresAt: number) {
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new ServiceError('Verification expired.', 'verification_required');
    this.publish({ state: 'unlocked', expiresAt });
    this.scheduleExpiry(expiresAt);
  }
  async resume(id: string): Promise<ResumedOperation> {
    this.assertCurrent(id);
    if (this.resuming) throw new Error('Already continuing.');
    this.resuming = true; const own = this.generation;
    try {
      const result = await this.deps.request<ResumedOperation>('/verification/resume', { requestId: id });
      this.assertCurrent(id, own);
      this.allow(result.expiresAt);
      return result;
    } finally { this.resuming = false; }
  }
  async cancel(id: string) {
    this.assertCurrent(id);
    // Clear synchronously so in-flight responses cannot republish private data.
    this.generation++; clearTimeout(this.timer); this.deps.clear(); this.publish({ state: 'canceled' });
    await this.deps.request('/verification/cancel', { requestId: id });
  }
  async lock(state: 'expired' | 'locked' = 'locked') {
    this.generation++; clearTimeout(this.timer); this.deps.clear(); this.publish({ state });
    await this.deps.request('/verification/lock', {}).catch(() => undefined);
  }
}
