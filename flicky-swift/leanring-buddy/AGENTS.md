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
- Verify actual retailer pages before adding any basket line or alternative: direct link, photo, positive USD price and explicit in-stock status required. Match actual product titles to the requested category; omit unmatched categories rather than placeholder rows. Failed refresh removes affected products; old saved placeholders are pruned on load. Refresh stale prices automatically; never show a Check products action.
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

### Subscriptions.swift / SubscriptionPanel.swift / SubscriptionCancellation.swift
- Track user-added real subscriptions separately from Nessie recurring-bill candidates. Require classification; never count every bill as a subscription or imply exhaustive real-account discovery.
- Recorded dates can be edited; no invented recurrence. Keep local decisions and receipts account-isolated and owner-only. Publish cancellation changes only after persistence succeeds; interrupted jobs need review.
- SUBSCRIPTIONS opens review from voice/text. Only the panel's explicit provider-account confirmation starts the bounded browser cancellation runner, not a model response tag.
- Keep exact DOM identities local. Send sanitized descriptions and host-only destinations to the planner, never form values, raw URL paths, cookies, or credentials. Models select observed control IDs, never executable code.
- Verify an actual provider cancellation statement before saving a receipt. Pause for login/MFA/CAPTCHA, unsupported controls, fees, new terms, and cross-host steps. No real cancellation from sandbox bill records. Email fallback prepares a draft; outbound mail is not connected.
- Validate with `../scripts/checks/run-subscription-checks.sh`; injected HTML/browser fixtures must never alter a real subscription. Build the full app in Xcode.

## Credit demo UI update

`CreditBorrowingRequest` in CreditSimulation.swift routes natural borrowing requests from typed input, voice transcripts, and the Realtime research callback. Open the existing comparison directly with amount/months/requested APR before screenshot/account/model analysis. Keep shopping, balance, and explicit issuer-site navigation out of this route. Requested terms are transient; account/session changes clear them. Show a hypothetical no-fee payment only when amount, term, and requested APR are present; published bank examples are not personalized offers. Tests live in CreditSimulationCheck.swift.

The current CreditSimulationPanel.swift replaces score/income/options forms with a local dummy-SSN entry (000 prefix only) and a compact stacked bank carousel. Clear the dummy entry on continuation; never send or save it. This is simulated access, not authentication or a credit pull. Cards show sourced published examples, official bundled logos, green positives and coral negatives, with bank-term links. Existing engine/history code is retained but unused by this UI. See design/credit-simulation.md (from the app target: ../design/credit-simulation.md). This supersedes older descriptions of the credit UI above.

### Subscription demo records
The explicitly selected demo customer (SubscriptionStore.demoCustomerID) receives three persisted, source=demo subscriptions with official bundled icons. Spotify starts three days from first seeding; dates and decisions never reset on reopen. Keep and Cancel in demo are local only; mock records must never enter the real cancellation runner. Renewal context includes days remaining and provider URLs, with mock provenance. Other customers receive no mock records. See design/subscriptions.md.

Credit options use a 560 × 650-point, non-scrolling stacked carousel headed “Meet your options”. The active card comes forward; inactive cards stay faded behind and are excluded from accessibility/hit testing. Previous/next and arrow keys wrap around; Reduce Motion disables the spring transition. No product logo, top demo badge, subtitle, or bottom comparison banner; preserve the published-APR labels and official terms links.

### Guided cancellation update
Cancel now opens the saved provider in the embedded browser immediately and starts navigation for one named service. CANCEL_SUBSCRIPTION tags route voice/research requests to this same flow. Only unambiguous account/settings/billing navigation labels can be clicked automatically. Cancellation, confirmation and ambiguous actions are scrolled into view and outlined in mint for the user to click. Continue resumes after sign-in or a manual step. Guidance never writes cancellation state or receipts, and cannot enter the legacy confirmed cancellation runner. Sample-record provenance remains in Data sources and model context; action labels are plain Keep and Cancel. This supersedes earlier Cancel in demo and UI confirmation-button descriptions. Local browser fixtures verify navigation, highlighting and no cancellation submission.

### Four credit options
The credit carousel now has four lenders: SoFi, Wells Fargo, American Express, and U.S. Bank. Preserve 448 × 486-point cards and the existing colors. A local editable Example score (default 720) drives transparent illustrative APR calculations, with monthly payment and total interest; a requested APR overrides that rule. Missing amounts/terms use labeled $8,000 / 36-month examples. Published ranges and official terms links remain; score-based results are teaching scenarios, not personalized offers or retrieved credit scores. The comparison is transient, with no history writes. See design/credit-simulation.md for sources, assumptions, and logo attribution. This supersedes the earlier two-bank/published-only UI description.

### Screen-control indicator
ScreenControlGlow.swift (~100 lines) owns a click-through pink edge/corner glow on every display, independent of pet visibility. Active-source ownership prevents overlapping operations from hiding each other. Subscription running state clears on pause, highlight handoff, Stop, failure or completion. Browser/product launches give brief feedback; cursor flight owns the glow only while moving toward a target. Screen changes recreate active overlays; Reduce Motion removes fades. Own-app screenshot exclusion also excludes the glow. ScreenControlGlowCheck.swift covers ownership/transparent center/hit testing; SubscriptionBrowserCheck verifies handoff ends control activity.

### Credit copy refinement
Routine UI and speech avoid demo/mock/sandbox/simulation narration. Credit cards say Estimated APR and Credit score, with a compact estimates-exclude-fees note and official terms links. Local starting values remain 720 / $8,000 / 36 months, not retrieved customer facts; score help explains the starting value. The manual screen is Access code (000 prefix), not an SSN or credit pull; validation checks format only. Keep accurate internal provenance and answer source questions honestly. This supersedes prior visible demo labels and dummy-SSN UI copy.

### Account evidence layout
FlickyResearch presents the account evidence panel centered on the active screen, up to 560 × 740 points (460 high for unavailable data), clamped to the visible screen with 20-point margins. FlickyEvidenceView uses 32-point insets, 24-point metric spacing, a smaller header icon, and a section picker when multiple metrics are available. One metric is displayed at a time; overflow remains accessible with hidden scroll indicators. Keep source details in help text and preserve all original calculations. Render verification: EvidencePanelCheck.swift.

### Realtime research scheduling
RealtimeResearchQueue.swift serializes and deduplicates calls, waiting for response.done before executing the batch and returning every output before one continuation. Stop clears both the task reference and per-turn queue; generation guards block stale results. Up to eight research calls may start within 90 seconds of the first call. Exhausted or malformed requests return explicit tool results, then tool_choice=none produces an answer using existing evidence; never claim skipped actions succeeded. The total turn watchdog is 300 seconds. Validate with RealtimeResearchQueueCheck.swift and RealtimeVoiceCheck.swift --multi (live synthetic three-step test, no microphone).

### Main account panel layout
CompanionPanelView (the primary PeppaPrice account panel, not FlickyEvidenceView) is a non-scrolling 560 × 780-point canvas with 32-point insets. MenuBarPanelManager centers it on the status item's screen and scales the entire canvas uniformly to fit 20-point screen margins. Preserve neutral charcoal styling, the compact bank/customer row, centered balance, simple upcoming-bills action, and persistent question field. Connection provenance remains available through the info button; account switching remains in the account menu. Never reintroduce a ScrollView or intrinsic-height negotiation in this panel.

### Main panel fit and response placement
CompanionPanelLayout shares a 600-point width. The SwiftUI content reports its intrinsic height to NSPanel, so the footer follows the content without an expanding bottom spacer; responses grow the panel only while present. The 680-point initial height is a bootstrap, not a fixed layout. Preserve the non-scrolling main layout and screen-fit scaling. Responses belong in an inline, bounded region above the question field while the main panel is open; suppress the cursor-following bubble during that time. Long response text may scroll only inside its own region, never over account details, input, or footer. Closing the panel restores the floating response. Header options must stay above sibling content. Keep restrained color accents: coral Capital One mark and mint input/suggestion controls. This records the user's refined request for a card that fits its content with no overlapping or clipped controls.

### Compact panel and Plaid connection
The main panel uses 400-point width, content-driven height and a compact options overlay anchored below its button. Escape dismisses the menu first. PlaidBankConnection.swift adds a local-development Sandbox Hosted Link/Auth flow with unbundled plaid.plist credentials, validated Plaid destinations, masked results and cancellation/customer isolation. It never verifies the selected Nessie account or changes its financial data. No Production endpoint or bundled secret. See design/plaid-connection.md and design/menu-bar-panel.md (from the app target, ../design/). PlaidBankConnectionCheck.swift covers response parsing and boundaries; live verification requires credentials.

### Immediate topic windows
TopicWindowIntent routes typed input, voice transcripts, and Realtime research requests to subscriptions, credit options, the main account dashboard, and the shopping basket before provider research. A topic question is enough; no explicit open verb is required. Respect explicit no-open and website-navigation requests. Multiple topics can open their respective windows. Shopping additions remain SHOP-tag driven, with up to three independent category searches at once, verified retailer-page reads, relevance matching, and automatic local basket additions. Never equate basket additions with payment or merchant orders. Credit checks cover local routing examples and exclusions.

### Subscription page ownership
Subscription requests show only SubscriptionManager and its existing provider-website guidance. showSubscriptions suppresses and clears FlickyResearch evidence; showMetrics, presentEvidence, and investigate enforce that suppression so planner output and METRIC tags cannot reopen Behind the answer. The next non-subscription topic restores evidence. Subscription records, renewal dates, and cancellation navigation continue through the dedicated subscription flow. ResearchLifecycleCheck verifies suppression and restoration.
