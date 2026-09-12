export type NessieClientOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  retryCount?: number;
  fetchImpl?: typeof fetch;
};

export type NessieProviderErrorKind =
  | 'auth' | 'not-found' | 'rate-limit' | 'transient' | 'invalid-response' | 'configuration';

export class NessieProviderError extends Error {
  readonly kind: NessieProviderErrorKind;
  readonly status?: number;

  constructor(kind: NessieProviderErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'NessieProviderError';
    this.kind = kind;
    this.status = status;
  }
}

export class NessieClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NessieClientOptions) {
    if (!options.apiKey) throw new NessieProviderError('configuration', 'Nessie API key is required');
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://prod-api.nessieisreal.com';
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retryCount = options.retryCount ?? 2;
    if (!Number.isFinite(this.timeoutMs) || !Number.isInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new NessieProviderError('configuration', 'Nessie timeout must be a positive integer');
    }
    if (!Number.isFinite(this.retryCount) || !Number.isInteger(this.retryCount) || this.retryCount < 0) {
      throw new NessieProviderError('configuration', 'Nessie retry count must be a nonnegative integer');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  getCustomer(id: string) { return this.get(`/customers/${encodeURIComponent(id)}`); }
  getCustomerAccounts(id: string) { return this.get(`/customers/${encodeURIComponent(id)}/accounts`); }
  getCustomerBills(id: string) { return this.get(`/customers/${encodeURIComponent(id)}/bills`); }
  getAccount(id: string) { return this.get(`/accounts/${encodeURIComponent(id)}`); }
  getAccountBills(id: string) { return this.get(`/accounts/${encodeURIComponent(id)}/bills`); }
  getAccountDeposits(id: string) { return this.get(`/accounts/${encodeURIComponent(id)}/deposits`); }
  getAccountWithdrawals(id: string) { return this.get(`/accounts/${encodeURIComponent(id)}/withdrawals`); }
  getAccountLoans(id: string) { return this.get(`/accounts/${encodeURIComponent(id)}/loans`); }
  getMerchant(id: string) { return this.get(`/merchants/${encodeURIComponent(id)}`); }
  listAtms() { return this.get('/atms'); }
  getAtm(id: string) { return this.get(`/atms/${encodeURIComponent(id)}`); }
  listBranches() { return this.get('/branches'); }
  getBranch(id: string) { return this.get(`/branches/${encodeURIComponent(id)}`); }

  private async get(path: string): Promise<unknown> {
    const url = new URL(path, this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`);
    url.searchParams.set('key', this.apiKey);
    let lastError: NessieProviderError | undefined;
    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchImpl(url, { method: 'GET', signal: controller.signal });
        if (response.ok) {
          try { return await response.json(); }
          catch { throw new NessieProviderError('invalid-response', 'Nessie returned malformed JSON'); }
        }
        const kind: NessieProviderErrorKind = response.status === 401 || response.status === 403 ? 'auth'
          : response.status === 404 ? 'not-found' : response.status === 429 ? 'rate-limit'
          : response.status >= 500 ? 'transient' : 'invalid-response';
        lastError = new NessieProviderError(kind, `Nessie request failed (${response.status})`, response.status);
        if (kind !== 'transient' && kind !== 'rate-limit') throw lastError;
      } catch (error) {
        if (error instanceof NessieProviderError) {
          if (error.kind === 'auth' || error.kind === 'not-found' || error.kind === 'invalid-response') throw error;
          lastError = error;
        } else lastError = new NessieProviderError('transient', 'Nessie request failed');
      } finally { clearTimeout(timer); }
    }
    throw lastError ?? new NessieProviderError('transient', 'Nessie request failed');
  }
}
