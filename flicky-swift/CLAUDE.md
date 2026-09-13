# Clicky - Agent Instructions

<!-- CLAUDE.md and AGENTS.md are separate files; keep shared product guidance in sync. -->
<!-- AGENTS.md spec: https://github.com/agentsmd/agents.md — supported by Claude Code, Cursor, Copilot, Gemini CLI, and others. -->

## Overview

macOS menu bar companion app. Lives entirely in the macOS status bar (no dock icon, no main window). Clicking the menu bar icon opens a custom floating panel with companion voice controls. Uses push-to-talk (ctrl+option) to capture voice input, transcribes it via AssemblyAI streaming, and sends the transcript + a screenshot of the user's screen to Claude. Claude responds with text (streamed via SSE) and voice (ElevenLabs TTS). A blue cursor overlay can fly to and point at UI elements Claude references on any connected monitor.

AI and voice API keys live on the Cloudflare Worker proxy. The direct Nessie client can load its local key from `~/Library/Application Support/Flicky/nessie.plist`; keep that file owner-only and outside source control. Local Nessie settings override bundle configuration.

## Flicky conversation and voice

The app's spoken personality is defined in `leanring-buddy/FlickyPersonaConfig.swift`, injected by `CompanionManager.buildFlickySystemPrompt`. This Markdown file guides coding agents; it is not loaded by Claude at runtime. Update the Swift persona when changing product behavior.

- Sound like a calm, knowledgeable person having a conversation. Answer first, use contractions and everyday language, and usually keep a voice turn to two to four sentences. Expand when the user needs depth.
- No canned AI openings, constant follow-up questions, report headings, spoken bullet lists, forced slang, or repetitive financial disclaimers. Explain the specific uncertainty or risk where it affects the answer.
- For stocks, distinguish business quality from valuation and general analysis from personal buy/sell advice. Have an evidence-based view; do not invent quotes, earnings, news, returns, credentials, or personal investing experience.
- Be resourceful with actual available evidence and tools. The shopping search is not market/news search. Never claim live research without retrieved results. Explain an access gap briefly and offer a concrete next step.
- Use account balances and bills only when relevant to the decision. Treat Nessie as sandbox data, not the user's production portfolio.
- All speech uses GPT Realtime / Marin with relaxed pacing; the backend sets speed 0.9. Never initialize or fall back to ElevenLabs, AssemblyAI, or system speech in the app flow.
- Preserve the exact action-tag grammar and financial-data safeguards when tuning tone. Human-sounding never means pretending to be human or making up certainty.

## Realtime voice

When `~/Library/Application Support/Flicky/realtime.json` is installed, Control + Option uses native OpenAI speech-to-speech (`gpt-realtime`, `marin`, speed 0.9). The file contains the private backend endpoint and client access token, not an OpenAI API key. GPT Realtime with Marin is the only voice path. Typed questions and suggestion buttons send text into the same Realtime client and receive streamed audio. Missing configuration or service failures display an error; never fall back to ElevenLabs or system speech.

`RealtimeVoiceClient.swift` captures 24 kHz mono PCM16 while the connection opens, streams input, commits on release, and plays audio deltas as they arrive. Transcription is only for the visible/history transcript; it is not an intermediate step used to generate the reply. Pressing the shortcut again or Stop cancels the connection and queued playback. Each turn uses a fresh session with only completed prior turns in history, avoiding unheard responses after interruptions. Recording is capped at 30 seconds; a turn times out after 120 seconds.

The voice model can call `research_financial_question` (at most twice per turn), which uses the existing Claude, screenshot, Nessie evidence, and product-search pipeline. Never send spoken bracket action tags as a substitute for tool calls. It does not gain live stock quotes merely by switching voice providers.

`realtime-worker/` is a separate authenticated Cloudflare Worker. `OPENAI_API_KEY` and `FLICKY_CLIENT_TOKEN` are Worker secrets; `/session` creates 60-second client credentials. Never put either permanent secret in source, Info.plist, logs, or the shipped app. Local `.dev.vars` files are ignored. Deploy with Wrangler from that directory. The existing Claude proxy is unchanged.

Validation: `npm run typecheck` and `node --test tests/worker.test.mjs` in `realtime-worker/`. `scripts/checks/RealtimeVoiceCheck.swift` is a live, billable audio/tool/playback integration check using a synthesized audio fixture instead of the microphone. Build the application using Xcode, not terminal `xcodebuild`.

## Multi-store shopping and demo checkout

`ShoppingBasket.swift` owns the persistent draft basket (24 lines, quantities 1–99). `ShoppingBasketPanel.swift` presents merchant groups, actual product photos, variants/alternatives, exact-product URL import, verification errors, and the fixed summary. `[SHOP: query|quantity]` gathers up to six categories; `[BASKET]` reopens it. Both voice research and typed questions share this behavior.

`ProductPageResolver.swift` follows uniquely identified retailer destinations from Google Shopping and reads the retailer’s JSON-LD Product/Offer metadata or Walmart’s primary product data. Product identity must match the requested page; recommendations, ambiguous/foreign/expired prices, and unresolved links cannot be marked verified. OG title/image alone cannot prove a price. Failed refresh invalidates prior verification; checkout requires a recent verified USD price and retailer photo, and rejects published out-of-stock status. Search prices are provisional.

`ShoppingCheckout.swift` implements a clearly labeled **sandbox-only** checkout. The user reviews an immutable basket/account snapshot and clicks Pay in sandbox. `DemoCheckoutLedger.swift` verifies Nessie account ownership and funds, records one withdrawal for the total item cost, and refreshes the actual account evidence. No taxes/shipping are charged in the demo. Never substitute a calculated balance for Nessie’s observed balance. Pending API status remains pending; posted status is independent of exact balance-delta equality because unrelated activity can occur.

The UUID, snapshot and intent are persisted before the network mutation. Ambiguous outcomes are reconciled using the same UUID memo, never retried with another POST. A process lock and unresolved-payment guard prevent duplicate spending. Interrupted checkout resumes its unfinished per-item tasks before it can finish. The saved checkout locks basket mutation from manager initialization onward. Completed demo receipts remain local, owner-only files in Application Support/Flicky.

After sandbox payment, one asynchronous visual task per item opens its actual product URL. The subsequent cart/order stages are explicitly simulated. Opening a link is not proof a page loaded, a cart changed, or an order was placed. No real payment data, Plaid credentials, retailer login, or shipping address is collected. No real merchant purchase API is connected, and the model cannot invoke payment through an action tag.

Validation scripts in `scripts/checks`: `ProductPageResolverCheck.swift`, `DemoCheckoutLedgerCheck.swift`, `ShoppingBasketCheck.swift`, `ShoppingCheckoutCheck.swift`. `ShoppingCheckoutPreview.swift --preview` uses live public product metadata with an intercepted fixture bank and no-op retailer opener; it must never debit a real sandbox account. Full app builds run through Xcode, not xcodebuild.

## Architecture

- **App Type**: Menu bar-only (`LSUIElement=true`), no dock icon or main window
- **Framework**: SwiftUI (macOS native) with AppKit bridging for menu bar panel and cursor overlay
- **Pattern**: MVVM with `@StateObject` / `@Published` state management
- **AI Chat**: Claude (Sonnet 4.6 default, Opus 4.6 optional) via Cloudflare Worker proxy with SSE streaming
- **Speech-to-Text**: AssemblyAI real-time streaming (`u3-rt-pro` model) via websocket, with OpenAI and Apple Speech as fallbacks
- **Spoken responses**: GPT Realtime (`gpt-realtime`, `marin`) for both microphone and text/button inputs; no TTS fallback.
- **Screen Capture**: ScreenCaptureKit (macOS 14.2+), multi-monitor support
- **Voice Input**: Push-to-talk via `AVAudioEngine` + pluggable transcription-provider layer. System-wide keyboard shortcut via listen-only CGEvent tap.
- **Element Pointing**: Claude embeds `[POINT:x,y:label:screenN]` tags in responses. The overlay parses these, maps coordinates to the correct monitor, and animates the blue cursor along a bezier arc to the target.
- **Concurrency**: `@MainActor` isolation, async/await throughout
- **Analytics**: PostHog via `ClickyAnalytics.swift`

### API Proxy (Cloudflare Worker)

AI and voice requests go through a Cloudflare Worker (`worker/src/index.ts`) that holds their API keys as secrets. Nessie sandbox requests use the native HTTPS client and its local, unbundled configuration.

| Route | Upstream | Purpose |
|-------|----------|---------|
| `POST /chat` | `api.anthropic.com/v1/messages` | Claude vision + streaming chat |
| `POST /tts` | `api.elevenlabs.io/v1/text-to-speech/{voiceId}` | ElevenLabs TTS audio |
| `POST /transcribe-token` | `streaming.assemblyai.com/v3/token` | Fetches a short-lived (480s) AssemblyAI websocket token |
| `POST /search` | `google.serper.dev/shopping` | Product price/image/delivery comparison search, used by Flicky's `[SEARCH:]` response tag |
| `POST /fetch-page` | Target listing URL (public web) | Fetches a single listing page and extracts readable text via `HTMLRewriter` (title + up to ~6000 characters of visible body copy, stripping `script/style/nav/header/footer/noscript/svg/iframe/form`). Used to fact-check listings against their real page — see "Real-Page Reading" below. |

Worker secrets: `ANTHROPIC_API_KEY`, `ASSEMBLYAI_API_KEY`, `ELEVENLABS_API_KEY`, `SERPER_API_KEY` (optional — `/search` degrades to bare search-engine URLs without it)
Worker vars: `ELEVENLABS_VOICE_ID`

### Key Architecture Decisions

**Nessie identity and provenance**: With `FLICKY_NESSIE_DATA_SCOPE=enterprise`, entity detail requests use `/enterprise/customers/{id}`, `/enterprise/accounts/{id}`, and `/enterprise/merchants/{id}`. Account and transaction relationships keep their normal routes. Enterprise discovery exposes the shared sandbox dataset; developer lists show only key-scoped records. Each financial refresh reads the customer and `/customers/{id}/accounts`, validates account ownership, and fetches the selected account snapshot. `NessieConnectionPanel.swift` displays the API customer, all returned accounts, calculation inputs, and redacted request/response receipts with status, time, and received-byte SHA-256. These are app logs, not independent attestation. `../scripts/verify_nessie_connection.py` independently reads Nessie using local configuration; `../docs/nessie-judge-demo.md` describes the judge demo. Account changes clear conversation context before refreshing.

**Menu Bar Panel Pattern**: The companion panel uses `NSStatusItem` for the menu bar icon and a custom borderless `NSPanel` for the floating control panel. This gives full control over appearance (dark, rounded corners, custom shadow) and avoids the standard macOS menu/popover chrome. The panel is non-activating so it doesn't steal focus. A global event monitor auto-dismisses it on outside clicks.

**Cursor Overlay**: A full-screen transparent click-through window hosts the winged pig companion. `FlickyPigView.swift` (~120 lines) decodes the supplied GIF once, masks only edge-connected background pixels, and shows three voice-state dots beneath the pet. Reduce Motion freezes wing and dot animation. The pet appears on launch independently of account/voice permissions; panel options expose Show/Hide pet using the persisted cursor preference. It's non-activating, joins all Spaces, and never steals focus. The cursor position, response text, waveform, and pointing animations all render in this overlay via SwiftUI through `NSHostingView`.

**Global Push-To-Talk Shortcut**: Background push-to-talk uses a listen-only `CGEvent` tap instead of an AppKit global monitor so modifier-based shortcuts like `ctrl + option` are detected more reliably while the app is running in the background.

**Shared URLSession for AssemblyAI**: A single long-lived `URLSession` is shared across all AssemblyAI streaming sessions (owned by the provider, not the session). Creating and invalidating a URLSession per session corrupts the OS connection pool and causes "Socket is not connected" errors after a few rapid reconnections.

**Transient Cursor Mode**: When "Show Clicky" is off, pressing the hotkey fades in the cursor overlay for the duration of the interaction (recording → response → TTS → optional pointing), then fades it out automatically after 1 second of inactivity.

**Autonomous Research Loop**: After one voice question, `CompanionManager.runFlickyQueryPipeline` keeps Flicky iterating on its own — searching, comparing, and speaking again — for up to a bounded number of rounds, without the user holding push-to-talk again. It only continues while Claude keeps emitting `[SEARCH:]`; the first response without one is treated as the final answer. Pressing the shortcut again, or the stop button, cancels the in-flight task immediately.

**Response Overlay Positioning**: `CompanionResponseOverlayManager` repositions its bubble near the cursor exactly once per autonomous session (`beginNewAutonomousSession()`), not once per research round (`beginNextAutonomousRound()`, which reuses the same spot). Repositioning every round caused the bubble to visibly jump around the screen as the user's mouse drifted between rounds.

**UI Surface Split**: The menu bar panel (`CompanionPanelView`) shows only account/financial info ("my bank account"). Shopping listings Flicky finds live in a separate right-edge sliding drawer (`SuggestionsDrawerManager`, "what Flicky is shopping for me"). Deeper financial analysis lives in a third, independently toggleable surface (`FinancialInsightsDashboardManager`), reachable from the menu bar panel or via Flicky's `[INSIGHTS]` response tag.

**Real-Page Reading (Tier 1 agentic browsing)**: Flicky's shopping "browsing" is search-result comparison (`/search` via Serper) plus opening real browser tabs (`NSWorkspace.shared.open`) — it does not synthesize clicks/keystrokes on pages (no `CGEventPost`/`AXUIElementPerformAction` anywhere in the app; that would be a much larger "Tier 2" computer-use undertaking, deliberately out of scope for now). What it *does* do: for the 1-3 listings actually opened/shown to the user in a given round (never the full search result set), `CompanionManager.verifyNewlyOpenedListings` fetches each listing's real page text via the Worker's `/fetch-page` route (`fetchReadablePageContent`) and asks a **separate, cheap/fast Claude Haiku client** (`pageVerificationClaudeAPI`, pinned to `claude-haiku-4-6` — intentionally not the same `ClaudeAPI` instance as the user's Sonnet/Opus-selectable `claudeAPI`, to avoid racing with the model picker) to fact-check the listing in one short sentence (out of stock, price mismatch, hidden shipping/tax, condition red flags). This keeps the added token/latency cost bounded no matter how many results Serper returns, and any fetch/verification failure (timeouts, bot-blocked sites, non-HTML responses) degrades silently — it's an enrichment, never a blocker for the core shopping flow.

**App & Menu Bar Icon**: Both the Dock/Finder app icon (`Assets.xcassets/AppIcon.appiconset`) and the `NSStatusItem` menu bar icon (`MenuBarPanelManager.makeClickyMenuBarIcon`) use a pink piggy-bank-with-coin illustration (`Assets.xcassets/MenuBarPiggyIcon.imageset` for the menu bar version, which has a transparent background so it sits naturally in both light and dark menu bars — the app icon version keeps its light-blue square background). The menu bar icon is `isTemplate = false` (kept in full color, unlike the previous monochrome triangle glyph) and has a small continuous "breathing" scale-pulse animation (`addIdleBreathingAnimation`, a looping `CABasicAnimation` on the status item button's layer) — purely cosmetic, does not reflect app state.

**Cursor Companion Character**: The on-screen cursor-follower (`CursorPiggyView` in `OverlayWindow.swift`) reuses the same `MenuBarPiggyIcon` artwork as the menu bar icon, so the character is visually consistent everywhere it appears. It replaced an earlier procedurally-drawn wobbling blue "gooey blob" (`BlobShape`/`BlobEyesView`/`CursorBlobView`, now removed) — since the piggy is a static pixel-art image rather than a vector shape, "aliveness" comes entirely from motion layered on top of it: an idle breathing scale pulse, a tiny continuous in-place hop, squash-and-stretch driven by cursor velocity (`blobStretchAmountX`/`Y`, computed in `BlueCursorView` — the "blob" prefix on these state variables is legacy naming, left unchanged since it still accurately describes stretch/tracking values regardless of the visual character), and a directional lean reusing that same stretch signal. The shadow is a neutral grounded drop shadow rather than the old blue neon glow, to suit a colorful pixel-art character instead of a blue blob.

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `leanring_buddyApp.swift` | ~89 | Menu bar app entry point. Uses `@NSApplicationDelegateAdaptor` with `CompanionAppDelegate` which creates `MenuBarPanelManager` and starts `CompanionManager`. No main window — the app lives entirely in the status bar. |
| `CompanionManager.swift` | ~1106 | Central state machine. Owns dictation, shortcut monitoring, screen capture, Claude API, ElevenLabs TTS, suggestions drawer, and insights dashboard management. Tracks voice state (idle/listening/processing/responding), conversation history, model selection, and cursor visibility. Coordinates the full push-to-talk → screenshot → Claude → TTS → pointing pipeline, plus a bounded autonomous multi-round research loop for shopping questions (one-listing-at-a-time conversational rounds, then a broad sweep), real-page fetch + Haiku fact-check verification of shown listings (see "Real-Page Reading" above), and a `stopCurrentResponse()` interrupt. |
| `MenuBarPanelManager.swift` | ~245 | NSStatusItem + custom NSPanel lifecycle. Creates the piggy-bank menu bar icon (with a small idle breathing animation), manages the floating companion panel (show/hide/position), installs click-outside-to-dismiss monitor. |
| `CompanionPanelView.swift` | ~691 | SwiftUI panel content for the menu bar dropdown. Shows companion status, push-to-talk instructions, a "View Full Insights" button, a "Stop Flicky" button (shown while Flicky is responding), model picker (Sonnet/Opus), permissions UI, DM feedback button, and quit button. Dark aesthetic using `DS` design system. Account/financial info only — shopping suggestions live in `SuggestionsDrawerManager` instead. |
| `OverlayWindow.swift` | ~929 | Full-screen transparent overlay hosting the piggy-bank cursor companion (`CursorPiggyView`), response text, waveform, and spinner. Handles cursor animation, element pointing with bezier arcs, multi-monitor coordinate mapping, and fade-out transitions. |
| `CompanionResponseOverlay.swift` | ~305 | SwiftUI view for the response text bubble and stop button displayed next to the cursor in the overlay. Positions itself once per autonomous question/session (`beginNewAutonomousSession()`) and holds that position across every later round (`beginNextAutonomousRound()`) instead of re-centering on the cursor each round. |
| `SuggestionsDrawerManager.swift` | ~351 | Slide-in NSPanel anchored to the right edge of the main screen (1/7 screen width) showing every shopping listing Flicky has found for the current question as scrollable cards (photo, price, delivery estimate, source, clickable link). Separate from the menu bar panel per the "my bank account" vs. "what Flicky is shopping for me" product split. |
| `FinancialInsightsDashboardManager.swift` | ~861 | Toggleable, non-fullscreen NSPanel (~460×700, centered) presenting a tabbed financial insights dashboard — Overview / Spending / Bills. Overview: hero balance (with a net-cash-flow trend chip), a composite Financial Health Score ring (0-100 + letter grade, blending cushion/bill-load/cash-flow, with plain-English factor callouts), a forward-looking Runway projection ("~N days of safe-to-spend money left" or a positive cash-flow callout), the safe-to-spend `Gauge`, a stacked-bar balance breakdown, and a `Charts`-framework deposits-vs-withdrawals bar chart. Spending: a real spending-by-category breakdown (icon + progress bar + % of tracked spending per category) sourced from Nessie purchases/merchants, with an honest empty state if the sandbox account has no itemized purchases. Bills: upcoming-bill chips, a Subscriptions & Recurring tracker (monthly recurring total + per-bill rows, independent of the 14-day upcoming-bills window), and a rewards-value card. Opened manually via the menu bar panel's "View Full Insights" button or automatically by Flicky via the `[INSIGHTS]` response tag. |
| `CompanionScreenCaptureUtility.swift` | ~132 | Multi-monitor screenshot capture using ScreenCaptureKit. Returns labeled image data for each connected display. |
| `BuddyDictationManager.swift` | ~866 | Push-to-talk voice pipeline. Handles microphone capture via `AVAudioEngine`, provider-aware permission checks, keyboard/button dictation sessions, transcript finalization, shortcut parsing, contextual keyterms, and live audio-level reporting for waveform feedback. |
| `BuddyTranscriptionProvider.swift` | ~100 | Protocol surface and provider factory for voice transcription backends. Resolves provider based on `VoiceTranscriptionProvider` in Info.plist — AssemblyAI, OpenAI, or Apple Speech. |
| `AssemblyAIStreamingTranscriptionProvider.swift` | ~478 | Streaming transcription provider. Fetches temp tokens from the Cloudflare Worker, opens an AssemblyAI v3 websocket, streams PCM16 audio, tracks turn-based transcripts, and delivers finalized text on key-up. Shares a single URLSession across all sessions. |
| `OpenAIAudioTranscriptionProvider.swift` | ~317 | Upload-based transcription provider. Buffers push-to-talk audio locally, uploads as WAV on release, returns finalized transcript. |
| `AppleSpeechTranscriptionProvider.swift` | ~147 | Local fallback transcription provider backed by Apple's Speech framework. |
| `BuddyAudioConversionSupport.swift` | ~108 | Audio conversion helpers. Converts live mic buffers to PCM16 mono audio and builds WAV payloads for upload-based providers. |
| `GlobalPushToTalkShortcutMonitor.swift` | ~132 | System-wide push-to-talk monitor. Owns the listen-only `CGEvent` tap and publishes press/release transitions. |
| `ClaudeAPI.swift` | ~291 | Claude vision API client with streaming (SSE) and non-streaming modes. TLS warmup optimization, image MIME detection, conversation history support. |
| `OpenAIAPI.swift` | ~142 | OpenAI GPT vision API client. |
| `RealtimeVoiceClient.swift` | ~425 | Native PCM audio capture, ephemeral Realtime WebSocket, streamed playback, transcript, research tool calls, time limits, and cancellation. |
| `ElevenLabsTTSClient.swift` | ~165 | Remote speech at a relaxed pace; falls back to the highest-quality installed US English voice (Ava preferred). Preserves playback completion, Stop, and cancellation behavior. |
| `ElementLocationDetector.swift` | ~335 | Detects UI element locations in screenshots for cursor pointing. |
| `ShoppingBasket.swift` | ~235 | Persistent basket, verification eligibility, integer-cent totals, and snapshot locking. |
| `ShoppingBasketPanel.swift` | ~377 | Product verification/import, actual retailer photos, and shared basket review. |
| `ProductPageResolver.swift` | ~329 | Retailer link resolution and identity-bound structured product metadata. |
| `DemoCheckoutLedger.swift` | ~286 | Idempotent Nessie sandbox withdrawals, persistent recovery and observed-balance receipts. |
| `ShoppingCheckout.swift` | ~403 | Reviewed sandbox payment, per-item demo task animation, recovery and receipts. |
| `DesignSystem.swift` | ~880 | Design system tokens — colors, corner radii, shared styles. All UI references `DS.Colors`, `DS.CornerRadius`, etc. |
| `ClickyAnalytics.swift` | ~121 | PostHog analytics integration for usage tracking. |
| `WindowPositionManager.swift` | ~262 | Window placement logic, Screen Recording permission flow, and accessibility permission helpers. |
| `AppBundleConfiguration.swift` | ~40 | Runtime configuration reader with local, unbundled Nessie settings and Info.plist fallback. |
| `FlickyPersonaConfig.swift` | ~115 | Runtime conversational persona: spoken delivery, practical financial reasoning, grounded stock analysis, and honest tool limitations. Injected into the main response prompt. |
| `worker/src/index.ts` | ~366 | Cloudflare Worker proxy. Five routes: `/chat` (Claude), `/tts` (ElevenLabs), `/transcribe-token` (AssemblyAI temp token), `/search` (Serper.dev shopping search — returns price, image, and delivery-estimate fields for the suggestions drawer), `/fetch-page` (fetches a single listing URL and extracts readable text via `HTMLRewriter`, capped at 6000 characters, 8s timeout). |

## Build & Run

```bash
# Open in Xcode
open leanring-buddy.xcodeproj

# Select the leanring-buddy scheme, set signing team, Cmd+R to build and run

# Known non-blocking warnings: Swift 6 concurrency warnings,
# deprecated onChange warning in OverlayWindow.swift. Do NOT attempt to fix these.
```

**Do NOT run `xcodebuild` from the terminal** — it invalidates TCC (Transparency, Consent, and Control) permissions and the app will need to re-request screen recording, accessibility, etc.

## Cloudflare Worker

```bash
cd worker
npm install

# Add secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ASSEMBLYAI_API_KEY
npx wrangler secret put ELEVENLABS_API_KEY

# Deploy
npx wrangler deploy

# Local dev (create worker/.dev.vars with your keys)
npx wrangler dev
```

## Code Style & Conventions

### Variable and Method Naming

IMPORTANT: Follow these naming rules strictly. Clarity is the top priority.

- Be as clear and specific with variable and method names as possible
- **Optimize for clarity over concision.** A developer with zero context on the codebase should immediately understand what a variable or method does just from reading its name
- Use longer names when it improves clarity. Do NOT use single-character variable names
- Example: use `originalQuestionLastAnsweredDate` instead of `originalAnswered`
- When passing props or arguments to functions, keep the same names as the original variable. Do not shorten or abbreviate parameter names. If you have `currentCardData`, pass it as `currentCardData`, not `card` or `cardData`

### Code Clarity

- **Clear is better than clever.** Do not write functionality in fewer lines if it makes the code harder to understand
- Write more lines of code if additional lines improve readability and comprehension
- Make things so clear that someone with zero context would completely understand the variable names, method names, what things do, and why they exist
- When a variable or method name alone cannot fully explain something, add a comment explaining what is happening and why

### Swift/SwiftUI Conventions

- Use SwiftUI for all UI unless a feature is only supported in AppKit (e.g., `NSPanel` for floating windows)
- All UI state updates must be on `@MainActor`
- Use async/await for all asynchronous operations
- Comments should explain "why" not just "what", especially for non-obvious AppKit bridging
- AppKit `NSPanel`/`NSWindow` bridged into SwiftUI via `NSHostingView`
- All buttons must show a pointer cursor on hover
- For any interactive element, explicitly think through its hover behavior (cursor, visual feedback, and whether hover should communicate clickability)

### Do NOT

- Do not add features, refactor code, or make "improvements" beyond what was asked
- Do not add docstrings, comments, or type annotations to code you did not change
- Do not try to fix the known non-blocking warnings (Swift 6 concurrency, deprecated onChange)
- Do not rename the project directory or scheme (the "leanring" typo is intentional/legacy)
- Do not run `xcodebuild` from the terminal — it invalidates TCC permissions

## Git Workflow

- Branch naming: `feature/description` or `fix/description`
- Commit messages: imperative mood, concise, explain the "why" not the "what"
- Do not force-push to main

## Self-Update Instructions

<!-- AI agents: follow these instructions to keep this file accurate. -->

When you make changes to this project that affect the information in this file, update this file to reflect those changes. Specifically:

1. **New files**: Add new source files to the "Key Files" table with their purpose and approximate line count
2. **Deleted files**: Remove entries for files that no longer exist
3. **Architecture changes**: Update the architecture section if you introduce new patterns, frameworks, or significant structural changes
4. **Build changes**: Update build commands if the build process changes
5. **New conventions**: If the user establishes a new coding convention during a session, add it to the appropriate conventions section
6. **Line count drift**: If a file's line count changes significantly (>50 lines), update the approximate count in the Key Files table

Do NOT update this file for minor edits, bug fixes, or changes that don't affect the documented architecture or conventions.

**Panel keyboard shortcut**: Command–Shift–Space toggles the full menu bar panel globally via Carbon RegisterEventHotKey, independently of Accessibility permission. Opening focuses the ask field when available; Escape dismisses the panel. Control–Option remains push-to-talk. MenuBarPanelManager owns and unregisters the hotkey and handler.

**Brand**: The user-facing app name is PeppaPrice. Use the coin-topped pink pig in `Assets.xcassets/PeppaPriceLogo.imageset` for the panel, menu bar, and app icon. The winged GIF remains the cursor pet. Legacy Swift type names, bundle identifier, Flicky Application Support paths, defaults keys, and checkout memo identifiers remain stable for compatibility.

## Credit-pull simulation

`CreditSimulation.swift` owns validated self-reported score/money inputs, deterministic no-fee loan payment examples, and optional account-scoped local history. `CreditSimulationPanel.swift` provides the native comparison panel, Nessie context, lender links, selection and history controls. Open Options → Credit simulation or emit `[CREDIT]` through the existing response handler; the runtime persona describes this capability in both typed and Realtime research flows.

No SSN, bureau inquiry, credit verification, loan application, or approval occurs. A UUID-based SIM reference identifies each run. Dated bundled lender examples from SoFi and Wells Fargo are explicitly hypothetical when scaled to entered amounts; score-to-rate interpolation is a teaching rule, not underwriting. Nessie snapshots older than five minutes are omitted from runs; deposits/withdrawals are not income. Simulator inputs are local and are not injected into model prompts. History saving is opt-in, at most 30 runs per account, in owner-only Application Support/Flicky/credit-simulations files named by account hash. Logout/account changes reset transient state; History can delete saved data.

See `design/credit-simulation.md` for source dates, formula assumptions and limitations. Validate with `bash scripts/checks/run-credit-checks.sh` (optional `--render /tmp/flicky-credit-review`); use Xcode Command-B for the full app build.

**PeppaPrice panel and demo accounts**: The header shows the logo/name only; Financial Advisor, Ready, and the Sonnet/Opus picker are removed. `PeppaDemoAccount.swift` reads an owner-only Application Support/Flicky/peppaprice-demo-accounts.json index generated by `../scripts/seed_peppaprice_accounts.py --execute`: 10 synthetic Nessie customers with checking/savings accounts each. The account menu exposes all 20; selection verifies live ownership, clears prior conversation/financial context, and refreshes from Nessie. IDs are an index, never a source of financial values. The seeder journals POST intent/results to prevent ambiguous retries and verifies account relationships plus transaction counts.

## Shopping UI refinement

Basket and checkout share the main PeppaPrice panel's charcoal material, logo, mint action, and compact system typography. `ShoppingPanelStyle`, quiet/primary button styles, and product thumbnails live in `ShoppingBasketPanel.swift`. Product provenance is under Details; checkout IDs are under Payment details. Green actions read Buy it (or Buy it plus the total), then Check status / Done according to existing checkout state. A visible footer retains sandbox/simulated-order context. This changes presentation only; keep the existing ledger, payment reconciliation and no-real-retailer-order behavior.
