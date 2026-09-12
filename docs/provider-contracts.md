# Provider contracts

Evidence for every external data/provider boundary Cappy depends on. No API keys, query strings containing keys, or personal data appear below. "Unverified" means the contract has not been confirmed against live official documentation and a harmless read — it does not mean the code assumes it works anyway; every unverified provider has an explicit disabled/blocked state in the running app.

## Nessie (Capital One sandbox banking API) — implemented and live-verified

- **Status:** `src/service/providers/nessie.ts` is implemented, unit-tested (`tests/service/nessie.test.ts`, 12 cases, fake `fetch` — no real network calls in tests), and **verified end to end against the live sandbox API** on 2026-09-12: a real customer, checking account, two bills, and a deposit were created and read back through `https://api.nessieisreal.com`, then run through the real `/snapshot` and `/forecast` service routes and confirmed to produce the exact canonical result (`minimumCents: -8000` on `2026-09-16`, `status: "negative"`).
- **Base URL:** `https://api.nessieisreal.com`
- **Auth:** `?key=<api_key>` query parameter appended to every request (not a header). Confirmed live: an unrecognized/placeholder key returns `200 []` rather than an auth error — reads are scoped per key, not rejected outright.
- **Verified endpoints:**
  | Method | Path | Purpose |
  |---|---|---|
  | GET | `/accounts/{id}` | Account balance/type/nickname |
  | GET | `/accounts/{id}/bills` | Bills (rent, utilities, subscriptions, ...) |
  | GET | `/accounts/{id}/deposits` | Deposits (paychecks, transfers in) |
  | POST | `/customers`, `/customers/{id}/accounts`, `/accounts/{id}/bills`, `/accounts/{id}/deposits` | Used only to seed the demo sandbox account below, never at runtime |
- **Verified fields (live response, not from stale 2015 SDK docs alone):**
  - **Account:** `_id` (now a UUID, not the old Mongo-style id), `type` (`"Checking"|"Savings"|"Credit Card"`), `nickname`, `rewards`, `balance` — confirmed to be **plain whole/decimal dollars** (sending `"balance": 800` round-trips as `800`, i.e. $800.00), `account_number`.
  - **Bill:** `_id`, `status` — confirmed via a live 400 validation error to be exactly `'pending' | 'cancelled' | 'completed' | 'recurring'`, `payee`, `nickname`, `payment_date` (original anchor date), `recurring_date` (day-of-month, number), `payment_amount` (dollars), `account_id`, `creation_date`, and **`upcoming_payment_date`** — a server-computed field absent from the old SDK docs, confirmed to be the authoritative next-occurrence date (used as the adapter's `CashEvent.date`, avoiding any guesswork about how `recurring_date` and `payment_date` combine).
  - **Deposit:** `_id`, `medium`, `transaction_date`, `status` (accepts any string — no server-side enum, confirmed by posting an unrecognized value and having it accepted with `201`), `amount` (dollars), `description`, `creation_date`.
  - **Confirmed live:** creating a `pending` or `completed` bill/deposit **never** auto-updates the account's `balance` — it stays a purely separate scheduled record. This means every bill/deposit the API returns is always `reflectedInBalance: false` in our model; Nessie has no server-side concept of "already applied to balance."
- **Adapter's fail-closed mapping rules** (see `src/service/providers/nessie.ts` for the exact code):
  - Bill `status: 'completed'` → excluded entirely (assumed already paid and reflected in the current balance figure).
  - Bill `status: 'cancelled'` → included with `cancelled: true` (excluded downstream by the domain engine).
  - Bill `status` anything other than the 4 confirmed values → snapshot marked `complete: false` rather than guessing.
  - Deposit `status` other than `'pending'`/`'recurring'` (including `'completed'` and any unrecognized value) → excluded, never treated as scheduled income. This directly satisfies the product spec's *"Scheduled income must be provider-scheduled..., never extrapolated silently from historical deposits."*
  - Account `type: 'Credit Card'` → the read throws (non-liquid, out of scope per the spec's "USD checking-account purchases" framing); `Checking`/`Savings` are accepted as liquid.
  - Dollar-to-cents conversion rejects any value with more than 2 decimal places instead of silently rounding real money, and rejects non-finite/out-of-range values.
- **Demo sandbox account** (already seeded, matches the canonical synthetic fixture exactly so both modes tell the same story): $800 balance, $600 rent due 2026-09-14, $80 utilities due 2026-09-16, $1,000 scheduled paycheck deposit 2026-09-19. Configure via `.env`: `FLICKY_DATA_MODE=live-sandbox`, `NESSIE_API_KEY`, `NESSIE_ACCOUNT_ID` (see `.env.example`).
- **Known open item:** the exact semantic difference between bill statuses `'pending'` and `'recurring'` was not fully disambiguated (both are treated identically here, as "still upcoming, not yet paid") — a live account that actually reaches its second month of recurrence would clarify whether Nessie itself transitions `pending` → `recurring` automatically. Not blocking, since the 14-day horizon rarely needs a bill's second occurrence anyway.

## ElevenLabs (speech-to-text + text-to-speech)

- **Status:** Fully implemented and unit-tested (`src/service/providers/speech.ts`, `src/service/speech-config.ts`) but **never exercised against the live API** — no `ELEVENLABS_API_KEY` exists in any checkout this project has run in.
- **Endpoints used by the implementation:**
  - `POST https://api.elevenlabs.io/v1/speech-to-text` — multipart `file` + `model_id=scribe_v2`, header `xi-api-key`. Used for transcription (hold-to-talk release).
  - TTS endpoint via `ELEVENLABS_VOICE_ID` + `ELEVENLABS_TTS_MODEL_ID` (default `eleven_flash_v2_5`) — synthesizes only a reply already owned by the server-side conversation manager; the renderer can never submit arbitrary text for speech.
- **Environment variables** (see `.env.example`): `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_STT_MODEL_ID`, `ELEVENLABS_TTS_MODEL_ID`, `ELEVENLABS_TIMEOUT_MS`, `ELEVENLABS_ZERO_RETENTION`. None are present in this checkout; the service reports truthful `capabilities.transcription`/`capabilities.speech = false` when absent (`src/service/entry.ts`), and the UI keeps typed input available.
- **To verify later:** supply a real `ELEVENLABS_API_KEY` and run one live transcription + synthesis request; record actual latency and confirm zero-retention behavior if `ELEVENLABS_ZERO_RETENTION=true` is required for the demo.

## Conversation intent router — deterministic, no hosted LLM

- **Status:** `src/service/conversation/router.ts` implements `deterministicRouter` — a local, rule-based intent classifier (evaluate/remember/explain/forget/clarify). There is currently no hosted-LLM router wired in (`src/service/providers/model.ts` exists as a boundary/interface for one, per the Cappy conversion plan, but nothing calls out to Anthropic, OpenAI, or another model provider for intent routing today).
- **Why this is fine for the demo:** the spec requires only that the router select a validated, schema-constrained intent — it explicitly forbids the router from authoring financial facts. A deterministic router satisfies that constraint and needs no credentials, network access, or latency budget.
- **To verify later:** if a hosted structured-output LLM router is added, confirm its official API docs, run one schema-valid read-only request with synthetic purchase context, and record sanitized latency.

## Persona (identity verification for optional sandbox mitigation)

- **Status:** Not implemented, and not required. See "Persona (Task 2)" in `docs/verification.md` for the explicit skip decision and entry-condition analysis.

## Real measured evidence

See `docs/verification.md`'s "Measured latency" section for actual numbers from `scripts/measure-hover-latency.mjs`, run against a real screenshot of `demo/checkout.html` through the real OCR/forecast/router pipeline.
