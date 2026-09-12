# Verification record

Verified on Windows with Node/npm:

- `npm test` passes: 16 files, 91 tests.
- `npm run typecheck` passes.
- `npm run build` passes and emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets and local OCR assets.
- `npm run test:e2e` passes the authenticated local service flow.
- Provider unit tests cover ElevenLabs Scribe request construction, validation, timeout/error handling and TTS response handling without logging credentials.

Known gates: no ElevenLabs credentials were present in this checkout, so live provider calls were not run; the Electron GUI, microphone permission prompt and packaged Windows launch still require a local desktop smoke test. Live Nessie remains intentionally disabled.

Native macOS note: Clicky's Xcode target is vendored under `macos/` and customized with local Vision OCR plus deterministic financial responses. This environment has Command Line Tools but no full Xcode build validation was run; follow `macos/README.md` and run the target from Xcode so TCC permissions remain valid.
