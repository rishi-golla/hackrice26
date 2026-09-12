# Architecture

Electron main process owns windows, display capture, cursor sampling, permissions and service lifecycle. A click-through passive window renders Flicky's halo and warning annotations. An interactive window renders the anchored forecast card and typed conversation.

The local Fastify child process exposes a short-lived bearer-protected loopback API. It validates account, session and payload schemas before calling the pure forecast engine. Tesseract runs locally with bundled English assets; OCR output is reduced to candidate amount and boxes before conversation routing.

Financial writes and Persona actions are intentionally absent from this baseline. Synthetic and recorded modes stay visibly labeled. Windows packaging is configured but not verified on Windows hardware in this session.
