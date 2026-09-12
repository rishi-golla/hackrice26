# Verification record

## Automated checks — macOS, Apple Silicon (arm64), Node v22.15.1

| Command | Result |
|---|---|
| `npm install` | Pass. This host's default Node (20.17) is below Electron 40's floor (>=22.12); Node 22.15.1 via nvm is required. |
| `npm run typecheck` | Pass, no errors. |
| `npm test` | Pass — **127/127 tests, 31 files.** |
| `npm run build` | Pass — emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets, bundled OCR language assets. |
| `npm run test:e2e` | Pass — "service e2e passed" (authenticated local service flow). |
| `npm run test:stress` | Pass — 1/1 (concurrent snapshot cache). |
| `npm run dev` (live launch) | Boots cleanly: main process, 2 renderers, GPU/network helpers, local Fastify service. |

**Do not read the above as "the app works end to end."** Every OCR-related test mocks `tesseract.js` entirely (`vi.mock('tesseract.js', ...)`), so a fully green test suite coexists with two confirmed, independent, demo-blocking bugs in the real OCR pipeline — see below. This is exactly the gap Part 4 verification exists to catch.

## Critical: two confirmed bugs make real screen-OCR capture non-functional today

Found by driving the exact production code path end to end against a real screenshot (not a mocked word list) via `scripts/measure-hover-latency.mjs`. Neither is fixed here — both are in `src/desktop/` (Part 2's files) — but both are precisely diagnosed with a reproduction and a confirmed fix shape, so whoever owns them can close this in minutes, not hours.

### Bug 1 — `src/desktop/recognize.ts` poisons tesseract.js's own working default

`createRuntimeWorker()` calls:
```ts
createWorker('eng', 1, { langPath: config.langPath, workerPath: config.workerPath, corePath: config.corePath, logger: () => {} })
```
`config.workerPath`/`config.corePath` are `undefined` on every real call — `main.ts` calls `recognize(frame)` with no options at all. tesseract.js merges options as `{...defaultOptions, ..._options}`; because the key `workerPath` is *explicitly present* (even though its value is `undefined`), the spread overwrites tesseract.js's own correct built-in default (`node_modules/tesseract.js/src/worker/node/defaultOptions.js`) instead of leaving it alone. The result: `new Worker(undefined)` throws immediately —
```
TypeError [ERR_INVALID_ARG_TYPE]: The "filename" argument must be of type string or an instance of URL. Received undefined
```
**Confirmed via isolated A/B test:** passing `{ workerPath: undefined }` explicitly fails; omitting the key entirely succeeds. **Fix:** only include `workerPath`/`corePath` in the options object when they are actually defined (e.g. spread conditionally, or use `Object.fromEntries` filtering `undefined`), rather than always including the keys.

### Bug 2 — `src/desktop/ocr/recognize.ts` reads a `data.words` field that no longer exists

`PersistentOcrRecognizer.recognize()` calls `worker.recognize(frame.png)` with no third (output-format) argument, then `mapWords()` reads `result.data.words`. The installed `tesseract.js@^6.0.0` returns `data.words === undefined` by default — confirmed by direct inspection of a real recognition result. Word-level boxes only exist under `data.blocks[].paragraphs[].lines[].words[]`, and only when you explicitly call `worker.recognize(image, {}, { blocks: true })`. Every real call throws `OcrRecognitionError('invalid-result', 'OCR returned no word data')`, independent of Bug 1. Every unit test for this file mocks `worker.recognize()` to directly hand back a fake `data.words` array, so this was invisible to `npm test`.

**Fix, confirmed working** (used to produce the real latency numbers below, applied only inside the benchmark script — not committed to `src/desktop/ocr/recognize.ts`):
```js
const result = await worker.recognize(image, {}, { blocks: true });
// then walk result.data.blocks[].paragraphs[].lines[].words[], each with
// { text, confidence, bbox: {x0,y0,x1,y1} } — map bbox to the existing Rect shape
// and derive lineId from a unique block/paragraph/line index tuple.
```

**Net effect today:** hovering a real purchase and triggering screen capture will throw, not silently degrade — the app's `catch` path in `main.ts` surfaces "Screen analysis failed. Enter the price instead." and falls back to manual entry, so the app doesn't crash, but the headline "cursor reads your screen" feature does not work. This is the single highest-priority fix for whoever owns Part 2/`src/desktop/` before any demo.

## Measured latency (real pipeline, real screenshot, both bugs worked around locally)

Produced by `npm run bench:hover` (`scripts/measure-hover-latency.mjs`), which bundles the actual production modules — `src/desktop/extract.ts`, `src/domain/forecast.ts`, `src/service/conversation/controller.ts` — with esbuild and runs them under plain Node (matching the packaged app's runtime shape; Vitest's own worker-thread sandbox breaks tesseract.js's Node worker spawning, so this could not be run as a `*.test.ts` file). OCR itself uses real `tesseract.js` recognition with the Bug 2 workaround applied locally in the script only. Fixture: `tests/fixtures/checkout.png`, a real headless-Chromium screenshot of `demo/checkout.html` (`npm run bench:fixture`), not a synthetic word list. 5 runs:

| Stage | Median | Max |
|---|---|---|
| OCR (real tesseract.js recognize, incl. first-run cold start) | 115.3ms | 156.7ms |
| Extract (image-to-desktop coordinate + candidate logic) | 0.3ms | 1.4ms |
| Forecast (deterministic domain engine) | 0.3ms | 11.1ms |
| Router + grounded reply (deterministic, no hosted LLM) | 0.3ms | 1.1ms |
| **End-to-end** (excludes real screen capture + speech) | **116.0ms** | **170.2ms** |

Recognized amount: **$200.00, correct**, from the real "Order total: $200.00" text in the screenshot. Result: **well under the plan's <=3s target** — OCR dominates completely; forecast/router are effectively free. Not included: the 700ms dwell timer and the real `desktopCapturer` screen grab (both need a live Electron window with granted Screen Recording permission — blocked in this automation session, see Task 1 below) and ElevenLabs speech transcribe/synthesize latency (no credentials in this checkout — see `docs/provider-contracts.md`).

## Task 1 — cross-platform feasibility matrix

| Capability | macOS (this session) | Windows |
|---|---|---|
| Toolchain / dev shell launches | **Pass** — `npm run dev` builds and boots Electron (main, 2 renderers, GPU helper, local service) | Unverified here, but teammate 3's own report confirms shared/unit tests and `test:e2e` pass on Windows (Node 24.19.0) — GUI itself not launched by them either |
| Passive overlay / interactive card, real pointer behavior | **Blocked in this automation session** — no macOS Screen Recording/Accessibility permission granted to this shell, so `screencapture`/`osascript` can't confirm the on-screen card visually. Process-level evidence (main + 2 renderers alive, clean shutdown) confirms no crash | Not attempted |
| Selected-display capture + OCR | **Fails — see Bugs 1 & 2 above**, independent of any permission issue | Not attempted |
| Denied-permission recovery | Not exercised | Not attempted |
| Global hold-to-talk (⌘⇧Space) | Registered without error at startup (`config.shortcutAvailable`); press/release not interactively exercised | Not attempted |
| 100/125/200% scaling, negative origins | Covered by unit tests (`tests/desktop/coordinates.test.ts`); no physical multi-monitor/scaled rig tested | Not attempted |
| Harmless Nessie read | **Blocked** — no live adapter exists at all; see `docs/provider-contracts.md` | N/A |
| Speech request (ElevenLabs) | **Blocked** — no credentials in this checkout; provider code is unit-tested but never called live | Same, per teammate 3's report |
| Schema-only router request | **Pass** — deterministic router, measured above at 0.3ms median | Same |
| Packaged offline launch | **Pass** — see Task 3 | Not attempted (no artifact built, no device) |

**Summary:** macOS toolchain, build, and packaging all pass. Real screen-OCR fails on any platform for the code reasons above, not a permission or platform issue — fixing Bugs 1 & 2 is a prerequisite to a working core demo on either OS. Live Nessie, live ElevenLabs, and Windows interactive testing remain blocked for lack of credentials/hardware, each with a working fallback (synthetic mode, typed input).

## Task 2 — Persona sandbox mitigation: skipped, recorded as omitted

Entry condition ("verified Nessie transfer semantics exist, Persona sandbox/template exists, at least four hours remain") fails on its first clause — no live Nessie adapter exists (see `docs/provider-contracts.md`) — so per the plan's own instruction this task is skipped outright. No `src/service/providers/persona.ts` or `src/service/actions/*` files were created; none are required for the core demo.

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
| Hover $200 final total → −$80 on Sep 16 | `tests/domain/forecast.test.ts` (canonical fixture) + real OCR benchmark above, both agree: $200 purchase → minimum −$8000 cents on 2026-09-16 |
| Change amount to $10 → $110, within-reserve | `tests/domain/forecast.test.ts` | Pass |
| Remove utilities, $200 → $0, below-reserve (never "negative") | `tests/domain/forecast.test.ts` | Pass |
| Already-negative baseline explained | `tests/domain/explain.ts` reasons; covered by domain tests | Pass |
| API unavailable → stale/incomplete, never silent | `tests/service/snapshot.test.ts` (60s cache, `allowStale` gate) | Pass |
| Cursor conversation (follow-up date, "both", explain, forget) | `tests/conversation/conversation.test.ts` (cases A–N from the design doc) | Pass |
| Cancellation / turn generation | `tests/desktop/pipeline.test.ts`, `tests/service/session.test.ts` | Pass |
| Packaged offline launch | See Task 3 | Pass |
| Display scaling / negative origins | `tests/desktop/coordinates.test.ts` | Pass (unit-level only; no physical rig) |
| Real hover-to-forecast flow | **Fails today** — see Bugs 1 & 2 | Documented above, not silently marked pass |

## Known issues (not fixed here — out of Part 4 scope, flagged for their owners)

1. **OCR pipeline non-functional** — Bugs 1 & 2 above. Part 2/`src/desktop/`.
2. **Incomplete rebrand remnants** — `src/shared/contracts.ts` still exports `FlickyBridge`/`window.flicky`; `.env.example` still uses `FLICKY_DATA_MODE`/`FLICKY_SESSION_TOKEN`. Cosmetic/naming only, not functional. Owner of the shared contracts/desktop bridge.
3. **Forecast UI not wired in** — `src/ui/App.tsx`, `ForecastCard.tsx`, `AmountForm.tsx`, `Annotation.tsx` are built and unit-tested but `src/ui/main.tsx` (what actually runs) still uses its own older inline UI and never imports them. The live app shows a simpler card than the spec describes: no bill-reasons list, no dedicated amount editor, a cruder inline annotation. Part 2/UI owner.
4. **Native macOS finance tool unwired** — `macos/cappy/CappyManager.swift` instantiates `CappyFinanceAgentClient()` with its default `tool: nil`, so `CappyFinanceCoordinator.answer(...)` always returns `nil` — the native app currently gives no financial answer at all. This is architecturally clean (no financial claim ships without an authenticated tool result) and resolves a previously-found bug (the old `FlickyFinancialCoordinator.swift`'s broken string interpolation, which this file replaced and deleted), but the feature is presently a no-op pending a real tool being wired in. Native macOS owner.
5. `macos/cappy.xcodeproj` has never been opened/built in Xcode by anyone in this repo's history — only directory-renamed. Open native-build validation gap.

## Demo rehearsal — grounded in what actually runs today

Following `plans/2026-09-12-cursor-financial-bodyguard-demo.md`'s script, adjusted for the current real state (not the aspirational spec UI):

1. **Problem (0:00–0:20):** "A balance tells you what's there now. Cappy previews what a purchase leaves after the bills you already know about." Show the visible `Synthetic demo` mode badge.
2. **Main interaction (0:20–1:10):** Because real screen-OCR is currently broken (Bugs 1 & 2), demo the manual-entry fallback honestly: type "Can I afford $200 today?" in the composer instead of hovering the checkout page. This is a real, working, always-available path (`window.flicky.turn`), not a staged substitute — say so explicitly rather than pretending to hover. Show the −$80 minimum on Sep 16.
3. **Explainability (1:10–1:40):** Ask "Why?" — grounded reply cites rent and utilities by name and date. Retype with $10 — show $110, within-reserve.
4. **Conversation memory (1:40–2:10):** "What about September 20?" — same purchase, projected minimum $120. This exercises the real deterministic router end to end.
5. **Second platform or honest gap (2:10–2:40):** No second device was available this session; say so rather than claiming Windows parity. If Bugs 1 & 2 are fixed before the real demo, this is exactly where to switch to the real hover-and-capture flow instead of typed fallback.
6. **Contribution (2:40–3:00):** "Clicky inspired the cursor companion and its native macOS capture/voice stack. We built the purchase forecast engine, the OCR decision rules, the authenticated snapshot service, and the grounded conversation layer on top of it." See `docs/attribution.md` for the full breakdown.

Use only Synthetic mode for this rehearsal — Live Nessie and live ElevenLabs are both disabled/unverified (see `docs/provider-contracts.md`). Never substitute a staged transfer or recording for a live integration claim.

## Native macOS note

Clicky's Xcode target is vendored under `macos/cappy/` (renamed from `macos/leanring-buddy/`) and customized with `CappyFinanceCoordinator.swift` for deterministic financial responses plus local Vision OCR, though the finance tool itself is currently unwired (see Known Issues #4). This environment has Command Line Tools but no Xcode GUI validation was performed here. Follow `macos/README.md` and run the target from Xcode so TCC permissions remain valid — do not run `xcodebuild` from Terminal.

## Final handoff

- **Branch:** `Aastha-foundation-financial-engine`, merged through `main` at each of: Cappy rebrand + auth/tools (Abhijith Utla), ElevenLabs voice integration (teammate 3, PR #1), Part 2 capture/OCR/overlay (PR #2), and the native macOS finance-only conversion follow-up.
- **Provider availability:** Nessie — unavailable/unverified (403 during planning, no adapter built). ElevenLabs — implemented, credentials absent in every checkout so far. Persona — not attempted, entry condition fails.
- **Measured latency:** 116ms median end-to-end (OCR+extract+forecast+router), real pipeline, real screenshot — see above. Well under the 3s target once Bugs 1 & 2 are fixed.
- **Omitted features:** Persona-gated sandbox mitigation (by design, entry condition unmet). Live Nessie and live ElevenLabs (credential-gated, both have visible synthetic/typed fallbacks).
- **Blocking for a working core demo:** Bugs 1 & 2 above must be fixed in `src/desktop/recognize.ts` and `src/desktop/ocr/recognize.ts` before real screen-hover capture will work on either OS.
- **README:** unchanged, confirmed via `git diff origin/main -- README.md` (empty).
- **Plans:** `plans/` is already tracked and visible in the repository (established team practice before this branch); nothing new was added there by this work.
