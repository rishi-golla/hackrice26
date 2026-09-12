# Cappy Financial Agent Design

**Status:** Approved design draft for review  
**Date:** 2026-09-12  
**Product:** Cappy, a Capital One themed conversational financial companion

## Goal

Replace the current Clicky-derived presentation and generic tutor behavior with Cappy: a cursor-bound financial assistant that uses an ElevenLabs conversational agent for voice, a server-side customer-data API for financial context, and the existing deterministic forecast engine for every money claim.

Cappy must feel like one product. Users see Cappy branding, Capital One inspired red/navy/white styling, Cappy language, finance-specific prompts, and finance-specific permission/error states. Reused Clicky code remains an implementation substrate only. The only visible Clicky references are legal source attribution and the preserved MIT license.

## Scope

### In scope

- Cappy branding across the macOS native app and shared Electron baseline.
- ElevenLabs Cappy conversational-agent boundary for speech input, turn handling, and spoken output.
- Server-side customer/session authorization and finance tool calls.
- Existing integer-cent 14-day forecast engine as the authority for balances, bills, income, reserves, and purchase impact.
- Local ScreenCaptureKit/Electron capture and local Vision/Tesseract OCR.
- Hover-to-predict checkout flow with amount confirmation when OCR is ambiguous.
- Voice follow-ups for amount/date/scenario changes and explanations.
- Synthetic and recorded sandbox modes that work without credentials.
- A verified Nessie/Capital One sandbox adapter when its current contract and credentials are available.
- Passive cursor gestures and overlays that never move the system pointer or click for the user.
- Repository tests, macOS Xcode smoke validation, and startup documentation.

### Out of scope

- Automatic checkout, payment, transfer, or other financial writes.
- Persona identity flows until the provider contract and sandbox prerequisites are verified.
- Sending screenshots to ElevenLabs, an LLM, or the financial provider.
- General-purpose tutoring, screen commentary, model selection, onboarding demonstrations, or unrelated UI pointing.
- Root `README.md` edits unless the user explicitly requests them.
- Production account linking or collection of production identity documents.

## Product behavior

### Cursor interaction

Cappy lives beside the user’s cursor as a small passive overlay. The system pointer remains visible and user-controlled. Cappy’s global push-to-talk shortcut starts and stops a voice turn. State changes are visible as `idle`, `listening`, `thinking`, and `speaking`.

When monitoring is enabled, Cappy captures only the selected display after a short dwell. OCR runs locally. A single high-confidence USD final total near checkout language creates a preview. Multiple totals, missing tax, weak purchase context, stale capture, or low confidence creates an amount-confirmation question instead of an automatic forecast.

The projection card shows purchase amount, minimum balance and date, reserve status, responsible scheduled events, data mode, freshness, and a short explanation. Cappy may glow, point, or draw a warning ring. It never moves the system pointer, clicks checkout, submits a form, or changes a financial account.

### Conversation

The ElevenLabs Cappy agent speaks naturally but uses Cappy finance tools for every financial fact. Session memory is bounded to the active account, current scenario, recent amount/date references, and explicit user corrections. Supported follow-ups include:

- affordability questions for the current checkout amount;
- amount corrections such as “what about ten dollars?”;
- explicit dates such as “what if I buy it Saturday?”;
- combined confirmed purchases inside the 14-day horizon;
- explanations such as “why is this risky?”;
- forgetting or replacing the current scenario;
- clearly labeled alternative scenarios for unconfirmed money, such as a roommate IOU.

Scheduled income is an assumption, not guaranteed funds. Unconfirmed repayments stay outside the base case. Cappy states stale or incomplete data before making an affordability claim.

## Architecture

```text
macOS Cappy app / Electron Cappy shell
    ├─ global shortcut + microphone capture
    ├─ local screen capture + OCR
    ├─ passive cursor and forecast overlay
    └─ CappyVoiceAgentClient
             │ short-lived session token; transcript/audio only
             ▼
server-side Cappy agent gateway
    ├─ ElevenLabs conversational agent session
    ├─ customer/session authorization
    ├─ Cappy finance tool schemas
    └─ CappyFinancialProvider
             │ authorized structured reads
             ▼
Nessie / Capital One sandbox adapter
             │ Snapshot
             ▼
integer-cent forecast and explanation engine
```

The gateway owns financial credentials and the mapping from a user session to an allowed account. The app never receives a provider key. The agent receives validated tool results, not raw account payloads or screenshots. The forecast engine remains deterministic and testable without a network or model.

## Agent contract

The native client depends on a Cappy-specific interface rather than Clicky’s Claude or ElevenLabs TTS classes:

```swift
protocol CappyVoiceAgentClient {
    func startSession(context: CappySessionContext) async throws -> CappyAgentSession
    func sendTurn(_ turn: CappyTurn) async throws -> CappyAgentReply
    func stopSession() async
}
```

The gateway exposes typed tools equivalent to:

```text
getSnapshot(accountId)
forecastPurchase(accountId, purchaseCents, reserveCents, purchaseDate?)
compareScenario(accountId, purchases[], reserveCents)
explainForecast(forecastId)
```

Each tool validates account ownership, integer cents, USD currency, date horizon, session freshness, and data mode. Tools return typed facts and provenance. No tool can write money or authorize a transaction.

ElevenLabs configuration is externalized through a short-lived session endpoint and environment configuration. The code supports synthetic mode without ElevenLabs so development and tests remain repeatable. A provider failure produces a Cappy typed-input fallback and never silently switches to an ungrounded generic chat mode.

## Data and privacy rules

- Financial data modes stay visible: Synthetic, Recorded Sandbox, or Live Sandbox.
- Synthetic fixture remains the canonical demo: $800 opening balance, $600 rent on day 3, $80 utilities on day 5, $1,000 scheduled income on day 8, and $100 reserve.
- Forecast horizon includes today plus the next 13 calendar days in the configured timezone.
- Outgoing events are applied before incoming events on the same day.
- Posted, cancelled, duplicate, unsupported, or unconfirmed records follow the existing normalization policy.
- Missing bills or stale snapshots are labeled incomplete/stale, never converted to zero obligations.
- Screen pixels remain local. OCR output is reduced to amount, nearby label, confidence, and coordinates before a service call.
- Audio/transcript retention is off by default. Only the active turn and needed structured context are sent to the configured agent.
- No financial response is accepted from an LLM without a matching validated tool result.

## Rebrand and source migration

### Native macOS target

Rename the project, scheme, targets, entry point, bundle display name, bundle identifier, and visible copy to Cappy. Rename `Buddy` and `Companion` implementation types to Cappy-specific names. Remove the Clicky-only onboarding, music, screenshots, generic Claude vision flow, model picker, Farza feedback controls, PostHog analytics, and generic pointing prompt. Keep capture, shortcut, audio conversion, permission, coordinate, and passive overlay code where it supports Cappy behavior.

Replace the generic `ElevenLabsTTSClient` with `CappyElevenLabsAgentClient`. Remove the Claude API path from the active target. Keep legal attribution and `macos/CLICKY-LICENSE.txt` as source notices, with no product UI references.

### Shared Electron baseline

Rebrand package metadata, product title, preload bridge, IPC channels, service messages, environment variable names, and UI strings from Flicky to Cappy while preserving the existing domain and service contracts. Keep `README.md` untouched. Update development docs and tests to use Cappy terms.

### Capital One themed design

Use a restrained Capital One inspired palette: deep navy surfaces, bright red action/warning accents, white text, and accessible contrast. Use Cappy as the assistant name. Avoid shipping official logos or implying a production Capital One endorsement; label the build as a hackathon sandbox integration where appropriate.

## Testing and acceptance

### Automated

- Existing domain, service, desktop, OCR, conversation, stress, and E2E suites pass.
- New gateway tests prove account isolation, tool schema validation, stale/incomplete labels, and no screenshot forwarding.
- New agent-client tests prove session-token handling, cancellation, bounded context, and typed fallback.
- OCR tests prove ambiguous totals require confirmation and stale captures cannot publish.
- Branding scan fails on user-visible Clicky, Farza, Claude generic-chat, or Learning Buddy strings; legal source files are allowlisted.
- Typecheck and production build pass.

### macOS manual

Open the Xcode project, set a local signing team, grant Accessibility, Screen Recording, Screen Content, and Microphone permissions, and verify push-to-talk, local capture, ElevenLabs agent response, forecast card, follow-up correction, stale-data message, and clean shutdown. Do not use terminal `xcodebuild` for this Clicky-derived target because the upstream permission guidance warns it can invalidate TCC state.

### Cross-platform

The Electron Cappy baseline remains the shared Windows path. Windows packaging and a real Windows smoke test remain explicit validation gates; shared tests do not count as Windows evidence.

## Success criteria

A teammate can clone the repository, open the Cappy Xcode project or run the Electron baseline, configure only documented agent/API values, and see a Cappy-branded cursor assistant. A checkout question produces a grounded 14-day projection; voice follow-ups update the same scenario; no Clicky product behavior or branding appears; no financial write is possible; and all automated checks pass.
