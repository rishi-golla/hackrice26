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

### FlickyPigView.swift
- Shared ImageIO decoder renders the supplied FlickyPig.gif as a transparent winged pet, preserving interior highlights through edge-connected background masking.
- The existing click-through overlay keeps the pet visible in every voice state, with three audio-reactive/activity dots below it and a static Reduce Motion frame.
- The pet is available on launch without account or voice permissions; Show/Hide pet in the panel options persists the existing cursor preference.

### ShoppingBasket.swift / ShoppingBasketPanel.swift
- Shared persistent draft basket; SHOP tags gather multiple product categories, BASKET reopens it, Suggestions can add individual listings.
- Keep query deduplication for model requests separate from URL identity for explicit listing additions.
- Use integer cents for unambiguous USD prices; unknown/range/installment/foreign-currency values do not enter totals. Show partial totals explicitly.
- Verified retailer links/photos/prices come from ProductPageResolver. Search intermediaries and unverified metadata cannot fund checkout. Failed refresh invalidates earlier verification.
- Only the user’s reviewed Pay in sandbox action submits a Nessie demo withdrawal through DemoCheckoutLedger. Preserve persisted UUID replay protection, account ownership, pending/failed states, and observed bank balances. Never claim real bank/Plaid validation.
- ShoppingCheckout animates one task per item and opens actual product URLs; cart and order steps are explicitly simulated. No real retailer payment is submitted. Resume incomplete tasks before finishing; restore the checkout lock before any basket mutation.
- Preserve cancellation checks before applying search results and owner-only local persistence. No fixture inventory in production.

### CreditSimulation.swift / CreditSimulationPanel.swift
- CREDIT opens the dedicated local soft-pull simulation. Never repurpose retired SIMULATE tags or load the synthetic cohort.
- Keep all loan pricing hypothetical, source-dated and auditable; input range validation is not credit verification.
- No SSNs or bureau requests. Use SIM references; never pass simulator inputs to the AI/lenders.
- Optional owner-only history is isolated by Nessie account. Reset transient state on logout/account changes; stale Nessie data must not enter new runs.
- Run `../scripts/checks/run-credit-checks.sh` from the app source directory; full builds use Xcode only.

### Unified voice and demo accounts
- All microphone, typed, and suggestion-button replies use RealtimeVoiceClient with gpt-realtime / marin; no legacy speech fallback. Text input must not open the microphone. Session configuration verifies the returned model/voice; cancellation prevents stale playback.
- PeppaDemoAccount.swift (~20 lines) loads the local seeded-account index. Switching requires live customer/account ownership verification and clears prior conversation/context. The index never supplies financial values.
