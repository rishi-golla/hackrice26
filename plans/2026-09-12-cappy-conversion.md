# Cappy Financial Agent Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after authorization. Steps use checkbox syntax for tracking.

**Goal:** Convert the Clicky-derived macOS app and shared Electron baseline into a Cappy-branded, local-first Capital One themed financial cursor assistant with an ElevenLabs voice-agent boundary, authenticated customer-data tools, and no generic Clicky behavior.

**Architecture:** Keep reusable screen capture, OCR, global shortcut, audio, and passive overlay infrastructure. Replace product behavior with Cappy-specific authentication, session memory, finance tools, agent orchestration, forecast rendering, and Capital One inspired styling. Keep API credentials in Keychain/server environment; use synthetic and recorded providers for offline development.

**Tech Stack:** SwiftUI/AppKit, ScreenCaptureKit, Speech/AVFoundation, ElevenLabs agent adapter, TypeScript, Electron, React, Fastify, Zod, Vitest, Tesseract.js, integer-cent domain engine, Xcode project files.

**Spec:** `specs/2026-09-12-cappy-financial-agent-design.md`

## Global Constraints

- Product name and visible assistant identity are Cappy.
- Root `README.md` stays unchanged.
- Capital One styling is red/navy/white inspired; do not ship official logos or imply production endorsement.
- Financial claims come from the deterministic integer-cent forecast engine or validated provider facts.
- Screenshots stay local; only reduced OCR context may leave the app.
- ElevenLabs and ML credentials never ship in the app binary or plist.
- Synthetic, Recorded Sandbox, and Live Sandbox modes remain explicit and visible.
- Login/logout, session expiry, account isolation, and preference scoping are required.
- No financial write, click automation, transfer, payment, or Persona flow ships in this conversion.
- Cappy cursor never moves the system pointer; overlays remain passive outside user-activated controls.
- Native macOS verification runs through Xcode; do not run terminal `xcodebuild` for this target.
- Windows support remains the shared Electron path and requires separate device validation.

## File map

| Area | Files | Responsibility |
|---|---|---|
| Auth/contracts | `src/service/auth.ts`, `src/service/session.ts`, `src/service/profile.ts`, `src/service/tools.ts`, `src/service/model.ts` | Cappy identity, session lifecycle, preferences, typed tool policy, model adapter |
| Agent gateway | `src/service/providers/elevenlabs.ts`, `src/service/providers/model.ts`, `src/service/server.ts`, `src/service/entry.ts` | Short-lived agent sessions, customer-data tools, provider isolation |
| Shared desktop | `src/desktop/main.ts`, `src/desktop/preload.ts`, `src/shared/contracts.ts`, `src/ui/*`, `index.html` | Cappy bridge, status, login, finance card, Capital One styling |
| Native Cappy | `macos/cappy/`, `macos/cappy.xcodeproj/` | macOS target, agent client, capture, hotkey, overlay, permissions |
| Native service copy | `macos/README.md`, `docs/development.md`, `docs/verification.md`, `docs/attribution.md` | Cappy startup, provider setup, verification, legal source notice |
| Tests | `tests/service/`, `tests/conversation/`, `tests/desktop/`, `tests/ui/`, `macos/cappyTests/` | Contracts, security boundaries, forecast and branding gates |

---

### Task 1: Rebrand repository metadata and native target identity

**Files:**
- Rename: `macos/leanring-buddy.xcodeproj` to `macos/cappy.xcodeproj`.
- Rename: `macos/leanring-buddy/` to `macos/cappy/`.
- Rename: native test directories and Swift entry point to Cappy names.
- Modify: `macos/cappy.xcodeproj/project.pbxproj`, `macos/cappy/Info.plist`, `package.json`, `electron-builder.yml`, `index.html`.
- Test: `tests/branding/branding.test.ts`.

**Interfaces:** Product display name is `Cappy`; native bundle identifier is `com.abhijithutla.cappy` by default and remains editable per developer signing team. Shared package name is `cappy` and Electron product name is `Cappy`.

- [ ] Rename native paths and update synchronized Xcode groups, target names, test dependencies, product references, scheme metadata, and Swift `@main` type to `CappyApp`.
- [ ] Replace product, menu bar, permission, title, and log strings with Cappy language.
- [ ] Remove old product assets from the active target: demo screenshots, source music, onboarding media, and unrelated tutorial images.
- [ ] Remove `PostHog` and `Sparkle` package products from the native target unless a Cappy-specific use exists; no analytics or updater runs by default.
- [ ] Update root package/product metadata and Electron window titles without editing `README.md`.
- [ ] Add branding test that recursively scans source and UI copy, allowlisting only `macos/CLICKY-LICENSE.txt`, `docs/attribution.md`, and source-notice comments. It must fail on user-visible `Clicky`, `Flicky`, `Learning Buddy`, `Farza`, `Claude`, `Sonnet`, `Opus`, or generic tutor copy.
- [ ] Run `npm test -- tests/branding/branding.test.ts` and typecheck. Commit `refactor: rename product surfaces to Cappy`.

### Task 2: Add local authentication, sessions, and profile policy

**Files:**
- Create: `src/service/auth.ts`, `src/service/session.ts`, `src/service/profile.ts`, `src/service/policy.ts`.
- Modify: `src/service/server.ts`, `src/service/entry.ts`, `src/shared/contracts.ts`, `src/desktop/preload.ts`, `src/desktop/main.ts`.
- Create tests: `tests/service/auth.test.ts`, `tests/service/session.test.ts`, `tests/service/profile.test.ts`, `tests/service/policy.test.ts`.

**Interfaces:**

```ts
export type CappyUser = { id: string; displayName: string; accountIds: string[] };
export type CappySession = { id: string; userId: string; accountId: string; issuedAt: string; expiresAt: string };
export type CappyProfile = { reserveCents: number; riskStyle: 'calm' | 'direct' | 'detailed'; language: 'en-US'; monitoringEnabled: boolean };
export interface CappyAuthProvider { login(email: string, password: string): Promise<CappySession>; logout(sessionId: string): Promise<void>; validate(sessionId: string): Promise<CappySession>; }
export interface CappySessionStore { create(userId: string, accountId: string): CappySession; revoke(sessionId: string): void; get(sessionId: string): CappySession | undefined; }
```

- [ ] Implement deterministic local demo identities from an in-memory provider (`demo@example.com` / `demo-password`) with one allowlisted `demo-checking` account. Keep password comparison inside the provider and never log credentials.
- [ ] Implement session expiry through an injected clock, revoke-on-logout, account binding, and fail-closed unknown sessions.
- [ ] Add profile storage keyed by `userId` and account ID. Validate integer reserve cents and bounded style values. Do not allow profile settings to change forecast policy or tool authorization.
- [ ] Add authenticated routes: `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `GET /profile`, `PUT /profile`.
- [ ] Require bearer session on every snapshot, forecast, agent, and profile route. Reject account IDs outside the authenticated session with 403.
- [ ] Expose only typed preload methods (`login`, `logout`, `getSession`, `getProfile`, `updateProfile`). Never expose the session store or service token to the renderer.
- [ ] Test login success/failure, session expiry, logout invalidation, account isolation, profile scoping, malformed input, and no credential logging. Commit `feat: add Cappy local auth and session policy`.

### Task 3: Add Cappy tool registry and replaceable model boundary

**Files:**
- Create: `src/service/tools.ts`, `src/service/model.ts`, `src/service/providers/model.ts`.
- Modify: `src/service/server.ts`, `src/service/conversation/controller.ts`, `src/service/conversation/router.ts`, `src/service/entry.ts`.
- Create tests: `tests/service/tools.test.ts`, `tests/conversation/model.test.ts`.

**Interfaces:**

```ts
export type CappyToolPolicy = { readOnly: true; requiresSession: true; accountScoped: true };
export type CappyToolContext = { session: CappySession; profile: CappyProfile };
export type CappyTool = { name: string; description: string; policy: CappyToolPolicy; execute(input: unknown, context: CappyToolContext): Promise<unknown> };
export interface CappyToolRegistry { register(tool: CappyTool): void; call(name: string, input: unknown, context: CappyToolContext): Promise<unknown>; }
export interface CappyModelProvider { complete(input: { system: string; user: string; tools: string[] }): Promise<{ text: string; toolCalls: unknown[] }>; }
```

- [ ] Register only `getSnapshot`, `forecastPurchase`, `compareScenario`, and `explainForecast` in the initial registry. Each tool validates account scope and integer cents before execution.
- [ ] Add an explicit read-only policy check that rejects a tool marked writable or a tool call without a valid session.
- [ ] Implement deterministic formatter provider for synthetic/offline mode and an HTTP ML provider whose base URL/model are environment-configured. Do not hardcode provider keys in TypeScript or Swift.
- [ ] Route conversation turns through the registry and model boundary; remove assumptions that every turn is Claude vision chat.
- [ ] Test unknown tool, invalid schema, session mismatch, read-only enforcement, model timeout, and deterministic offline replies. Commit `feat: add Cappy tools and model provider boundary`.

### Task 4: Integrate ElevenLabs as Cappy’s voice agent boundary

**Files:**
- Create: `src/service/providers/elevenlabs.ts`, `macos/cappy/CappyVoiceAgentClient.swift`.
- Modify: `src/service/server.ts`, `src/service/entry.ts`, `macos/cappy/CappyManager.swift`.
- Delete from active product path: `macos/cappy/ClaudeAPI.swift`, generic `ElevenLabsTTSClient.swift`, and AssemblyAI provider code when no Cappy call site remains.
- Create tests: `tests/service/elevenlabs.test.ts`, `macos/cappyTests/CappyVoiceAgentClientTests.swift`.

**Interfaces:**

```ts
export type CappyAgentSession = { id: string; expiresAt: string; websocketURL: string; token: string };
export interface CappyElevenLabsGateway { createSession(context: CappyToolContext): Promise<CappyAgentSession>; closeSession(sessionId: string): Promise<void>; }
```

- [ ] Implement a server-side ElevenLabs session adapter using `CAPPY_ELEVENLABS_AGENT_ID`, a configured agent-session endpoint, and short-lived tokens. Reject missing configuration with a typed provider-unavailable response.
- [ ] Forward only transcript, current OCR candidate, profile fields needed for the turn, and validated tool results. Never forward screenshots, provider keys, or unrestricted account payloads.
- [ ] Give the agent system instructions that Cappy tools are authoritative, scheduled income is not guaranteed, stale/incomplete data must be stated, and no financial writes are available.
- [ ] Implement native `CappyVoiceAgentClient` for session start, turn send, cancellation, and shutdown. Keep global hotkey ownership in the app and audio transport behind this interface.
- [ ] Add deterministic typed-input fallback when ElevenLabs is unavailable. No fallback may become generic chat.
- [ ] Test token/session handling, timeout, cancellation, context minimization, and provider-unavailable fallback. Commit `feat: add Cappy ElevenLabs agent boundary`.

### Task 5: Convert native macOS behavior to finance-only Cappy

**Files:**
- Modify or rename: `macos/cappy/CappyManager.swift`, `CappyDictationManager.swift`, `CappyAudioConversionSupport.swift`, `CappyScreenCaptureUtility.swift`, `CappyResponseOverlay.swift`, `CappyPanelView.swift`, `CappyAnalytics.swift`.
- Delete: onboarding video/music state, onboarding demo methods, generic Claude prompt builders, model picker, Farza feedback UI, PostHog tracking, and generic element-pointing paths.
- Create: `macos/cappy/CappyFinanceCoordinator.swift`, `macos/cappy/CappyAuthSessionStore.swift`.
- Test: `macos/cappyTests/CappyFinanceCoordinatorTests.swift`.

- [ ] Make Cappy’s manager own authenticated session state, profile, agent client, local OCR, finance coordinator, response overlay, and local permission status.
- [ ] Keep monitoring off until the user explicitly enables it. Show a visible Cappy monitoring indicator and stop capture immediately on logout, permission loss, or toggle-off.
- [ ] Route financial questions through local OCR plus the finance service. Reject a financial answer unless a forecast/tool result exists for the active session and account.
- [ ] Preserve session memory only for the active authenticated account. Clear transcript, scenario, overlay, audio, and pending tasks on logout/account switch.
- [ ] Keep system pointer untouched. Make forecast cards click-through outside explicit Cappy controls.
- [ ] Replace all permission, error, onboarding, and menu-bar strings with Cappy copy. Remove generic “talk to your cursor” wording.
- [ ] Add Swift tests for logout cancellation, account switch, stale result suppression, and forecast response rendering. Commit `feat: make native app finance-only Cappy`.

### Task 6: Apply Capital One themed UI and local setup flow

**Files:**
- Modify: `macos/cappy/DesignSystem.swift`, `CappyPanelView.swift`, `CappyResponseOverlay.swift`, `OverlayWindow.swift`, `src/ui/styles.css`, `src/ui/main.tsx`, `index.html`.
- Create: `src/ui/components/LoginView.tsx`, `src/ui/components/ProfileView.tsx`, `src/ui/components/CappyStatus.tsx`.
- Modify assets under `macos/cappy/Assets.xcassets/` only when they are Cappy-specific.
- Create tests: `tests/ui/branding.test.ts`, `tests/ui/auth-flow.test.ts`.

- [ ] Define shared Cappy palette tokens: deep navy surfaces, Capital One inspired red accent/warning, white primary text, muted blue-gray secondary text, accessible focus rings.
- [ ] Build login, session status, account selection, profile preferences, monitoring toggle, data-mode badge, voice status, and logout controls.
- [ ] Render forecast card with amount, minimum date/balance, reserve, responsible events, provenance, stale/incomplete qualifiers, and “no action taken” label.
- [ ] Add typed-input fallback when microphone or agent is unavailable.
- [ ] Remove old screenshots, onboarding video, music, and unrelated tutorial assets from the native target and renderer.
- [ ] Test visible Cappy copy, login/logout states, no account data before login, and focus/contrast basics. Commit `feat: add Cappy Capital One themed UI`.

### Task 7: Rebrand shared Electron bridge and environment configuration

**Files:**
- Modify: `src/shared/contracts.ts`, `src/desktop/main.ts`, `src/desktop/preload.ts`, `src/service/server.ts`, `src/service/entry.ts`, `src/service/snapshot.ts`, `scripts/e2e.mjs`, `scripts/build.mjs`, `.env.example`, `electron-builder.yml`, `package.json`.
- Rename identifiers: `flicky` bridge/events/env names to `cappy`; retain compatibility aliases only inside migration tests.
- Create tests: update existing suites and add `tests/desktop/cappy-bridge.test.ts`.

- [ ] Expose `window.cappy`, `cappy:*` IPC channels, and CAPPY-prefixed environment variables.
- [ ] Keep context isolation, disabled Node integration, sandboxed overlays, validated IPC senders, and restrictive navigation policy.
- [ ] Move agent/model/provider configuration to documented environment values and local ignored files. Provide `.env.example` with placeholders but no credentials.
- [ ] Ensure service startup returns explicit capabilities (`auth`, `agent`, `transcription`, `speech`, `financialActions`) and no capability is inferred from a missing key.
- [ ] Update E2E fixture to login first, read a synthetic snapshot, request a forecast, logout, and verify subsequent requests fail.
- [ ] Run complete TypeScript test suite, typecheck, build, E2E, and stress tests. Commit `refactor: align Electron baseline with Cappy contracts`.

### Task 8: Update docs, legal source notices, and verification gates

**Files:**
- Modify: `macos/README.md`, `docs/development.md`, `docs/architecture.md`, `docs/implementation-status.md`, `docs/verification.md`, `docs/attribution.md`.
- Preserve: `macos/CLICKY-LICENSE.txt`, root `README.md`, visible `plans/` and `specs/` documents.
- Create: `docs/provider-contracts.md`, `docs/cappy-agent-configuration.md`.

- [ ] Document Xcode workflow for `macos/cappy.xcodeproj`, signing team, permissions, Cappy agent configuration, and local demo login.
- [ ] Document Keychain/server-secret boundary and exact CAPPY environment names without real keys.
- [ ] Document synthetic, recorded, and live data modes and the live-contract verification gate.
- [ ] Document that native macOS Xcode validation and Windows device validation are separate requirements.
- [ ] Update status to distinguish automated passing checks from unverified native/Windows gates.
- [ ] Keep legal attribution concise and separate from product UI. State that Clicky source is used under MIT and Cappy behavior is custom.
- [ ] Run repository branding scan, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, and `npm run test:stress`. Commit `docs: document Cappy development and provider setup`.

### Task 9: Final verification and integration

**Files:**
- Modify only files required by failing checks.
- Test: complete automated suite and manual macOS checklist.

- [ ] Confirm `git status --short` contains no generated secrets, Xcode user state, recordings, or build output.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:e2e`.
- [ ] Run `npm run test:stress -- --reporter=dot`.
- [ ] Run native Cappy from Xcode on macOS and record permission, login/logout, push-to-talk, ElevenLabs response, OCR preview, forecast, follow-up, stale-data, and shutdown results in `docs/verification.md`.
- [ ] Verify Windows status is accurately marked verified or unverified; never infer it from shared tests.
- [ ] Review diff for Clicky product behavior, secrets, root README changes, and unrelated refactors.
- [ ] Commit `chore: verify Cappy baseline` only after all checks pass.
