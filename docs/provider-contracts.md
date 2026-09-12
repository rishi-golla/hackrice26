# Provider contracts

Evidence for every external data/provider boundary Cappy depends on. No API keys, query strings containing keys, or personal data appear below. "Unverified" means the contract has not been confirmed against live official documentation and a harmless read — it does not mean the code assumes it works anyway; every unverified provider has an explicit disabled/blocked state in the running app.

## Nessie (Capital One sandbox banking API) — unverified, live mode disabled

- **Status:** No adapter exists in this codebase (`src/service/providers/nessie.ts` was planned but never implemented). `src/service/entry.ts` explicitly throws if `live-sandbox` mode is selected: *"Live Nessie contract is not verified. Select synthetic or recorded-sandbox explicitly."*
- **Why:** The Nessie portal (`https://api.nessieisreal.com/`) returned HTTP 403 during the original planning session and was never re-verified with working credentials.
- **What this means for the demo:** All financial data — balance, rent, utilities, scheduled income — comes from a hardcoded, clearly-labeled synthetic fixture (`src/fixtures/demo.ts`): $800 balance, $600 rent on Sep 14, $80 utilities on Sep 16, $1,000 income on Sep 19, reserve $100. The app's `mode` field is always visibly `synthetic` in this state; nothing is silently presented as live.
- **To verify later:** obtain a working Nessie API key, confirm base URL/auth scheme, account balance semantics, bill status/recurrence fields, and a sanitized example response, then implement `src/service/providers/nessie.ts` against that verified contract (Part 1/foundation-financial-engine's file, not Part 4's).

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
