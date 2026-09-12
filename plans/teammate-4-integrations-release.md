# Cursor Financial Bodyguard — Part 4: integrations, packaging and verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after explicit implementation authorization. Steps use checkbox syntax.

**Goal:** Validate the two-platform product, package a reproducible demo, and implement Persona-gated sandbox mitigation only if the core is already reliable.

**Owns:** cross-platform feasibility probes, optional Persona action lifecycle, packaging, synthetic checkout page, verification evidence, attribution and demo rehearsal.

**Does not own:** forecast arithmetic, OCR extraction, conversation routing, speech behavior or README changes.

**Dependencies:** Parts 1–3 provide the runnable core, service contracts, candidate registry and conversation states. Read `plans/2026-09-12-cross-platform-feasibility.md` and `plans/2026-09-12-cursor-financial-bodyguard-demo.md`.

## Global constraints

- A Windows artifact without a Windows launch is unverified Windows support.
- No financial write is performed in tests or during feasibility probes.
- Persona verifies identity, not account ownership or transfer consent.
- Completed Persona inquiry is not approval; only server-fetched approved status can pass the gate.
- Ambiguous transfer submission becomes `unknown`; never blindly retry a financial POST.
- README is explicitly outside this assignment and must remain unchanged.
- Private `plans` files must not enter public artifacts or commits unless repository privacy is confirmed and the user explicitly authorizes that push.

## Owned files

Create: `src/service/providers/persona.ts`, `src/service/actions/{types,ledger,coordinator}.ts`, `src/ui/ActionReview.tsx`, `tests/service/actions.test.ts`, `demo/checkout.html`, `docs/provider-contracts.md`, `docs/verification.md`, `docs/attribution.md`, `scripts/seed-sandbox.ts` only when a verified sandbox contract exists. Modify build configuration as needed; do not modify README.

## Task 1 — time-boxed cross-platform feasibility

- [ ] Record exact macOS/Windows device, architecture, Node/Electron versions, permissions and native build access.
- [ ] On each OS test passive transparent overlay, interactive bubble, ordinary pointer click/drag/text selection/scroll, selected-display capture, denied-permission recovery, 100/125/200% scaling, negative origins and overlay hiding during capture.
- [ ] Validate Part 3's hotkey press/release while another app is focused, mic denial, 30-second cutoff, Escape, lock/suspend, process exit and playback interruption. Check collision and auto-repeat behavior.
- [ ] Use a harmless Nessie read, short speech request and schema-only router request where credentials exist. Record sanitized contracts and latency; no API keys or personal data in evidence.
- [ ] Produce a pass/fail/blocked matrix. Give each failed capability one targeted recovery attempt, then preserve a labeled fallback.

## Task 2 — optional Persona sandbox action

Entry condition: Parts 1–3 pass on tested platforms, verified Nessie transfer semantics exist, Persona sandbox/template exists and at least four hours remain. Otherwise skip the task and record it as omitted.

- [ ] Define `TransferDraft` states `drafted|verifying|verified|confirmed|submitting|succeeded|failed|unknown` with exact source, destination, cents, session and five-minute expiry.
- [ ] Implement server-side `IdentityProvider.create/status` and `TransferProvider.submit/reconcile`; bind approval to action ID/session. Hosted callbacks only trigger server refresh; client callbacks never authorize.
- [ ] Store drafts in a transactional local ledger. Commit `confirmed → submitting` once; on restart treat persisted submitting as unknown and reconcile. Do not invent idempotency headers.
- [ ] Require approved—not merely completed—identity, revalidate balance/source ownership/configuration and exact draft before submit. Stale/non-live modes disable execution.
- [ ] Test wrong session, edited amount, expired draft, declined/completed-but-not-approved inquiry, duplicate concurrent confirm, timeout/unknown and restart. Use fake providers in CI; no real transfer.
- [ ] Commit `feat: gate optional sandbox mitigation on identity and consent` only if entry conditions pass.

## Task 3 — packaged demo and synthetic fallback

- [ ] Add `demo/checkout.html` labeled `Synthetic checkout demo` with $200 and $10 variants; clicking Complete Purchase changes only local text.
- [ ] Bundle renderer, preload, service, OCR worker/language assets and any native hotkey module. Launch packaged app without dev server and with synthetic OCR offline.
- [ ] Verify provider credentials are absent from artifacts and quit cleans child service/workers/windows/mic. Use `npm run build`, `npm run package:mac`, `npm run package:win` on supported native targets.
- [ ] If live sandbox is verified, add an explicit seed script with stable IDs and no destructive reset. Otherwise keep synthetic/recorded modes only.

## Task 4 — verification and demo evidence

- [ ] Run `npm run typecheck`, `npm test`, and `npm run build`; record actual output and unresolved failures. Do not claim passing from a partial suite.
- [ ] On each OS run the acceptance matrix: fresh off state, $200 → −$80, $10 → $110, zero-versus-negative, stale/API failure, display scaling, cursor conversation, cancellation and packaged offline launch.
- [ ] Measure five hover runs and three voice turns per OS, separating OCR, router, forecast and speech latency. Report target ≤3 seconds as a measured result, not a promise.
- [ ] Write `docs/verification.md` with actual devices/builds/results and `docs/attribution.md` distinguishing Clicky inspiration, copied source (if any) and original work. Do not write README.
- [ ] Rehearse the three-minute demo using live, recorded or synthetic mode visibly labeled. Never substitute a staged transfer or recording for a live integration claim.
- [ ] Commit `docs: record verified cross-platform demo evidence`.

## Final handoff

- [ ] Return the four part commit hashes, device matrix, provider availability, measured latency and omitted features to the project owner.
- [ ] Confirm no README diff.
- [ ] Confirm private `plans` remains excluded from public artifacts. If the GitHub repository is private and the owner explicitly requests a plan push, push the plan commit only then; otherwise keep plans local.
