# Conversational cursor — cross-platform feasibility plan

Status: planning only. Private local document; never commit or publish this file.

## Objective

Validate the few platform dependencies that could invalidate the 24-hour build before implementing the full product. This is the execution guide for implementation Task 1 and later packaged smoke tests. Target macOS and Windows; record exact OS, CPU architecture, Electron/Node versions and permission state. README must remain unchanged unless the user later authorizes edits.

No probes have been executed by writing this plan. Each probe produces a local evidence row: device, command/build, steps, observed result, pass/fail/blocked, elapsed time and fallback decision. Official API/version compatibility must be checked during execution; no support claim is based on this document alone.

## Two-hour initial budget

| Budget | Probe | Required evidence |
|---|---|---|
| 0–15 min | Toolchain and device inventory | Both target devices identified; native build/test access recorded |
| 15–35 min | Passive surface and normal pointer | Click-through overlay and interactive bubble work without stealing focus |
| 35–55 min | Selected-display capture and permissions | Correct image; denied permission has manual fallback |
| 55–80 min | Global hold-to-talk | Key press/release delivered while another app has focus; mic actually stops |
| 80–95 min | DPI/coordinates | Correct label placement on Retina/125% display and negative origin |
| 95–110 min | Provider access | Harmless Nessie read; speech and structured router request; no financial write |
| 110–120 min | Decision record | Pass/fail/blocked per capability; revised order and explicit limitations |

If both devices cannot be tested in this window, continue independent domain work but keep platform validation blocked. Never replace a missing Windows device test with a successful macOS build claim.

## Probe 1: Toolchain and packaging direction

- [ ] Check installed Node version and compiler tools without installing arbitrary dependencies first.
- [ ] Check chosen Electron stable release's officially supported OS floors and architecture targets.
- [ ] Identify a Windows machine for interactive smoke testing; a build runner alone cannot validate microphone/overlay behavior.
- [ ] Build a minimal dev shell on each OS when implementation starts. Log reproducible launch command and actual result.

Pass: shell launches on both target devices. Fallback: supported native runner for build plus actual device test later. If unavailable, flag Windows unverified and continue shared logic; retain Windows as an unmet requirement.

## Probe 2: Overlay and pointer behavior

- [ ] Create transparent, frameless, non-focusable passive window and separate interactive bubble.
- [ ] Put a small marker beside the native pointer. Never hide, replace or warp the pointer.
- [ ] Click buttons, drag a window, select text and scroll beneath passive surface in two ordinary applications.
- [ ] Open/close bubble explicitly and verify focus returns predictably; no focus stealing on passive preview.
- [ ] Test selected-display edge behavior and moving the pointer off the selected display.

Pass: passive surface intercepts zero user clicks; bubble can be interacted with; native cursor remains functional. Fallback: simplify effects/window topology, not pointer input semantics. Native exclusive fullscreen/protected content remain outside core support.

## Probe 3: Capture and permission recovery

- [ ] Capture selected display by its ID; verify against visible test text on that display.
- [ ] Deny screen permission and verify a clear manual-entry path without repeated permission loops.
- [ ] Grant permission through normal OS settings and retry; record whether relaunch is needed.
- [ ] Hide overlays during capture and restore in finally; verify output does not contain its own prior answer.
- [ ] Confirm no screenshots are persisted or sent to an external service in the core pipeline.

Pass: usable selected-display capture and denied-permission recovery. Fallback: manual amount entry remains available and screen context is clearly unavailable; do not claim OCR is working. Do not bypass OS permission prompts.

## Probe 4: Global activation and microphone

- [ ] Check current APIs of a narrowly scoped native hotkey adapter for both key-down and key-up, including native dependency packaging.
- [ ] Use configurable Control+Shift+Space only after collision checks. Test while a browser/editor has focus.
- [ ] Verify repeat key-down does not create multiple recordings; key-up ends actual microphone capture.
- [ ] Test Escape, 30-second cutoff, lock/suspend, permission revocation and process exit.
- [ ] Inspect adapter behavior to ensure it does not log unrelated typed keys. Request only permissions actually required.
- [ ] Test spoken reply playback, mute and interruption by a fresh activation.

Pass: reliable hold/release and cleanup on both platforms. Fallback: clearly labeled toggle-to-talk with manual stop, hard timeout and cleanup; mark hold-to-talk unfulfilled on that platform. Typed bubble is a second recovery path; it does not count as a successful voice demo.

## Probe 5: Coordinates and local OCR

- [ ] Capture known labeled boxes at 100%, 125% and Retina-like scale using available real configurations.
- [ ] Map image pixels using actual image width/height and selected display bounds; avoid scale-factor multiplication twice.
- [ ] Verify negative desktop origins with unit tests and a physical configuration where available.
- [ ] Run local OCR on one bundled synthetic checkout screenshot and one captured local checkout page.
- [ ] Record recognition confidence, amount, label box and latency; do not log unrelated screen text.

Pass: highlighted recognized label matches visible label with <=6 DIP edge error on tested fixtures, amount correct or explicitly uncertain, bubble stays within work area. Fallback: card-only response when location is uncertain; manual amount when total uncertain. No guessed button outline.

## Probe 6: External access

- [ ] Nessie: use official accessible contract and supplied key for a harmless read. Record sanitized schema, statuses, recurrence and balance meaning. Never guess endpoint details.
- [ ] Speech: transcribe a short explicit test utterance with the user's configured provider; verify retention settings and upload consent.
- [ ] Router: ask for a schema-valid read-only intent with synthetic purchase context; reject extra fields and tool names.
- [ ] Persona: only inspect sandbox/template availability if attempting the optional task later. No real identity flow or financial execution in this probe.

Pass: documented read contracts and functioning voice/router configuration. Fallback: explicit Synthetic demo for Nessie; typed deterministic subset for speech/router, with conversation marked incomplete. Do not quietly simulate provider success.

## Final native packaging gate (reserved hours 20–24)

- [ ] Bundle renderer, preload, child service, native hotkey modules and OCR language/worker assets.
- [ ] Build on supported native targets; launch packaged artifacts on actual macOS and Windows devices.
- [ ] Launch without the development server; test synthetic OCR offline with assets already bundled.
- [ ] Confirm no secrets or planning-only notes are accidentally bundled into packaged artifacts or generated public docs.
- [ ] Verify cleanup of workers, service, windows and mic on quit/restart.
- [ ] Replay interaction and conversation acceptance cases from the companion plans.
- [ ] Record five hover and three voice runs per device; separate OCR latency from hosted-service latency.

Signing/notarization and broad OS support claims are outside the demo scope. Record exact tested versions and launch requirements in a separately authorized delivery document; do not edit README now.

## Decision rule

Continue when core device capabilities work or a clearly labeled fallback still supports useful independent work. If a capability fails, time-box one targeted recovery, then document the failure and protect the deterministic engine/primary demo. Do not spend the remaining build window pursuing optional Persona while core voice or cursor behavior is unverified. No code is authorized by this planning document itself.

## Local privacy and README constraint

This file is part of the visible plan set at `plans/`; keep it aligned with implementation and do not edit README unless requested.
