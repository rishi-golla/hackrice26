# Architecture

The cross-platform Electron baseline remains available. The primary macOS path now vendors Clicky's MIT-licensed native menu-bar target under `macos/leanring-buddy/`. Clicky owns ScreenCaptureKit, the global push-to-talk event tap, AVAudioEngine, streaming transcription, AppKit overlay windows, cursor motion, and generic Claude/TTS chat. `FlickyFinancialCoordinator.swift` intercepts financial turns, performs local Vision OCR, and uses deterministic forecast output with local macOS speech.

The local Fastify child process exposes a short-lived bearer-protected loopback API. It validates account, session and payload schemas before calling the pure forecast engine. Tesseract runs locally with bundled English assets; OCR output is reduced to candidate amount and boxes before conversation routing.

Financial writes and Persona actions are intentionally absent from this baseline. Synthetic and recorded modes stay visibly labeled. Windows packaging is configured but not verified on Windows hardware in this session.
