# AGENTS.md - leanring-buddy (Main App Target)

## Source Files

### FloatingSessionButton.swift
- `FloatingSessionButtonManager` — `@MainActor` class managing the `NSPanel` lifecycle
  - `showFloatingButton()` — Creates/shows the panel in top-right of primary screen
  - `hideFloatingButton()` — Hides panel (keeps it alive for quick re-show)
  - `destroyFloatingButton()` — Removes panel permanently (session ended)
  - `onFloatingButtonClicked` — Callback closure, set by ContentView to bring main window to front
  - `floatingButtonPanel` — Exposed `NSPanel` reference for screenshot exclusion
- `FloatingButtonView` — Private SwiftUI view with gradient circle, scale+glow hover animation, pointer cursor

### ContentView.swift
- Receives `FloatingSessionButtonManager` via `@EnvironmentObject`
- `isMainWindowCurrentlyFocused` — Tracks main window focus state
- `configureFloatingButtonManager()` — Wires up the click callback
- `startObservingMainWindowFocusChanges()` — Sets up `NSWindow` notification observers
- `updateFloatingButtonVisibility()` — Core logic: show if running + not focused, hide otherwise
- `bringMainWindowToFront()` — Activates app and orders main window front

### ScreenshotManager.swift
- `floatingButtonWindowToExcludeFromCaptures` — `NSWindow?` reference set by ContentView
- `captureScreen()` — Matches the floating window to an `SCWindow` and excludes it from capture filter

### leanring_buddyApp.swift
- Owns `FloatingSessionButtonManager` as `@StateObject`
- Injects it into ContentView via `.environmentObject()`

### FlickyResearch.swift
- `FlickyResearch` owns bounded specialist planning, concurrent findings, cancellation generations, and the nonactivating evidence panel.
- `FlickySpecialistFlightView` renders split, orbit, and recall in an independent click-through panel using real request lifecycle timestamps, respecting Reduce Motion. Completed status remains in the evidence sheet.
- `FlickyEvidenceView` renders only Nessie snapshot values and explicit calculations with endpoint sources and observation time.
- No production mock fallback. Retired dashboard/simulation markers cannot open the legacy dashboard.

### RealtimeVoiceClient.swift
- Reads the private per-installation configuration from Application Support/Flicky/realtime.json.
- Sends captured audio directly to OpenAI Realtime and plays returned PCM deltas; input transcription is for display/history only.
- A new turn or Stop cancels all pending connection, audio, playback, and research work. Only completed turns enter history.
- `CompanionManager.researchForRealtime` exposes existing Claude/evidence/shopping behavior as a bounded research tool.

## Nessie provenance inspector

`NessieConnectionPanel.swift` exposes actual customer/account discovery and the latest refresh’s redacted API responses. Never present locally recorded logs as independent attestation or sandbox identity as a real bank link. Customer account ownership must be checked before selecting an account. See `../../docs/nessie-judge-demo.md` for independent verification.
