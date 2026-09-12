# Cursor Financial Bodyguard — design specification

Status: finalized for the planning handoff at the user's request on 2026-09-12. Implementation is not authorized in this planning session.

## Objective and constraints

Build a 24-hour hackathon demo for macOS and Windows in which the user talks to their cursor about what is on screen. The cursor is the character; temporary overlays are its gestures. It previews how an on-screen purchase changes a user's next 14 days of cash flow. Original contribution: price-to-projection pipeline, deterministic forecast, explainable warning overlay, and identity-gated sandbox mitigation. Credit Clicky as inspiration and attribute any reused MIT code. Do not claim track eligibility or originality rules have been verified; check the event's supplied rules before submission.

Target a single selected display and USD checking-account purchases. Native full-screen games, protected content, multiple currencies, credit-card settlement, real bank connectivity, and real money movement are outside the demo scope. Both operating systems require a real-device smoke test; cross-compilation alone is insufficient.

## Approaches considered

1. Recommended: Electron + TypeScript + React desktop application with a small Node service. One shared product and calculation engine across both operating systems. Rebuild the small overlay rather than porting Swift. Screen capture, mixed display scales, and transparent window behavior remain platform validation work.
2. Two Clicky forks: original Swift macOS app plus an independently maintained Windows port. More existing UI reuse, but two runtimes, separate capture behavior, and duplicated integration work are costly in 24 hours.
3. Native macOS first, Windows later: greatest reuse of original Clicky, but does not meet the user's two-platform requirement.

## Product flow

User selects a demo account and display, grants screen permission, and explicitly arms monitoring. After cursor dwell of 700 ms with movement under 8 device-independent pixels, capture once and find a nearby purchase label plus a plausible checkout total. Debounce repeated results for five seconds; permit one extraction job at a time. Stop and discard stale work on disarm or display change. Monitoring is visibly indicated and off by default.

OCR proposes an amount with source text and a bounding box. Prioritize a labeled final total; conflicting totals, unsupported currency, or missing purchase label produce an editable confirmation card. Never silently choose a subtotal or infer taxes. The card offers manual amount entry if capture or recognition fails. Voice is the primary conversational input; typed input in a small cursor-adjacent bubble is the accessible fallback. Hover remains a second entry point into the same conversation.

Show a compact cursor-adjacent card with amount, baseline and after-purchase curves, lowest projected balance/date, reserve threshold, and the bills responsible. Keep the card inside the display work area. Use green for above reserve, amber for below reserve, red for below zero; always include text labels. If baseline is already unsafe, say so without blaming the entire shortfall on the purchase.

For a confidently located purchase button, draw a click-through red outline and arrow when the after-purchase projection is negative. Clear annotations after five seconds, cursor departure, disarm, or a new capture. Do not claim to block the purchase. Uncertain coordinates produce the card only.

## Architecture and trust boundaries

- Electron main process: tray, cursor sampling, selected-display capture, permissions, overlay window lifecycle, and narrow validated IPC. Renderer has context isolation enabled and Node integration disabled.
- React renderer: buddy, forecast chart, amount confirmation, monitoring switch, voice control, and action confirmation. Separate click-through drawing window from interactive card.
- OCR worker: local Tesseract.js recognition, returning words and image-pixel boxes; no financial decisions. Hide overlays during capture and restore after capture to avoid recognizing the application's own warnings.
- Shared TypeScript domain package: money parsing, event normalization, deterministic forecast, reason generation. No provider SDK or UI dependency.
- Node service: Nessie adapter, conversation router, speech provider proxy, and optional Persona adapter/sandbox action ledger. Bind locally for development; desktop holds a session token, provider secrets remain outside renderer and logs. A local service is a demo boundary, not tamper-proof production security.
- Core conversation: global hold-to-talk, speech transcription, a schema-constrained LLM intent router, session memory, deterministic read-only financial tools, and spoken replies. Verify native key-down/key-up support on both OSs early; if unavailable, provide clearly labeled press-to-start/press-to-stop as degraded behavior. Typed input remains available.
- The conversational router receives only the utterance, minimal confirmed purchase context, and session references. It does not receive raw screenshots, full OCR text, provider credentials, or arbitrary tool access. Financial numbers and dates in replies come from deterministic tool results.

Coordinates must explicitly carry display ID, image dimensions, display bounds, and scaling. Convert OCR image pixels to display-relative device-independent pixels, then add desktop origin. Cover negative monitor origins and Windows scaling in unit tests even though the demo selects one display.

## Cursor character and conversational experience

The system pointer stays visible, moves only under the user's control, and keeps ordinary clicking/dragging/text selection. Render a small click-through halo or companion tightly beside it (12–20 DIP offset); never replace the OS pointer with a large mascot or move the actual pointer to gesture. Use the passive annotation surface for the character. Do not show a persistent chat window or conversation sidebar by default.

States: idle (quiet marker while enabled), listening (pulse plus microphone indicator), thinking (subtle orbit), speaking (small pulse synced to playback), needs clarification (brief question bubble), and error (short recovery prompt). Respect reduced-motion preferences. Escape stops recording/playback, cancels the active turn, and clears temporary UI. Barge-in by holding the talk hotkey cancels old speech before listening. Audio recording occurs only during explicit activation, with a 30-second hard limit and stop on lock/suspend or permission loss.

The halo follows the pointer. A response bubble appears beside the current pointer, then stays anchored so users can read or click it; it must not chase the pointer while being interacted with. A graph expands only for a calculation or an explicit request. Auto-dismiss passive responses eight seconds after playback ends (or display for text-only replies), pausing while focused/hovered or pinned. Never auto-dismiss an unanswered clarification or action confirmation. Clear screen annotations when their captured context becomes stale; a pinned purchase reference does not preserve old screen coordinates.

Example: hover tickets → hold hotkey → “Can I afford these?” → pulse and spoken grounded answer → “What if I wait until next Saturday?” → same purchase, new date → “And the headphones I saved?” → combined scenario. The reference fixture's paycheck is Saturday, September 19, 2026, not Friday. Resolve relative dates against the snapshot's date/timezone and repeat the actual date in the response.

Core intents: evaluate current/explicit purchase; change amount/date; pin an explicitly confirmed purchase as considering; compare/combine saved purchases; explain latest result; clear session. Session memory stores the last ten turns and at most ten confirmed purchase references, with amount, label, origin and hypothetical date. It is memory-only, expires after 30 minutes of inactivity, and is cleared on account/data-mode change or explicit Forget. Purchase references are never treated as executed transactions. Financial snapshots retain their separate 60-second freshness policy; remembering a conversation does not authorize reuse of stale finances.

Natural-language input is open, but tool capabilities are bounded. Resolve “this” from a fresh unambiguous screen candidate or explicit confirmation, and “both” only when exactly two references are clear. Ask when the amount, purchase, date, account or intent is ambiguous. Never silently infer a debt, successful checkout, scheduled income, or user preference. Out-of-scope questions receive a brief capability explanation. Untrusted screen text is data, never instructions; the router cannot execute transfers, computer actions, shell commands or arbitrary URLs.

LLM output selects validated read-only intents; deterministic functions calculate all money/date results and construct the financial answer. No model-authored financial amounts reach speech without those facts. Voice and typed input share one turn controller; old OCR/LLM/tool/audio results cannot publish after cancellation, new account selection or a newer turn. Request microphone and cloud-audio consent during onboarding; send only needed utterance/reference text to the configured router, and keep transcript/audio retention off by default.

This revision adds the conversational cursor and its five core abilities, not every earlier brainstormed feature. Subscription analysis, automatic earliest-safe-date search, uncertainty sliders, decision receipts, persistent cross-session memory and unrestricted general-purpose chat remain future ideas. Explicit date comparisons and combined confirmed purchases are in scope.

## Forecast contract

Inputs: selected liquid account balance in integer cents, snapshot timestamp, timezone, today, reserve in cents (demo default $100), and normalized dated cash events. Event fields: stable ID, source ID, date, signed cents, kind, confidence, and whether already reflected in the balance. Reject malformed money and unknown currencies.

Horizon includes today and the next 13 calendar days in the configured timezone. The default purchase is an immediate debit. Conversational scenarios may schedule one or more hypothetical purchases on explicit dates within this same horizon; debit them before any income on that date and include each purchase exactly once. Starting balance must not have historical transactions reapplied. Deduplicate events by provider source ID; expand supported recurring bills only inside the horizon. Exclude cancelled and already-posted events. Include known unsettled obligations once. Show user-entered expenses separately from provider data.

For each day, apply outgoing obligations before incoming funds to avoid hiding an intraday shortfall when exact timing is unknown. Record opening, conservative intraday low, and closing balances. Unconfirmed roommate repayments are excluded from the base case and can be shown only as a labeled alternative scenario. Scheduled income is an assumption, never guaranteed funds.

Safe-to-spend = max(0, minimum baseline balance across opening and event checkpoints minus reserve). For an immediate purchase, after-purchase values subtract the proposed purchase from those same checkpoints. For dated or combined scenarios, recompute the event walk with hypothetical debits at their specified dates; do not subtract a future purchase from earlier balances. Outcome is negative if any after-purchase checkpoint is below zero; otherwise below-reserve if its minimum is below reserve; otherwise within-reserve. Display missing-data and stale-data qualifiers instead of unconditional affordability claims.

Canonical demo: $800 starting balance; $600 rent on day 3; $80 utilities on day 5; $1,000 scheduled income on day 8; $100 reserve. Baseline minimum $120; safe-to-spend $20. A $200 purchase produces a minimum of -$80 on day 5. A $10 purchase leaves $110. Without utilities, the $200 purchase leaves $0 and is a reserve warning, not an overdraft.

## Nessie and data modes

Use actual sandbox accounts and bills where credentials and current API availability permit. Exact base URL, authentication, account fields, bill statuses/recurrence, and transfer semantics must be verified against accessible official documentation and a harmless read before writing the adapter. This is an explicit integration feasibility gate, not a claim that contracts have been verified.

Modes are visible: Live sandbox, Recorded sandbox snapshot, and Synthetic demo. Do not switch silently. A failed request retains a timestamped last snapshot, marks it stale, and disables sandbox action execution. Missing bill data means an incomplete forecast, not zero bills. Refresh on explicit analysis; monitoring may use a cache up to 60 seconds old. Expired snapshots require refresh or an explicit stale preview.

Nessie merchant or transfer history does not establish that someone currently owes the user money. No Venmo integration is planned. A roommate IOU may be synthetic demo data, clearly labeled, and excluded from available funds.

## Persona and mitigation

Stretch feature after the forecast works on both platforms: propose a sandbox transfer from the user's separate savings account to the selected checking account. Confirm the provider supports this before implementation. If unsupported, retain a visibly simulated proposal and do not claim an executed transfer.

Action flow: draft exact source, destination, amount and expiry; show review; create a sandbox Persona inquiry tied server-side to the session and draft; open the hosted flow in the system browser; fetch inquiry status server-side; require approved; present final transfer confirmation; revalidate balance and draft; execute once. Completed alone is not approved. Persona verifies identity, not account ownership or payment consent; demo ownership is explicitly configured.

Persist an action ID and state machine: drafted, verifying, verified, confirmed, submitting, succeeded, failed, unknown. Bind approval to the exact action, expire after five minutes, and invalidate on edits. Client callbacks cannot authorize execution. If submission times out, mark unknown and reconcile by provider lookup; never blindly retry a financial POST. If no reliable reconciliation exists, require manual sandbox inspection. Do not collect production identity documents for this demo.

## Delivery priorities and time budget

- Hours 0–2: verify API and speech/LLM access, Windows test access, upstream license, global hotkey press/release, and screen/overlay feasibility on both systems. If Windows device access is absent, record Windows as unverified rather than claiming support was tested.
- Hours 2–6: shared money/event/forecast engine, deterministic fixtures, and thin Nessie read adapter.
- Hours 6–11: desktop capture, OCR amount confirmation, dwell pipeline, forecast card on both platforms.
- Hours 11–14: coordinate correctness, warning annotations, permission/failure states.
- Hours 14–20: core cursor conversation, speech, reference memory, dated/combined scenarios and grounded replies. If service access is missing, retain a typed deterministic subset and explicitly report the full conversational experience incomplete.
- Persona-gated sandbox mitigation is a stretch goal only if the entire conversational core passes early enough to preserve four hours of final verification; there is no reserved Persona block.
- Hours 20–24: package both targets, real-device smoke tests, demo rehearsal, attribution and submission evidence.

## Acceptance and test strategy

Domain tests: canonical -$80 scenario; $0 versus negative distinction; exact reserve boundary; baseline already negative; same-day debit before credit; day-13/day-14 horizon edge; timezone date boundaries; recurrence deduplication; posted-event exclusion; unconfirmed income exclusion; integer-cent parsing.

Capture tests: multiple totals require confirmation; decimal and thousands separators; missing total; no purchase label; stale extraction cancellation; Retina/125% scaling coordinate conversion; offscreen card clamping. Test against saved synthetic screenshots and then actual browser checkout-like pages on both systems. Performance target: card within 3 seconds of a dwell capture on demo hardware; measure rather than promise this before testing.

Integration tests: malformed Nessie payload, unavailable API, stale snapshot, incorrect account, Persona completed-but-not-approved, expired inquiry, edited action, duplicate submit, and ambiguous transfer response. No real financial actions in tests.

Manual acceptance on each OS: permission denied and restored; selected display capture; overlay remains click-through outside the card; monitor toggle halts capture; amount correction updates forecast; warnings clear; voice denial falls back to typing; process exit cleans up windows. Signed distribution is outside the hackathon scope; document development-build startup requirements.

Conversation tests: follow-up references, missing/ambiguous references, relative dates, delayed purchases, combined purchases, tool-schema rejection, screen prompt injection, cancellation, session expiry and account isolation. Verify hold-to-talk release and normal pointer behavior on each OS.

Demo: talk to the cursor about a checkout-like page, hover a $200 purchase, show -$80 on day 5 and the responsible bill, change purchase to $10, show $110 minimum, optionally complete the identity-gated sandbox mitigation. Keep an explicitly labeled recorded fallback for network failure.

## Research sources and limits

- Original Clicky README: https://github.com/farzaa/clicky — MIT, native macOS, screenshot plus speech pipeline and pointing overlay. Its README does not establish that a reusable OCR/whiteboard implementation exists.
- Windows port: https://github.com/hhsw2015/clicky — separate Python/PyQt implementation; not audited for reuse.
- Electron capture: https://www.electronjs.org/docs/latest/api/desktop-capturer
- Electron windows: https://www.electronjs.org/docs/latest/api/browser-window
- Persona quickstart: https://docs.withpersona.com/api-quickstart-tutorial
- Persona sandbox testing: https://docs.withpersona.com/integration-testing
- Nessie portal: https://api.nessieisreal.com/ — retrieval returned HTTP 403 during planning; live contract remains unverified.
- Supplied video: https://www.youtube.com/watch?v=ZX9A31WoBEs — could not retrieve; no claims based on watching it.

## Planning decisions and handoff

Use the shared Electron approach. Build the conversational cursor and hover-to-forecast core on both platforms before optional Persona mitigation. The user's follow-up requested completion of the remaining plans and then a stop; do not begin implementation until a subsequent instruction after their model switch.

Implementation plan: `../plans/2026-09-12-cursor-financial-bodyguard.md`. Delivery checklist: `../plans/2026-09-12-cursor-financial-bodyguard-demo.md`.

For the demo, day 1 means today (2026-09-12 in the fixed fixture), so rent on day 3 is September 14, utilities on day 5 is September 16, and income on day 8 is September 19. For recurring events, occurrence identity is source ID plus date; deduplicate duplicate source records before expanding occurrences. Scheduled income must be provider-scheduled or explicitly user-entered, never extrapolated silently from historical deposits.

A clearly associated OCR total may show an automatic preview labeled with its extracted amount; it does not authorize an action. Numeric OCR confidence is only a heuristic. Require a single final-total candidate, exact purchase-label match near the cursor, and fresh capture for automatic placement. Otherwise show amount confirmation. Never send screenshots to the financial service or an LLM in the core build.

No application code, dependency installation, repo fork, or provider action has been performed during planning.

## Local privacy and README constraint

This file is part of the visible plan set at `plans/`; keep it aligned with implementation and do not edit README unless requested.
