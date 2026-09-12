# Cappy Live Nessie Insights Design

## Goal

Give Cappy a server-owned, read-only connection to Capital One Nessie so an authenticated customer can receive personalized account, bill, cash-flow, debt, rewards, and purchase-impact guidance grounded in current sandbox data.

## Evidence and contract boundary

The implementation follows the official [Nessie documentation](https://prod.nessieisreal.com/docs) and [OpenAPI specification](https://prod.nessieisreal.com/nessie-openapi-spec.yaml). The production API is `https://prod-api.nessieisreal.com`; authentication is the required `key` query parameter. The current service uses cents internally, while Nessie examples and schemas expose integer or floating monetary fields without an explicit currency-unit statement. The provider therefore requires an explicit `NESSIE_AMOUNT_UNIT` setting and rejects an ambiguous configuration.

The documented customer-facing resource families are customers, accounts, account bills, deposits, withdrawals, loans, merchants, ATMs, and branches. Purchase and transfer paths are documented as ID-level reads/updates/deletes, but the OpenAPI does not expose a general account list route for them. Cappy will consume those records only when an authorized caller supplies a documented ID or when a future adapter receives an explicit source record; it will not manufacture transaction history.

Enterprise endpoints are excluded from the desktop customer path. They provide broad administrative reads and would violate least-privilege if used for an individual Cappy session.

## User and account mapping

The desktop session account ID remains the policy boundary. A live Nessie provider maps that ID to one configured Nessie customer ID (`NESSIE_CUSTOMER_ID`) for the demo. A later login store may replace this with a server-side per-user mapping. Cappy never accepts a Nessie customer ID from the renderer as an authorization decision and never enumerates all customers during normal insight requests.

## Data flow

1. A session-authenticated Cappy request selects an account already permitted by `assertAccountAccess`.
2. The provider fetches the mapped customer, accounts, account bills, deposits, withdrawals, and loans with bounded parallel reads. Optional merchant, ATM, and branch enrichment is fetched only when a user asks for it or a source record contains a usable reference.
3. The provider validates response shapes, converts money to integer cents using the explicit configured unit, normalizes dates/statuses, redacts account numbers to last four digits, and records source endpoint, `asOf`, completeness, and stale state.
4. The normalized account is converted to the existing `Snapshot` contract. Bills, deposits, withdrawals, and loan payments become signed cash events with source IDs, confidence, recurrence, cancellation, and balance-reflection flags.
5. The deterministic forecast engine calculates the 14-day baseline, purchase scenarios, reserve protection, and minimum date. A separate insight projection summarizes cash position, upcoming obligations, income timing, recurring burn, debt load, rewards, cash-access options, coverage, and confidence.
6. Cappy tools return the structured snapshot/insight/forecast result. The model and ElevenLabs voice may explain those facts in the user’s preferred style but may not calculate new financial facts or call Nessie directly.

## Insight behavior

The first live slice exposes account summary, upcoming bills, cash-flow insights, debt/loan obligations, rewards, and purchase stress tests. Every answer carries `mode`, `asOf`, `complete`, `stale`, source endpoints, and a short uncertainty explanation. Missing or partial resources produce an explicit incomplete result. Live data never silently falls back to synthetic data.

The model prompt contains only the minimized structured insight payload, the user’s question, and optional OCR purchase context. Raw addresses, full account numbers, API keys, and unrelated customer records are excluded.

## Reliability and privacy

- API keys exist only in the service process and are never logged or returned.
- Request URLs are redacted before errors are recorded.
- Reads use a timeout and bounded retry for 429/5xx/network failures; 401/403/404 are surfaced as actionable provider errors.
- `SnapshotStore` retains the last valid value and marks it stale only after a refresh fails.
- No POST, PUT, or DELETE Nessie operation ships in this slice.
- Synthetic and recorded modes remain usable for offline development.

## Configuration

Required for live mode:

- `FLICKY_DATA_MODE=live-sandbox`
- `NESSIE_API_KEY` (server-only secret)
- `NESSIE_CUSTOMER_ID` (mapped customer)
- `NESSIE_AMOUNT_UNIT=dollars` or `cents`; no default

Optional controls:

- `NESSIE_BASE_URL` (defaults to `https://prod-api.nessieisreal.com`)
- `NESSIE_TIMEOUT_MS`
- `NESSIE_RETRY_COUNT`
- `NESSIE_CACHE_TTL_MS`

## Acceptance criteria

- A mapped customer with documented account/bill/deposit/withdrawal/loan responses produces a validated, cents-based `Snapshot`.
- A live snapshot drives the existing 14-day forecast and a structured personalized insight result.
- Cappy tools remain authenticated, account-scoped, and read-only.
- Provider failures, partial responses, stale cache, ambiguous money units, and account mismatches are tested.
- No key, full account number, or raw customer address appears in logs, model input, or repository files.
- With the current supplied key and zero customers, the service returns a clear setup state rather than pretending to have data.

## Non-goals

Persona verification, payments/transfers, Nessie record creation, merchant writes, enterprise administration, full ElevenLabs Conversational Agent migration, and production deployment are separate changes.
