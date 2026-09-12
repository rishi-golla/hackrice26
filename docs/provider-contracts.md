# Provider contracts

Evidence for every external data/provider boundary Cappy depends on. No API keys, query strings containing keys, or personal data appear below. "Unverified" means the contract has not been confirmed against live official documentation and a harmless read — it does not mean the code assumes it works anyway; every unverified provider has an explicit disabled/blocked state in the running app.

## Nessie (Capital One sandbox banking API) — verified read-only adapter

- **Official contract:** [Nessie documentation](https://prod.nessieisreal.com/docs) and [OpenAPI specification](https://prod.nessieisreal.com/nessie-openapi-spec.yaml). The production host is `https://prod-api.nessieisreal.com`, and the API key is sent as the required `key` query parameter by the server-side client.
- **Adapter status:** `src/service/providers/nessie.ts` implements authenticated GET requests only. The live snapshot provider uses customer detail, customer accounts, customer bills, account detail, account bills, account deposits, account withdrawals, and account loans. Cappy exposes the normalized result through authenticated, account-scoped read-only tools; it never calls Nessie from a tool directly.
- **Amount units:** Nessie's money schemas allow integer or floating values without declaring whether the unit is dollars or cents. Live startup therefore requires an explicit `NESSIE_AMOUNT_UNIT=dollars` or `NESSIE_AMOUNT_UNIT=cents`; Cappy converts every amount to integer cents before forecasting.
- **Identity mapping:** `NESSIE_CUSTOMER_ID` maps the authenticated Cappy demo account to one server-configured sandbox customer. `NESSIE_ACCOUNT_ID` may select one of that customer's accounts; when omitted, the first returned account is selected. Renderer input never chooses a Nessie customer ID.
- **Credentialed evidence:** The current supplied key authenticated successfully: the harmless customer-list read returned HTTP 200 with zero customers. No records were written. A sandbox customer and account must exist before the configured customer/account reads can populate live insights.
- **Known limits:** The OpenAPI has no general purchase or transfer list route, so this adapter does not invent either history. Enterprise endpoints are excluded. Payments, transfers, and every other Nessie write are intentionally disabled.
- **Privacy and failure semantics:** The API key stays in the service process and is never logged; tool output excludes full account numbers, raw customer records, and unrelated customer data, retaining at most the account last four digits. Authentication/not-found errors are surfaced explicitly, while rate-limit, server, and network failures receive bounded retries. Malformed payloads fail validation. Optional resource failures yield `complete: false` with only successful endpoint paths in `sources`; a failed refresh may return an existing cached snapshot with `stale: true` and its original `asOf`. Live failures never silently fall back to synthetic data.

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
