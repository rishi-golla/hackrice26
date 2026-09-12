# Cursor Financial Bodyguard — Part 1: foundation and financial engine

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after explicit implementation authorization. Steps use checkbox syntax.

**Goal:** Establish the safe Electron/TypeScript boundary and deliver the deterministic cents-based forecast plus an authenticated snapshot service that the other three parts can consume.

**Owns:** repository configuration, runtime contracts, money/date/event normalization, forecast/scenario arithmetic, synthetic fixtures, snapshot caching and verified Nessie reads.

**Does not own:** screen capture, OCR, overlay visuals, conversation routing, speech, Persona transfers or final packaging.

**Spec:** `specs/2026-09-12-cursor-financial-bodyguard-design.md`

**Master plan:** `plans/2026-09-12-cursor-financial-bodyguard.md`

## Dependencies and handoff

Start from an empty repository. Do not clone Clicky. Part 2 consumes `Snapshot`, `Forecast`, `Frame` and bridge contracts. Part 3 consumes `Snapshot`, `Forecast`, `HypotheticalPurchase`, `PurchaseRef` and the authenticated analysis route. Part 4 consumes the service/provider interfaces and the build scripts. Commit only files listed below; do not edit README.

## Global constraints

- All monetary values are integer USD cents; reject malformed or unknown currency input.
- The horizon is today plus the next 13 calendar days in the configured timezone.
- Outgoing obligations are applied before income on the same date.
- Historical events already reflected in the starting balance are never reapplied.
- Missing or stale data is labeled and never silently treated as zero or current.
- Synthetic, recorded-sandbox and live-sandbox modes are visible and never switch silently.
- Renderer uses context isolation and no Node integration; provider secrets stay server-side.
- No screenshot or raw OCR text is sent to the financial service or an LLM.

## Owned files

Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `electron-builder.yml`, `.env.example`, `src/contracts/api.ts`, `src/contracts/desktop.ts`, `src/domain/{types,money,dates,normalize,forecast,scenario,explain}.ts`, `src/fixtures/demo.ts`, `src/service/{config,server,snapshot}.ts`, `src/service/providers/nessie.ts`, `tests/domain/`, `tests/service/`, `docs/provider-contracts.md`.

## Task 1 — shell, contracts and feasibility gate

- [ ] Inspect Node, TypeScript, Electron and target-device access. Record the actual macOS/Windows test access in a private handoff note; do not claim Windows support without a native launch.
- [ ] Verify the official Nessie account/bill read contract before writing the adapter. Record endpoint, authentication, account balance meaning, bill fields/statuses, recurrence semantics and a redacted response example. If inaccessible, set live mode unavailable and continue with synthetic mode.
- [ ] Create scripts: `dev`, `build`, `typecheck`, `test`, `test:watch`, `package:mac`, `package:win`; `test` runs `vitest run`, `typecheck` runs `tsc --noEmit`.
- [ ] Define request/response schemas for the internal service. Required routes are `GET /health`, `GET /snapshot?accountId=...&refresh=true`, and `POST /forecast` with `{accountId,purchaseCents,reserveCents,allowStale}`.
- [ ] Define the cross-part contracts below and export runtime validators.

```ts
export type DataMode = 'live-sandbox'|'recorded-sandbox'|'synthetic';
export type Snapshot = {
  accountId:string; balanceCents:number; currency:'USD'; asOf:string;
  today:string; timezone:string; mode:DataMode; complete:boolean;
  stale:boolean; events:CashEvent[];
};
export type Frame = {
  id:string; capturedAt:number; displayId:string; bounds:Rect;
  workArea:Rect; imageWidth:number; imageHeight:number; png:Uint8Array;
};
export type SnapshotProvider = { read(accountId:string):Promise<Snapshot> };
export type Analysis = { snapshot:Snapshot; forecast:Forecast };
```

- [ ] Write and run the shell/contract test first: `npm test -- tests/service/contracts.test.ts`; it should fail until exports and schema validation exist.
- [ ] Ensure local configuration and logs cannot expose API keys, `.env`, snapshots or ledgers. Commit `chore: establish typed financial service boundary`.

## Task 2 — cents, dates, events and fixture

- [ ] Write tests for `parseUSD(text): number`, ISO date addition, timezone date derivation, duplicate source IDs, reflected/cancelled events, monthly Jan 31 → Feb 28, today+13 inclusion and today+14 exclusion.
- [ ] Implement strict USD parsing: `$1,234.56` → `123456`; reject euro, malformed separators, negative purchase strings and unsafe integer results. Use integer arithmetic only.
- [ ] Implement `CashEvent` normalization. Event fields are `id`, `sourceId`, `date`, signed `cents`, `label`, `kind`, `confidence`, `reflectedInBalance`, `cancelled`, and optional `recurrence:'monthly'`.
- [ ] Implement `demoSnapshot()` with balance $800, rent −$600 on September 14 2026, utilities −$80 on September 16, scheduled income +$1,000 on September 19, reserve $100 and timezone `America/Chicago`.
- [ ] Exclude reflected, cancelled, pre-today and unconfirmed events from the base forecast. Surface overdue unreflected obligations as incomplete data. Use source ID plus occurrence date for recurrence identity.
- [ ] Run domain tests and typecheck. Commit `feat: add validated financial inputs and synthetic fixture`.

## Task 3 — deterministic forecast and scenario engine

- [ ] Write tests for canonical $200 → minimum −$80 on September 16; $10 → $110; zero versus negative; exact reserve boundary; baseline already negative; same-day debit before income; no events; and safe-integer overflow.
- [ ] Implement `forecast(snapshot,purchaseCents,reserveCents): Forecast` with 14 `DayPoint`s containing opening, conservative intraday low and closing cents. Apply negative events before positive events, breaking ties by ID.
- [ ] Implement `evaluateScenario(snapshot,purchases,reserveCents): Forecast` where `HypotheticalPurchase={id,label,cents,date}`. Dated purchases affect only their date and later; duplicate IDs, invalid cents and out-of-horizon dates fail closed.
- [ ] Implement status: `negative` when any after-purchase checkpoint is below zero, `below-reserve` when minimum is nonnegative but below reserve, otherwise `within-reserve`. `safeToSpendCents=max(0,baselineMinimumCents-reserveCents)`.
- [ ] Implement `explain(forecast):string` from computed facts only. Include actual bill labels/dates, scheduled-income assumptions and stale/incomplete qualifiers.
- [ ] Run the full domain suite and typecheck. Commit `feat: calculate deterministic purchase scenarios`.

## Task 4 — authenticated snapshot service and Nessie adapter

- [ ] Write Fastify injection tests for missing token → 401, unknown account → 403, malformed amount → 400, provider failure without cache → 503, stale preview consent and forced refresh.
- [ ] Build the local service on `127.0.0.1` with a random per-launch session token. Main process owns requests; renderer receives only narrow preload methods.
- [ ] Implement `SnapshotStore.get(accountId,refresh)` with a fake clock and 60-second cache. On provider failure with cache, return `stale:true`; reject stale analysis unless `allowStale:true`. Preserve mode visibly.
- [ ] Translate only verified Nessie fields into `Snapshot`. Reject unexplained balance semantics, unsupported bill status/recurrence and unknown currencies. Never infer scheduled income from historical deposits or roommate IOUs.
- [ ] If live contract verification is blocked, keep synthetic and sanitized recorded providers and mark live unavailable. Do not invent endpoint fields.
- [ ] Run service/domain tests, typecheck and local service smoke test. Commit `feat: serve fresh and explicitly stale financial snapshots`.

## Handoff checklist

- [ ] Give Parts 2–4 the exact commit hash and exported signatures.
- [ ] Demonstrate canonical fixture through `POST /forecast` without any screen or voice dependency.
- [ ] Report live Nessie availability, test devices and unresolved assumptions.
- [ ] Keep this document in `plans/` and do not edit README unless requested.
