# Flicky macOS target

Flicky now vendors Clicky's MIT-licensed native macOS target under `leanring-buddy/`. This keeps Clicky's tested ScreenCaptureKit capture, menu-bar lifecycle, push-to-talk event tap, audio conversion, streaming transcription, cursor overlay, and AppKit window behavior.

Open the project in Xcode:

```sh
open macos/leanring-buddy.xcodeproj
```

Select the `leanring-buddy` scheme, set a signing team, and run with Cmd+R. Do not run `xcodebuild` from Terminal; macOS TCC permissions can be invalidated. Grant Accessibility, Screen Recording, Screen Content, and Microphone permissions when prompted.

`FlickyFinancialCoordinator.swift` intercepts financial questions after Clicky captures the current display. Vision OCR stays local. It recognizes a final USD total, applies the deterministic 14-day demo forecast, shows the response beside the native cursor, and uses macOS local speech for financial answers. Generic questions continue through Clicky's existing Claude/ElevenLabs worker path.

The `clicky-worker` directory is retained for generic Clicky chat only. Never commit its `.dev.vars` file or provider secrets. Live Nessie and Persona actions remain outside this native integration until their contracts are verified.
