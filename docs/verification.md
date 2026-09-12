# Verification record

## Automated checks — macOS, Apple Silicon (arm64), Node v22.15.1

Run against branch `Aastha-foundation-financial-engine` at commit `00cf51d` (merged from `main`: original Electron/domain baseline + Cappy rebrand/auth/tools + teammate 3's ElevenLabs voice integration).

| Command | Result |
|---|---|
| `npm install` | Pass. Note: this host's default Node (20.17) is below Electron 40's floor (>=22.12); Node 22.15.1 via nvm is required. |
| `npm run typecheck` | Pass, no errors. |
| `npm test` | Pass — **104/104 tests, 23 files.** |
| `npm run build` | Pass — emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets, bundled OCR assets. |
| `npm run test:e2e` | Pass — "service e2e passed" (authenticated local service flow). |
| `npm run test:stress` | Pass — 1/1 (concurrent snapshot cache). |

## Packaged macOS build — Task 3

`npm run package:mac` (electron-builder 26.15.3, target `dir`, arch arm64):

- Build succeeded; produced `release/mac-arm64/Cappy.app` (~334 MB, unsigned — `identity: null` is intentional for this demo).
- `Info.plist` confirms correct branding: `CFBundleName`/`CFBundleDisplayName` = Cappy, `CFBundleIdentifier` = `com.abhijithutla.cappy.desktop`, and both `NSMicrophoneUsageDescription`/`NSScreenCaptureUsageDescription` are Cappy-worded.
- Launched the packaged `.app` directly (not `npm run dev`, no dev server, no source checkout dependency) — main process, renderer, GPU helper, network helper, and the local Fastify service (`dist/service.cjs`) all started successfully from inside `app.asar`.
- Searched the unpacked bundle for `ELEVENLABS_API_KEY`, `sk-`, `xi-api-key` — **no credentials found in the artifact.**
- Sent SIGTERM to the main process to simulate quit: all child processes (renderer, GPU helper, network helper, local service) exited with it — no orphaned processes. (This is process-tree evidence, not proof `app.on('before-quit')` itself ran; a real Cmd+Q smoke test is still worth doing interactively.)
- `npm run package:win` — **not run.** No Windows device or runner is available in this environment. Config exists (`win: {target: dir}` in `electron-builder.yml`) but is unexercised.

## Task 1 — cross-platform feasibility matrix

| Capability | macOS (this session) | Windows |
|---|---|---|
| Toolchain / dev shell launches | **Pass** — `npm run dev` builds and boots Electron (main, 2 renderers, GPU helper, local service) | Unverified here, but teammate 3's own report confirms shared/unit tests and `test:e2e` pass on Windows (Node 24.19.0) — GUI itself not launched by them either |
| Passive overlay / interactive card, real pointer behavior | **Blocked in this automation session** — this shell lacks macOS Screen Recording/Accessibility permission, so `screencapture`/`osascript` can't confirm the on-screen card visually. App boots without crashing (confirmed via process list + log output) but the overlay's actual appearance needs a human to look at the real screen | Not attempted |
| Selected-display capture + OCR | Blocked — same permission gap; capture path requires Screen Recording permission granted to the packaged app itself, which is separate from this shell's permissions | Not attempted |
| Denied-permission recovery | Not exercised | Not attempted |
| Global hold-to-talk (⌘⇧Space) | Registered without error at startup (`config.shortcutAvailable`); press/release behavior not interactively exercised in this session | Not attempted |
| 100/125/200% scaling, negative origins | Covered by unit tests ([tests/desktop/coordinates.test.ts](tests/desktop/coordinates.test.ts)); no physical multi-monitor/scaled rig tested | Not attempted |
| Harmless Nessie read | **Blocked** — no live adapter exists in the codebase at all; `src/service/entry.ts` explicitly throws if live mode is selected. Portal returned HTTP 403 during original planning and was never re-verified. | N/A |
| Speech request (ElevenLabs) | **Blocked** — no `ELEVENLABS_API_KEY` in this checkout; provider code path is unit-tested but never exercised live | Same — teammate 3's report confirms no credentials were available on their end either |
| Schema-only router request | Pass — deterministic router covered by tests; no hosted LLM router is currently wired in (intent routing is local/deterministic) | Same |
| Packaged offline launch | **Pass** — see above | Not attempted (no artifact built) |

**Pass/fail/blocked summary:** macOS toolchain, build, packaging, and offline launch all **pass**. Live Nessie, live ElevenLabs, and any Windows-side interactive test are **blocked** for lack of credentials/hardware, not for a code defect — each has a working, visibly-labeled fallback (synthetic mode, typed input, macOS-only demo).

## Known issues found during verification (not fixed — out of Part 4 scope)

1. **Incomplete rebrand** — the product is named "Cappy" everywhere in UI/config, but the Electron bridge itself is still `FlickyBridge`/`window.flicky` ([src/shared/contracts.ts](src/shared/contracts.ts)), and [.env.example](.env.example) still uses `FLICKY_DATA_MODE`/`FLICKY_SESSION_TOKEN`. The Cappy conversion plan's own safety net (`tests/branding/branding.test.ts`) was never written, so this wasn't caught. Belongs to whoever owns the shared contracts/desktop bridge.
2. **Broken spoken/text answer on the native macOS path** — `macos/cappy/FlickyFinancialCoordinator.swift` (lines ~57-61) uses `(amount)`, `(minimum)`, etc. instead of Swift's `\(amount)` string-interpolation syntax; the app would literally speak/print the text "(amount)" instead of a dollar figure. Native macOS isn't owned by any of the four TS-focused parts; flagging for whoever owns `macos/`.
3. **Noisy (non-fatal) startup error** — the passive overlay window unconditionally calls `window.flicky.initial()` on mount ([src/ui/main.tsx:11](src/ui/main.tsx:11)), which the main process rejects because only the card window is authorized ([src/desktop/main.ts:149](src/desktop/main.ts:149)), logging "Unauthorized renderer" every launch. Part 2's file.
4. `macos/cappy.xcodeproj` has never been opened/built in Xcode by anyone in this repo's history — only directory-renamed from `leanring-buddy`. Still an open native-build validation gap.

## Persona (Task 2)

**Skipped, recorded as omitted.** Entry condition requires verified Nessie transfer semantics, which don't exist. No Persona files were created; none are required.

## Native macOS note

Clicky's Xcode target is vendored under `macos/cappy/` (renamed from `macos/leanring-buddy/` in this merge) and customized with `FlickyFinancialCoordinator.swift` for deterministic financial responses plus local Vision OCR. This environment has Command Line Tools but no Xcode GUI validation was performed here. Follow `macos/README.md` and run the target from Xcode so TCC permissions remain valid — do not run `xcodebuild` from Terminal.
