# Attribution

The native applications include inherited MIT-licensed desktop infrastructure. The original copyright and permission notice are preserved in [THIRD_PARTY_NOTICES.txt](../THIRD_PARTY_NOTICES.txt).

**Reused native infrastructure (MIT):** ScreenCaptureKit screen capture, the menu-bar app lifecycle, the global push-to-talk event tap, AVAudioEngine audio capture/conversion, streaming transcription plumbing, AppKit overlay window behavior, and cursor motion tracking.

**Original work built for this project:** the deterministic integer-cent forecast/scenario engine (`src/domain/`), OCR purchase-candidate extraction and confidence rules (`src/desktop/ocr/`), the authenticated local snapshot/forecast service and its Fastify contracts (`src/service/`), the conversation session/router/controller (`src/service/conversation/`), the forecast card and annotation UI (`src/ui/`), `CappyFinanceCoordinator.swift`/`CappyManager.swift` and the rest of the native Cappy-specific behavior in `macos/cappy/`, the Cappy local auth/session/profile/tool-policy layer (`src/service/auth.ts`, `session.ts`, `profile.ts`, `tools.ts`, `model.ts`), the ElevenLabs speech integration, the synthetic checkout demo page, and all packaging/verification work in this document set.

**Not implemented in this build:** live Nessie integration, Persona-gated sandbox mitigation, and any real financial write. See `docs/provider-contracts.md` and `docs/verification.md` for exact status and reasoning.

Review the hackathon's official rules and sponsor-track requirements before submission; this document does not itself establish eligibility.
