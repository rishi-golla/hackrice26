# Baseline execution ledger

Work stays in `/Users/abhijithutla/projects/Flicky/hackrice26` on `codex/flicky-baseline`.
All eleven plan/spec documents were reviewed. The new implementation request supersedes their historical planning-only stop.
The root README stays unchanged; development instructions live in `docs/development.md`.

## Ownership and decisions

- Orchestrator: shared contracts, toolchain, service/desktop wiring, renderer, integration checks and final review.
- Financial worker: pure domain, fixtures, snapshot cache and service data providers; sole owner of scenario arithmetic.
- Desktop worker: pure geometry, dwell, cancellation and OCR pipeline; no Electron startup/UI ownership.
- Conversation worker: typed intents, memory, grounding and speech adapters; no domain or UI ownership.
- Workers use distinct files. No worker pushes or commits shared state. The orchestrator reviews every result.
- User explicitly requests parallel work and this existing folder; use in-place branch rather than hidden worktrees.
- No credentials are present. Nessie portal currently returns 403. Implement documented synthetic/recorded fallback; do not invent live financial endpoints.
- Persona is gated optional scope. Its prerequisites are absent, so no executable financial action ships in this baseline.
- Windows hardware is unavailable in this session. Native Windows validation remains unverified even if shared tests pass.
- Global key release must be proven; otherwise ship the spec's explicitly labeled toggle fallback plus an in-bubble hold control.
- Node host is 23.11.0, macOS 15.3.1 arm64. Pin resolved compatible dependency versions in lockfile.

## Requirement groups

- [x] Cents, dates, recurrence, deduplication, signed events, conservative checkpoints, 14-day scenario forecast.
- [x] Token-protected loopback service, runtime schemas, account/mode isolation, stale/incomplete policy.
- [x] Single-display capture, local OCR, uncertainty confirmation, dwell 700 ms / 8 DIP, 5-second cooldown, generation cancellation; native permission/scaling smoke tests remain pending.
- [x] Native pointer preserved; passive halo/annotation; anchored card, chart, reserve, provenance, accessible states and dismiss behavior.
- [x] Conversation cases A–N, bounded memory, date/amount corrections, remember/combine, explanations, deterministic router; hosted router remains unavailable without credentials.
- [x] Explicit voice consent, hold/toggle activation, deadlines, barge-in, mute, shutdown, server-generated reply-audio boundary; hosted speech remains unavailable without credentials.
- [x] Offline bundled OCR, packaged service lifecycle, synthetic checkout, repeatable development/build/test commands.
- [x] Adversarial tests, concurrent-cache stress test, local service end-to-end check; Electron GUI and Windows checks remain pending.

Unchecked items mean work or verification remains; external gates never become inferred passes.
