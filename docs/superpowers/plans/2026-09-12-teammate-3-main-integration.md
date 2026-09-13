# Teammate 3 Main Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate teammate 3's grounded conversation and voice-to-voice behavior into the existing Electron service and cursor UI on remote `main`.

**Architecture:** Preserve the existing `createConversationManager`, Fastify service, preload bridge, and renderer contracts. Add ElevenLabs Scribe v2 as the service-owned transcription provider, keep server-owned reply IDs for TTS, wire providers from environment configuration, and add an explicit hold-to-talk MediaRecorder flow with typed fallback in the existing renderer. The native macOS PeppaPrice target remains outside this Electron integration because it has a separate Swift voice stack and cannot be built on Windows.

**Tech Stack:** TypeScript, Fastify, Zod, Electron, React, Vitest, ElevenLabs HTTP API.

**Spec:** `plans/teammate-3-conversational-cursor.md`, `plans/2026-09-12-conversation-behavior.md`, `plans/2026-09-12-cursor-interaction-design.md`.

## Global Constraints

- Keep API credentials in the service process and never expose them through `PublicConfig`, preload, renderer logs, or committed files.
- Use batch ElevenLabs Scribe v2 transcription after release; do not add realtime streaming as a core dependency.
- Synthesize only a reply already owned by the server-side conversation manager.
- Keep audio in memory, enforce the existing 10 MB and 30 second limits, and preserve typed input when speech is unavailable.
- Preserve deterministic financial facts from the existing conversation manager and domain forecast.
- Make each integration slice independently typecheckable and testable before committing.

---

### Task 1: Add the ElevenLabs Scribe transcription adapter

**Files:**
- Modify: `src/service/providers/speech.ts`
- Test: `tests/conversation/providers.test.ts`

**Interfaces:**
- Consumes: `Uint8Array`, MIME type, recording duration, `ELEVENLABS_API_KEY`.
- Produces: `createElevenLabsTranscriber(...).transcribe(audio, mime, durationMs): Promise<string>` using `POST /v1/speech-to-text` with `model_id=scribe_v2`.

- [x] Add focused coverage for the Scribe multipart request, returned transcript and invalid MIME/size/duration.
- [x] Run the provider test red/green cycle and implement the transcriber with bounded input, deadline handling, `xi-api-key`, multipart `file`, `model_id`, and sanitized provider errors.
- [x] Run the provider tests and then the full test suite.
- [x] Commit as `feat: add ElevenLabs Scribe transcription adapter`.

### Task 2: Wire server-owned speech capabilities

**Files:**
- Modify: `src/service/entry.ts`
- Modify: `src/service/providers/speech.ts`
- Modify: `tests/service/entry.test.ts` or add it if no entry wiring test exists
- Modify: `docs/development.md`

**Interfaces:**
- Consumes: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_STT_MODEL_ID`, `ELEVENLABS_TTS_MODEL_ID`, `ELEVENLABS_TIMEOUT_MS`.
- Produces: service dependencies for `/transcribe` and `/speak`, with truthful public capability flags.

- [x] Add coverage for missing credentials producing disabled speech capabilities and configured credentials producing both providers.
- [x] Wire the existing manager and service routes to ElevenLabs only when the required environment values are present; retain typed fallback otherwise.
- [x] Keep the existing server-owned `replyId` lookup and never accept renderer-provided reply text.
- [x] Document environment variable names and local setup without adding secrets.
- [x] Run typecheck, tests, and build.
- [x] Commit as `feat: wire ElevenLabs speech into the local service`.

### Task 3: Add hold-to-talk voice interaction to the existing cursor UI

**Files:**
- Modify: `src/ui/main.tsx`
- Modify: `src/ui/styles.css`
- Modify: `src/shared/contracts.ts` only if the existing bridge needs a typed voice event
- Test: add focused renderer tests if the current Vitest setup supports the existing Electron bridge boundary

**Interfaces:**
- Consumes: `window.flicky.transcribe`, `window.flicky.turn`, `window.flicky.speak`, `window.flicky.cancel`, and existing state events.
- Produces: explicit pointer/keyboard hold-to-talk, release-to-submit, mute/cancel behavior, spoken answer playback, and typed fallback.

- [x] Add focused coverage for release submitting one turn and a second activation cancelling/barge-in behavior, using a testable recorder/playback boundary.
- [x] Implement in-memory MediaRecorder capture with supported MIME selection, explicit consent, release/Escape cancellation, one submission per press, and bounded duration.
- [x] Feed the transcript through the existing `/turn` route, play only the returned server-owned reply audio, and update `listening`, `thinking`, `speaking`, `clarifying`, and `error` states.
- [x] Keep the existing typed composer available whenever voice permission/provider access is missing.
- [x] Run renderer tests, typecheck and build; record that Electron GUI and native macOS smoke tests require a host environment.
- [x] Commit as `feat: add hold-to-talk cursor voice flow`.

### Task 4: Final integration verification and handoff

**Files:**
- Modify: `docs/verification.md`
- Modify: `docs/implementation-status.md`

- [x] Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, and `git diff --check`.
- [ ] Run one live service smoke test with credentials supplied only through the process environment, then remove the environment values from the shell; blocked because this checkout has no ElevenLabs credentials.
- [x] Review the final diff for credentials, generated artifacts, unrelated changes, and stale capability claims.
- [ ] Commit as `docs: record teammate 3 integration verification`.
- [ ] Push the feature branch based on current `main`; do not merge or force-push `main`.

## Known Verification Limits

- Windows is the current host, so native macOS Swift/Xcode build and TCC permission checks cannot be run here.
- The live ElevenLabs check validates the provider path, not microphone hardware or a packaged Electron GUI session.
- The remote main branch has existing native macOS code that should remain unchanged unless a later macOS-specific integration task is explicitly scoped.
