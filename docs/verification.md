# Verification record

## Automated checks — macOS, Apple Silicon (arm64), Node v22.15.1

| Command | Result |
|---|---|
| `npm install` | Pass. This host's default Node (20.17) is below Electron 40's floor (>=22.12); Node 22.15.1 via nvm is required. |
| `npm run typecheck` | Pass, no errors. |
| `npm test` | Pass — **142/142 tests, 33 files.** |
| `npm run build` | Pass — emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets, bundled OCR language assets. |
| `npm run test:e2e` | Pass — "service e2e passed" (authenticated local service flow). |
| `npm run test:stress` | Pass — 1/1 (concurrent snapshot cache). |
| `npm run dev` (live launch) | Boots cleanly: main process, 2 renderers, GPU/network helpers, local Fastify service. |

Every OCR-related test mocks `tesseract.js` entirely (`vi.mock('tesseract.js', ...)`), so a fully green test suite alone would not have caught two real, independent, demo-blocking bugs in the OCR pipeline — see below. Both are now **fixed and confirmed working** against the real production code path (not a workaround).

## Fixed: two confirmed bugs that made real screen-OCR capture non-functional

Found by driving the exact production code path end to end against a real screenshot (not a mocked word list) via `scripts/measure-hover-latency.mjs`. Both live in `src/desktop/` (Part 2's files); fixed here with explicit authorization from the project owner after being flagged. Both fixes are minimal, targeted, and verified against the real, unmodified `recognize(frame)` call path `main.ts` actually uses — not a benchmark-only workaround.

### Bug 1 (fixed) — `src/desktop/recognize.ts` poisoned tesseract.js's own working default

`createRuntimeWorker()` called:
```ts
createWorker('eng', 1, { langPath: config.langPath, workerPath: config.workerPath, corePath: config.corePath, logger: () => {} })
```
`config.workerPath`/`config.corePath` are `undefined` on every real call — `main.ts` calls `recognize(frame)` with no options at all. tesseract.js merges options as `{...defaultOptions, ..._options}`; because the key `workerPath` was *explicitly present* (even though its value was `undefined`), the spread overwrote tesseract.js's own correct built-in default (`node_modules/tesseract.js/src/worker/node/defaultOptions.js`) instead of leaving it alone. The result: `new Worker(undefined)` threw immediately —
```
TypeError [ERR_INVALID_ARG_TYPE]: The "filename" argument must be of type string or an instance of URL. Received undefined
```
**Confirmed via isolated A/B test** before fixing: passing `{ workerPath: undefined }` explicitly failed; omitting the key entirely succeeded. **Fix applied:** only include `workerPath`/`corePath` in the options object when actually defined, instead of always including the keys with a possibly-`undefined` value. The same bug pattern also existed in the unused, dead-code `createTesseractRecognizer()` factory later in `src/desktop/ocr/recognize.ts` (nothing in `src/` or `tests/` calls it) — fixed there too for consistency, though it isn't reachable from the running app.

### Bug 2 (fixed) — `src/desktop/ocr/recognize.ts` called `recognize()` without the argument that populates word boxes

`PersistentOcrRecognizer.recognize()` called `worker.recognize(frame.png)` with no third (output-format) argument. The installed `tesseract.js@^6.0.0` returns `data.words === undefined` and `data.blocks === null` by default — confirmed by direct inspection of a real recognition result — so `mapWords()`'s existing (and already-correct) `data.blocks` fallback path never actually ran, because `blocks` was never populated in the first place. Every real call threw `OcrRecognitionError('invalid-result', 'OCR returned no word data')`, independent of Bug 1. Every unit test for this file mocks `worker.recognize()` to directly hand back a fake `data.words` array, so this was invisible to `npm test`.

**Fix applied:**
```ts
workerState.worker.recognize(frame.png, {}, { blocks: true })
```
plus widening the `TesseractWorker.recognize()` type to accept the params/opts arguments. `mapWords()`'s block-walking logic (`blockWords()`) needed no changes — it was already written correctly for this shape; it just never received populated data.

**Verified fix, not just a diagnosis:** an ad-hoc esbuild-bundled script, run under plain Node against the exact unmodified `src/desktop/recognize.ts` export (`main.ts`'s literal `recognize(frame)` call, zero workarounds), returned `{"amountCents":20000,...}` from the real screenshot in ~115-320ms. `npm run bench:hover` was then updated to use the real path directly (the earlier Bug-2 workaround code was removed from the benchmark, since it's no longer needed).

## Measured latency (real pipeline, real screenshot, real fixed production code)

Produced by `npm run bench:hover` (`scripts/measure-hover-latency.mjs`), which bundles the actual, unmodified production modules — `src/desktop/recognize.ts`, `src/desktop/extract.ts`, `src/domain/forecast.ts`, `src/service/conversation/controller.ts` — with esbuild and runs them under plain Node (matching the packaged app's runtime shape; Vitest's own worker-thread sandbox breaks tesseract.js's Node worker spawning, so this could not be run as a `*.test.ts` file). OCR uses real `tesseract.js` recognition through the real, now-fixed `recognize()` — no workaround needed after Bugs 1 & 2 were fixed. Fixture: `tests/fixtures/checkout.png`, a real headless-Chromium screenshot of `demo/checkout.html` (`npm run bench:fixture`), not a synthetic word list. 5 runs:

| Stage | Median | Max |
|---|---|---|
| OCR (real tesseract.js recognize, incl. first-run cold start) | 116.3ms | 323.7ms |
| Extract (image-to-desktop coordinate + candidate logic) | 0.3ms | 1.3ms |
| Forecast (deterministic domain engine) | 0.3ms | 11.0ms |
| Router + grounded reply (deterministic, no hosted LLM) | 0.3ms | 1.1ms |
| **End-to-end** (excludes real screen capture + speech) | **117.0ms** | **337.0ms** |

Recognized amount: **$200.00, correct**, from the real "Order total: $200.00" text in the screenshot. Result: **well under the plan's <=3s target** — OCR dominates completely; forecast/router are effectively free. Not included: the 700ms dwell timer and the real `desktopCapturer` screen grab (both need a live Electron window with granted Screen Recording permission — blocked in this automation session, see Task 1 below) and ElevenLabs speech transcribe/synthesize latency (no credentials in this checkout — see `docs/provider-contracts.md`).

## Task 1 — cross-platform feasibility matrix

| Capability | macOS (this session) | Windows |
|---|---|---|
| Toolchain / dev shell launches | **Pass** — `npm run dev` builds and boots Electron (main, 2 renderers, GPU helper, local service) | Unverified here, but teammate 3's own report confirms shared/unit tests and `test:e2e` pass on Windows (Node 24.19.0) — GUI itself not launched by them either |
| Passive overlay / interactive card, real pointer behavior | **Blocked in this automation session** — no macOS Screen Recording/Accessibility permission granted to this shell, so `screencapture`/`osascript` can't confirm the on-screen card visually. Process-level evidence (main + 2 renderers alive, clean shutdown) confirms no crash | Not attempted |
| Selected-display capture + OCR | **Pass** — the two OCR bugs above are fixed and verified against the real code path; still no live interactive on-screen confirmation in this session for lack of Screen Recording permission | Not attempted |
| Denied-permission recovery | Not exercised | Not attempted |
| Global hold-to-talk (⌘⇧Space) | Registered without error at startup (`config.shortcutAvailable`); press/release not interactively exercised | Not attempted |
| 100/125/200% scaling, negative origins | Covered by unit tests (`tests/desktop/coordinates.test.ts`); no physical multi-monitor/scaled rig tested | Not attempted |
| Harmless Nessie read | **Pass** — implemented and verified live end to end against a real sandbox account; see `docs/provider-contracts.md` | N/A |
| Speech request (ElevenLabs) | **Blocked** — no credentials in this checkout; provider code is unit-tested but never called live | Same, per teammate 3's report |
| Schema-only router request | **Pass** — deterministic router, measured above at 0.3ms median | Same |
| Packaged offline launch | **Pass** — see Task 3 | Not attempted (no artifact built, no device) |

**Summary:** macOS toolchain, build, packaging, real screen-OCR, and now live Nessie all pass, verified against real services. What remains blocked is purely permission/credential/hardware-gated (live interactive confirmation needs Screen Recording permission on a real device; ElevenLabs needs credentials; Windows needs a device), each with a working fallback (synthetic mode, typed input).

## Live Nessie integration — implemented and verified end to end

`src/service/providers/nessie.ts` translates a real Capital One Nessie sandbox account into the app's `Snapshot` type. Full contract evidence (endpoints, exact field names, status enums confirmed via a live validation error, dollar-vs-cents units confirmed by round-tripping known values) is in `docs/provider-contracts.md`. Summary of what was actually run, not just written:

1. A real customer, checking account ($800 balance), two bills (rent $600 due 2026-09-14, utilities $80 due 2026-09-16), and one deposit ($1,000 scheduled 2026-09-19) were created via live POST requests to `https://api.nessieisreal.com` — matching the canonical synthetic fixture exactly, so both data modes tell the same demo story.
2. The actual `dist/service.cjs` was launched with `FLICKY_DATA_MODE=live-sandbox` and real `NESSIE_API_KEY`/`NESSIE_ACCOUNT_ID` values, booted successfully reporting `"mode":"live-sandbox"`.
3. `GET /snapshot` returned the real translated data: `balanceCents: 80000`, rent/utilities as negative bill events with `recurrence: "monthly"`, the deposit as a positive income event — all through the real HTTP round trip to Nessie, not a mock.
4. `POST /forecast` with a $200 purchase against that live snapshot returned the exact canonical result: `minimumCents: -8000` on `2026-09-16`, `status: "negative"`, `safeToSpendCents: 2000` — identical to the synthetic-mode result, now sourced from a real bank sandbox.
5. Along the way, fixed a real, separate bug this integration exposed: `src/service/auth.ts`'s demo auth provider hardcoded every session to `accountId: 'demo-checking'` regardless of which account the server was actually configured for, which silently broke access to any non-default account (live or otherwise). `createDemoAuthProvider` now accepts the actual configured account id; `entry.ts` passes it through. Existing tests (`tests/service/auth.test.ts`) still pass unchanged since the accountId parameter is optional and defaults to the prior behavior.
6. Added 12 new unit tests (`tests/service/nessie.test.ts`) covering the missing-key case, the full translation happy path, cancelled/completed/unrecognized bill statuses, non-active deposit statuses, non-liquid account rejection, malformed/sub-cent-precision balances, account-id mismatch, HTTP failure, and timeout — all against a fake `fetch`, no real network calls in the test suite itself.

**Known open item, not blocking:** the semantic difference between bill statuses `'pending'` and `'recurring'` wasn't fully disambiguated (both are treated as "still upcoming"); see `docs/provider-contracts.md` for detail.

## Task 2 — Persona sandbox mitigation: skipped, recorded as omitted

Entry condition ("verified Nessie transfer semantics exist, Persona sandbox/template exists, at least four hours remain") still fails: Nessie *account/bill/deposit reads* are now verified (see above), but no *transfer* endpoint was exercised or verified, and no Persona sandbox/template exists. Per the plan's own instruction this task remains skipped. No `src/service/providers/persona.ts` or `src/service/actions/*` files were created; none are required for the core demo.

## Task 3 — packaged demo and synthetic fallback

- `demo/checkout.html` — already present, labeled "Synthetic checkout demo", $200/$10 variants via a `<select>`, "Complete Purchase" only updates local text. No changes needed.
- `npm run package:mac` (electron-builder 26.15.3, target `dir`, arch arm64): succeeded, produced `release/mac-arm64/Cappy.app` (~334MB, intentionally unsigned).
  - `Info.plist` confirms correct branding (`CFBundleName`/`CFBundleDisplayName` = Cappy, `CFBundleIdentifier` = `com.abhijithutla.cappy.desktop`, Cappy-worded permission strings).
  - Launched the packaged `.app` directly (no dev server) — main process, renderer, GPU/network helpers, and the local Fastify service all started from inside `app.asar`.
  - Searched the unpacked bundle for `ELEVENLABS_API_KEY`, `sk-`, `xi-api-key` — none found.
  - Simulated quit (SIGTERM to main process): every child process exited with it, no orphans.
- `npm run package:win` — **not run.** No Windows device or runner available. Config exists (`win: {target: dir}`) but is unexercised. A Windows artifact without a Windows launch is unverified Windows support, recorded honestly as such.

## Task 4 — acceptance matrix (mapped to real evidence, not re-asserted)

| Check | Expected | Evidence |
|---|---|---|
| Fresh launch | Monitoring off, synthetic mode visible | `PublicConfig.monitoring` defaults false; `mode` always `synthetic` while live is disabled |
| Hover $200 final total | Minimum −$80 on Sep 16 | `tests/domain/forecast.test.ts` (canonical fixture) + real OCR benchmark above agree: $200 purchase → minimum −8000 cents on 2026-09-16 |
| Change amount to $10 → $110, within-reserve | `tests/domain/forecast.test.ts` | Pass |
| Remove utilities, $200 → $0, below-reserve (never "negative") | `tests/domain/forecast.test.ts` | Pass |
| Already-negative baseline explained | `tests/domain/explain.ts` reasons; covered by domain tests | Pass |
| API unavailable → stale/incomplete, never silent | `tests/service/snapshot.test.ts` (60s cache, `allowStale` gate) | Pass |
| Cursor conversation (follow-up date, "both", explain, forget) | `tests/conversation/conversation.test.ts` (cases A–N from the design doc) | Pass |
| Cancellation / turn generation | `tests/desktop/pipeline.test.ts`, `tests/service/session.test.ts` | Pass |
| Packaged offline launch | See Task 3 | Pass |
| Display scaling / negative origins | `tests/desktop/coordinates.test.ts` | Pass (unit-level only; no physical rig) |
| Real hover-to-forecast flow | **Pass** — Bugs 1 & 2 fixed and verified against the real code path | See above; not yet confirmed with a live interactive on-screen run for lack of Screen Recording permission in this session |

## Known issues (not fixed here — out of Part 4 scope, flagged for their owners)

1. **Incomplete rebrand remnants** — `src/shared/contracts.ts` still exports `FlickyBridge`/`window.flicky`; `.env.example` still uses `FLICKY_DATA_MODE`/`FLICKY_SESSION_TOKEN`. Cosmetic/naming only, not functional. Owner of the shared contracts/desktop bridge.
2. **Forecast UI not wired in** — `src/ui/App.tsx`, `ForecastCard.tsx`, `AmountForm.tsx`, `Annotation.tsx` are built and unit-tested but `src/ui/main.tsx` (what actually runs) still uses its own older inline UI and never imports them. The live app shows a simpler card than the spec describes: no bill-reasons list, no dedicated amount editor, a cruder inline annotation. Part 2/UI owner.
3. **Native macOS finance tool unwired** — `macos/cappy/CappyManager.swift` instantiates `CappyFinanceAgentClient()` with its default `tool: nil`, so `CappyFinanceCoordinator.answer(...)` always returns `nil` — the native app currently gives no financial answer at all. This is architecturally clean (no financial claim ships without an authenticated tool result) and resolves a previously-found bug (the old `FlickyFinancialCoordinator.swift`'s broken string interpolation, which this file replaced and deleted), but the feature is presently a no-op pending a real tool being wired in. Native macOS owner.
4. `macos/cappy.xcodeproj` has never been opened/built in Xcode by anyone in this repo's history — only directory-renamed. Open native-build validation gap.

## Demo rehearsal — grounded in what actually runs today

Following `plans/2026-09-12-cursor-financial-bodyguard-demo.md`'s script, adjusted for the current real state (not the aspirational spec UI):

1. **Problem (0:00–0:20):** "A balance tells you what's there now. Cappy previews what a purchase leaves after the bills you already know about." Show the visible `Synthetic demo` mode badge.
2. **Main interaction (0:20–1:10):** Real screen-OCR now works (Bugs 1 & 2 fixed and verified) — arm monitoring, hover the $200 total on `demo/checkout.html`, and let the real capture pipeline extract it. If a live interactive rehearsal hasn't happened yet on the actual device, the always-available manual-entry fallback (typing "Can I afford $200 today?") remains a legitimate backup — say so explicitly rather than pretending to hover if that's what you're doing. Show the −$80 minimum on Sep 16.
3. **Explainability (1:10–1:40):** Ask "Why?" — grounded reply cites rent and utilities by name and date. Retype with $10 — show $110, within-reserve.
4. **Conversation memory (1:40–2:10):** "What about September 20?" — same purchase, projected minimum $120. This exercises the real deterministic router end to end.
5. **Second platform or honest gap (2:10–2:40):** No second device was available this session; say so rather than claiming Windows parity.
6. **Contribution (2:40–3:00):** "Clicky inspired the cursor companion and its native macOS capture/voice stack. We built the purchase forecast engine, the OCR decision rules, the authenticated snapshot service, and the grounded conversation layer on top of it." See `docs/attribution.md` for the full breakdown.

Live Nessie mode is now available as an alternative to Synthetic for this rehearsal (set `FLICKY_DATA_MODE=live-sandbox`) — the seeded demo account mirrors the synthetic fixture exactly, so the numbers in the script above hold either way. Live ElevenLabs remains unverified/uncredentialed (see `docs/provider-contracts.md`). Never substitute a staged transfer or recording for a live integration claim.

## Native macOS note

Clicky's Xcode target is vendored under `macos/cappy/` (renamed from `macos/leanring-buddy/`) and customized with `CappyFinanceCoordinator.swift` for deterministic financial responses plus local Vision OCR, though the finance tool itself is currently unwired (see Known Issues #4). This environment has Command Line Tools but no Xcode GUI validation was performed here. Follow `macos/README.md` and run the target from Xcode so TCC permissions remain valid — do not run `xcodebuild` from Terminal.

## Final handoff

- **Branch:** `Aastha-foundation-financial-engine`, merged through `main` at each of: Cappy rebrand + auth/tools (Abhijith Utla), ElevenLabs voice integration (teammate 3, PR #1), Part 2 capture/OCR/overlay (PR #2), the native macOS finance-only conversion follow-up, and the native global hold-to-talk adapter (`rishi-dev`).
- **Provider availability:** Nessie — implemented and verified live end to end (see above). ElevenLabs — implemented, credentials absent in every checkout so far. Persona — not attempted, entry condition still fails (no verified transfer semantics, no sandbox/template).
- **Measured latency:** 117ms median end-to-end (real OCR+extract+forecast+router), real pipeline, real screenshot, real production code path (no workaround) — see above. Well under the 3s target.
- **Omitted features:** Persona-gated sandbox mitigation (by design, entry condition unmet — no verified transfer semantics or sandbox template). Live ElevenLabs (credential-gated, has a visible typed-input fallback).
- **Fixed this session:** the two OCR bugs that made real screen-hover capture non-functional (`src/desktop/recognize.ts`, `src/desktop/ocr/recognize.ts`) — see above for full diagnosis and verification.
- **Still open, not fixed here:** the 4 known issues above (incomplete rebrand remnants, forecast UI not wired into `main.tsx`, native macOS finance tool unwired, Xcode build never validated).
- **README:** unchanged, confirmed via `git diff origin/main -- README.md` (empty).
- **Plans:** `plans/` is already tracked and visible in the repository (established team practice before this branch); nothing new was added there by this work.
