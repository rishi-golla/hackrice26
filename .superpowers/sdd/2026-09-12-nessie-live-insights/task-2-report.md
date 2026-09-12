# Task 2 report — normalize Nessie records into Snapshot

## Status

Complete after review fixes. Commits `d58adc0` and `b6d43e3` implement the Task 2 production code and tests; `0567e64` records the initial evidence report.

## Review follow-up

- **Status:** All five review findings fixed with failing regression tests observed before each production change.
- **Commit:** `b6d43e3` (`fix: harden Nessie snapshot normalization`).
- **Tests:** 57/57 combined normalizer, snapshot-store, and domain tests passed; `npm run typecheck` passed.
- **Concerns:** Nessie statuses remain free-form at the boundary, so unknown values are excluded as unconfirmed. Recurring records without `upcoming_payment_date` are rejected when `recurring_date` cannot form a real date in the `payment_date` month.

## Scope

- Added `src/service/providers/nessie-normalize.ts` with exported sanitized Nessie record types, `NessieAmountUnit`, `NessieNormalizeOptions`, `toCents`, and `normalizeNessieSnapshot`.
- Added `tests/service/nessie-normalize.test.ts` with conversion, validation, signed-event, status, recurrence, provenance, date/timezone, and account-number redaction coverage.
- Extended the existing `Snapshot` contract with optional `sources?: string[]` and validation for each source entry. Optionality preserves compatibility with existing synthetic and recorded snapshots.
- Did not modify `src/service/providers/nessie.ts`, `tests/service/nessie-client.test.ts`, or other Task 1 files.

## TDD evidence

### Red

Command:

```text
npm test -- tests/service/nessie-normalize.test.ts
```

Expected failure observed before production code existed:

```text
FAIL tests/service/nessie-normalize.test.ts
Error: Cannot find module '../../src/service/providers/nessie-normalize'
Test Files  1 failed (1)
```

The first sandboxed attempt was blocked by an `EPERM` write to `node_modules/.vite-temp`; rerunning the same command with scoped filesystem approval produced the expected missing-normalizer failure above.

### Green

Focused normalizer command:

```text
npm test -- tests/service/nessie-normalize.test.ts
```

Result: 1 test file passed, 17 tests passed.

Required normalization and forecast compatibility command:

```text
npm test -- tests/service/nessie-normalize.test.ts tests/domain/forecast.test.ts
```

Result: 2 test files passed, 25 tests passed.

Full domain regression command:

```text
npm test -- tests/domain
```

Result: 3 test files passed, 29 tests passed.

Type validation command:

```text
npm run typecheck
```

Result: exit code 0 with no TypeScript errors.

## Behavior delivered

- Dollar inputs are multiplied by 100 only when the result is a safe integer; cent inputs must already be safe integers.
- Non-finite, negative, fractional-cent, and unsafe converted money values are rejected.
- Account balance becomes `balanceCents`; deposits are positive income, withdrawals are negative expenses, and bills and monthly loan payments are negative bill events.
- Completed or posted transactions are marked reflected in balance. Pending transactions and pending/recurring bills are scheduled. Cancelled bills remain represented with `cancelled: true` and are excluded by the existing `normalizeEvents` logic.
- Recurring bills and loan payments preserve monthly recurrence. All mapped event dates flow through existing ISO-date validation.
- Full account numbers are omitted from snapshots. A label containing the full account number is replaced with a generic event label.
- Snapshots use `mode: 'live-sandbox'`, `stale: false`, the caller's `complete`, `today`, and `timezone`, and a validated timestamp from `now` or the current clock.
- Source endpoints are deduplicated and sorted for deterministic provenance.

## Design notes

- External records are parsed with Zod before domain mapping. Final events and snapshots are also passed through the existing `validateCashEvent` and `validateSnapshot` functions.
- Money arithmetic is confined to `toCents`; forecast arithmetic remains owned by the existing domain layer.
- Loan records expose `creation_date` but no next-payment date in the required sanitized field set, so it is used as the monthly recurrence anchor. The existing calendar normalization advances that anchor into the forecast window.

## Concerns

- Nessie status values are free-form strings in the sanitized boundary. The mapper recognizes completed/posted, pending/scheduled, cancelled/canceled, recurring, paid, and rejected conservatively; unseen provider status values remain unconfirmed for deposit/withdrawal events.
- The required loan field set has no explicit next-payment date, so `creation_date` is necessarily the recurrence anchor until the provider contract supplies a more precise date.
