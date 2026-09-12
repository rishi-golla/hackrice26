# Verification record

Verified on macOS 15.3.1 arm64 with Node 23.11.0:

- `npm run typecheck` passes.
- `npm run build` passes and emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets and local OCR assets.
- Domain, service, coordinate, OCR, pipeline and conversation tests are included under `tests/`.

Known gates: live Nessie contract and credentials are unavailable; AssemblyAI, ElevenLabs and Anthropic remain explicit unavailable adapters; Windows launch, scaling and permission smoke tests require a Windows device; Electron GUI smoke test still needs a local desktop run.
