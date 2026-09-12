# Nessie Live Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Connect Cappy’s authenticated service to read-only Capital One Nessie data and turn mapped customer records into validated snapshots, deterministic insights, forecasts, and grounded tools.

**Architecture:** A typed `NessieClient` owns HTTP, timeout, retries, redaction, and response validation. A `NessieSnapshotProvider` maps one Cappy account to one configured Nessie customer, normalizes account resources into the existing cents/date/event model, and preserves completeness and freshness. A pure insight module consumes the normalized snapshot; existing forecast and policy layers remain the owners of arithmetic and access control.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, native `fetch`, existing `SnapshotStore`, existing deterministic forecast/tool registry.

**Spec:** `docs/superpowers/specs/2026-09-12-nessie-live-insights-design.md`

## Global Constraints

- Nessie access is read-only; no POST, PUT, or DELETE operation is added.
- `NESSIE_API_KEY` is server-only and never appears in source, logs, responses, model input, or fixtures.
- Live mode requires `NESSIE_CUSTOMER_ID` and explicit `NESSIE_AMOUNT_UNIT=dollars|cents`.
- Account access remains enforced by the existing authenticated session and `assertAccountAccess` policy.
- Raw addresses and full account numbers never enter model prompts; account numbers are reduced to last four digits.
- Live failures never silently switch to synthetic data; stale cache is labeled.
- Every production function is introduced through a failing test first.

---

### Task 1: Add a typed, redacted Nessie read client

**Files:**
- Create: `src/service/providers/nessie.ts`
- Create: `tests/service/nessie-client.test.ts`
- Modify: `src/service/providers/nessie.ts` only after the failing tests exist

**Interfaces:**
- `NessieClientOptions = { apiKey: string; baseUrl?: string; timeoutMs?: number; retryCount?: number; fetchImpl?: typeof fetch }`
- `NessieClient` methods: `getCustomer(id: string)`, `getCustomerAccounts(id: string)`, `getCustomerBills(id: string)`, `getAccount(id: string)`, `getAccountBills(id: string)`, `getAccountDeposits(id: string)`, `getAccountWithdrawals(id: string)`, `getAccountLoans(id: string)`, `getMerchant(id: string)`, `listAtms()`, `getAtm(id: string)`, `listBranches()`, `getBranch(id: string)`.
- `NessieProviderError` exposes `kind: 'auth'|'not-found'|'rate-limit'|'transient'|'invalid-response'|'configuration'`, `status?: number`, and a redacted message.

- [ ] **Step 1: Write failing client tests.** Cover URL construction with `key` added only by the client, authorization failure mapping for 401/403, 404 mapping, retrying one 503 then succeeding, timeout abort, malformed JSON rejection, and the rule that thrown messages never contain the API key.
- [ ] **Step 2: Run the focused tests.** Run `npm test -- tests/service/nessie-client.test.ts`; confirm failure because the client and error type do not exist.
- [ ] **Step 3: Implement the minimal client.** Use `URL` for query/path construction, `AbortController` for deadlines, bounded retries for 429/5xx/network failures, no retries for 400/401/403/404, and parse only JSON object/array responses. Keep the key in the request URL in memory only; never log the URL.
- [ ] **Step 4: Run focused tests again.** Confirm all client behaviors pass and the existing suite remains green.
- [ ] **Step 5: Refactor only after green.** Extract shared request/error code if it reduces duplication without adding unsupported endpoint abstractions.

### Task 2: Normalize Nessie records into the existing snapshot contract

**Files:**
- Create: `src/service/providers/nessie-normalize.ts`
- Create: `tests/service/nessie-normalize.test.ts`
- Modify: `src/domain/types.ts` only if a validated provenance field is required by the existing contract

**Interfaces:**
- `NessieAmountUnit = 'dollars' | 'cents'`
- `NessieNormalizeOptions = { amountUnit: NessieAmountUnit; today: string; timezone: string; now?: () => string }`
- `normalizeNessieSnapshot(input: { accountId: string; account: NessieAccount; bills: NessieBill[]; deposits: NessieDeposit[]; withdrawals: NessieWithdrawal[]; loans: NessieLoan[]; complete: boolean; sourceEndpoints: string[] }, options: NessieNormalizeOptions): Snapshot`
- `toCents(value: number, unit: NessieAmountUnit): number`

- [ ] **Step 1: Write failing normalization tests.** Assert dollar and cent conversion, fractional-dollar rounding rejection when unsafe, account balance normalization, signed deposit/withdrawal/bill/loan events, recurring-bill metadata, cancelled/pending status handling, invalid dates, unsafe values, and last-four redaction.
- [ ] **Step 2: Run the tests and verify expected red failures.** Run `npm test -- tests/service/nessie-normalize.test.ts`.
- [ ] **Step 3: Implement schemas and normalization.** Validate external values with Zod, convert only finite safe numbers, reject ambiguous units, map dates to ISO dates, mark scheduled bill/loan events conservatively, and set `mode: 'live-sandbox'`, `stale: false`, `complete` from the provider aggregation.
- [ ] **Step 4: Run focused tests and the domain suite.** Run `npm test -- tests/service/nessie-normalize.test.ts tests/domain/forecast.test.ts`; confirm all pass.
- [ ] **Step 5: Refactor after green.** Keep endpoint parsing separate from domain event mapping so future Nessie schema changes remain localized.

### Task 3: Build the live snapshot provider and live-mode configuration

**Files:**
- Create: `src/service/providers/nessie-snapshot.ts`
- Create: `tests/service/nessie-snapshot.test.ts`
- Modify: `src/service/entry.ts`
- Modify: `src/service/snapshot.ts` only if provider cache options need an explicit configured TTL
- Modify: `.env.example` only if the user restores it; do not recreate the currently deleted file without checking the working-tree decision

**Interfaces:**
- `NessieSnapshotProviderOptions = { client: NessieClient; customerId: string; amountUnit: NessieAmountUnit; timezone: string; today?: () => string; now?: () => string }`
- `createNessieSnapshotProvider(options): SnapshotProvider`
- `createNessieFromEnv(): { provider: SnapshotProvider; accountIds: string[]; customerId: string }`

- [ ] **Step 1: Write failing provider tests.** Use a fake client returning sanitized customer/account/bill/deposit/withdrawal/loan records. Assert account selection, parallel resource reads, complete=true when all reads succeed, complete=false with retained partial events when an optional resource fails, account mismatch rejection, and no synthetic fallback.
- [ ] **Step 2: Run the provider tests and confirm red failure.** Run `npm test -- tests/service/nessie-snapshot.test.ts`.
- [ ] **Step 3: Implement the provider.** Fetch the mapped customer’s accounts, select the configured account through the existing Cappy account ID mapping, fetch bills/deposits/withdrawals/loans, collect source endpoint names, and pass the result to `normalizeNessieSnapshot`. Do not call enterprise or write routes.
- [ ] **Step 4: Add env validation in `entry.ts`.** Accept `FLICKY_DATA_MODE=live-sandbox` only when `NESSIE_API_KEY`, `NESSIE_CUSTOMER_ID`, and `NESSIE_AMOUNT_UNIT` are present and valid. Build the live provider and its mapped account ID; retain synthetic and recorded startup behavior unchanged.
- [ ] **Step 5: Run focused startup/provider tests.** Run `npm test -- tests/service/nessie-snapshot.test.ts tests/service/snapshot.test.ts` and `npm run typecheck`.
- [ ] **Step 6: Refactor only after green.** Keep environment parsing separate from HTTP construction so tests can inject a fake client.

### Task 4: Add deterministic personalized insights

**Files:**
- Create: `src/domain/insights.ts`
- Create: `tests/domain/insights.test.ts`
- Modify: `src/domain/types.ts` only when adding the smallest validated insight/provenance types required by the tool response

**Interfaces:**
- `FinancialInsights = { balanceCents; safeToSpendCents; upcomingBills; expectedIncome; recurringOutflowCents; loanObligationsCents; rewardsPoints; recentDepositsCents; recentWithdrawalsCents; coverage: { complete: boolean; stale: boolean; sources: string[] }; highlights: string[] }`
- `buildFinancialInsights(snapshot: Snapshot, reserveCents: number): FinancialInsights`

- [ ] **Step 1: Write failing insight tests.** Cover safe-to-spend derived from the existing forecast, bills due within 14 days, scheduled income, recurring outflow, loan monthly payments, reward points, positive/negative cash-flow highlights, and incomplete/stale coverage.
- [ ] **Step 2: Run the tests and verify red failure.** Run `npm test -- tests/domain/insights.test.ts`.
- [ ] **Step 3: Implement pure insight aggregation.** Reuse forecast helpers instead of duplicating cash arithmetic; sort highlights deterministically; never make probabilistic claims from missing events.
- [ ] **Step 4: Run focused tests and all domain tests.** Run `npm test -- tests/domain/insights.test.ts tests/domain`.
- [ ] **Step 5: Refactor after green.** Keep output JSON-safe and stable for both the model and voice clients.

### Task 5: Expose grounded Cappy tools and verify the end-to-end path

**Files:**
- Modify: `src/service/tools.ts`
- Modify: `src/service/server.ts`
- Create: `tests/service/nessie-tools.test.ts`
- Modify: `docs/provider-contracts.md`
- Modify: `docs/verification.md`
- Modify: `docs/development.md`

**Interfaces:**
- Add read-only tools: `getAccountSummary`, `getUpcomingBills`, `getFinancialInsights`.
- Each tool input remains `{ accountId: string }` except `forecastPurchase`, which keeps its existing validated purchase/reserve input.
- Tool results include `mode`, `asOf`, `complete`, `stale`, and `sources` where applicable.

- [ ] **Step 1: Write failing tool tests.** Assert authenticated account scoping, deterministic insight output, provenance fields, rejection of another account, and no tool that can write to Nessie.
- [ ] **Step 2: Run focused tests and confirm red failure.** Run `npm test -- tests/service/nessie-tools.test.ts`.
- [ ] **Step 3: Implement the tools.** Inject an insight function alongside the existing snapshot function, validate input with Zod, and return structured results. Keep the formatter/model downstream of facts.
- [ ] **Step 4: Add end-to-end service coverage.** Exercise `/snapshot`, `/tool`, and `/forecast` with a fake live provider through Fastify, including stale-refresh behavior and partial-data labeling.
- [ ] **Step 5: Update concise provider/run documentation.** Document live environment variables, current zero-customer setup state, read-only scope, and a sanitized live smoke-test command that never prints the key.
- [ ] **Step 6: Run the complete verification gate.** Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`. If live credentials and a mapped customer are later configured, run the optional read-only smoke test and record only status/counts.

## Stop condition

Stop when a mapped Nessie customer can produce a normalized live snapshot and grounded Cappy insight/forecast through the authenticated service, all focused and full tests pass, and documentation clearly states the empty-customer setup state and the read-only boundary. Do not expand into financial writes, Persona, enterprise administration, or a full ElevenLabs agent migration in this change.
