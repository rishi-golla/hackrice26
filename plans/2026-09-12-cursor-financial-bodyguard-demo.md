# Cursor Financial Bodyguard — delivery and demo checklist

This accompanies the design specification and implementation plan. It is a future execution checklist, not a record of completed implementation or tests.

## Time allocation

| Hours | Deliverable | Exit criterion |
|---|---|---|
| 0–2 | Desktop boundary, provider feasibility | macOS/Windows access recorded; transparent window proof; data mode selected |
| 2–6 | Forecast and snapshot service | Canonical forecast tests pass; no historical transaction double counting |
| 6–11 | Capture, OCR, amount review, card | Real screen total becomes a visible projection on available target devices |
| 11–14 | Annotation and failure handling | Correct scaling; disarm/cancel works; manual fallback usable |
| 14–20 | Conversational cursor core | Hold-to-talk, spoken grounded replies, follow-up memory and dated/combined scenarios work |
| 20–24 | Packaging and rehearsal | Target builds launched, evidence recorded, narrative rehearsed |

At hour 14, protect the conversational core. Persona is optional and gets no reserved time; attempt it only if the core finishes early. Missing conversation/voice must be reported as incomplete scope, not silently relabeled optional. At hour 20, freeze features and finish validation. A Windows artifact without a Windows launch is not verified two-platform support.

## Inputs to collect at implementation time

- [ ] Access to macOS and Windows demo devices or a Windows runner plus an interactive Windows test device.
- [ ] Official event track wording and open-source reuse/submission rules. Until checked, describe the intended sponsor fit as a proposal.
- [ ] Nessie sandbox credentials and accessible official API reference. Put secrets into local configuration, never into planning documents or chat transcripts.
- [ ] Selected checking account and, for optional mitigation, a separate explicitly demo-owned savings account.
- [ ] Persona sandbox template and API access only if attempting Task 9.
- [ ] Speech and structured-output LLM provider credentials for required Task 8; global press/release support tested on both OSs.

Missing Persona credentials do not block the core. Missing speech/LLM access permits a typed deterministic recovery mode but leaves the full conversational core incomplete. Missing Nessie access selects Synthetic demo explicitly. Missing Windows access remains an unfulfilled validation requirement and must appear in the final implementation report.

## Product acceptance matrix

Run the following on each OS and record pass/fail/blocked with actual build and device details in `docs/verification.md`.

| Check | Expected behavior |
|---|---|
| Fresh launch | Monitoring off; no unsolicited capture; selected mode visible |
| Screen permission denied | Clear recovery guidance and manual amount entry |
| Selected display | Capture corresponds to selected display; other display not analyzed |
| Hover $200 final total | Editable $200 preview; negative minimum -$80 on September 16 in fixed fixture |
| Hover subtotal or conflicting totals | Confirmation required; no invented final price |
| Change amount to $10 | Minimum $110 and within-reserve status |
| Remove utilities, use $200 | Minimum $0; reserve warning, never negative-balance claim |
| Already-negative baseline | Explanation identifies pre-existing shortfall |
| Annotation | Text label outlined accurately; underlying UI remains clickable |
| Cursor departure/disarm | Drawing clears and stale extraction cannot reappear |
| Display scaling | Correct OCR-to-desktop positioning and card inside work area |
| API unavailable | Stale/incomplete or unavailable state; no silent mode switch |
| Explicit stale preview | Timestamp visible and action execution disabled |
| Microphone denied | Typed cursor bubble remains usable; degraded voice state is explicit |
| Talk from another app | Cursor pulses on hold; key release ends recording without opening a chat window |
| Follow-up date | Same purchase retained; date repeated explicitly; event walk recomputed |
| “Both” | Two confirmed references combined or clarification requested |
| Native pointer | Clicking, dragging and text selection unchanged; pointer never moved by agent |
| Bubble lifecycle | Halo follows pointer; bubble remains readable at anchor, dismisses after eight seconds unless interacting/pinned |
| Escape/barge-in | Recording/playback cancelled; stale reply never returns |
| Forget/account switch | Session references cleared, no cross-account memory |
| Optional identity completed only | Transfer stays disabled |
| Optional double confirmation | At most one provider submission |
| Optional submission timeout | Unknown state; no blind retry |
| App quit/restart | Capture, timers, workers, windows and child service cleaned up |
| Packaged offline launch | Synthetic core and bundled OCR start without first-run asset downloads |

Do not manufacture pass results for unavailable integrations. Automated tests should use fake providers and synthetic screens, and should not depend on public checkout sites remaining unchanged.

## Three-minute demo script

1. **0:00–0:20 — Problem.** “A balance tells you what is there now. This previews what a purchase leaves after the bills you already know about.” Show the clearly labeled data source.
2. **0:20–1:10 — Main interaction.** Arm monitoring on the local checkout-like page. Hover the $200 purchase label and hold the talk hotkey: “Can I afford these?” Show the listening pulse and spoken response. Show baseline and after-purchase curves; point to the -$80 minimum on September 16, after rent and utilities but before scheduled income.
3. **1:10–1:40 — Explainability.** Open the reasons, identify $600 rent and $80 utilities, then edit the amount to $10. The minimum becomes $110, above the $100 reserve. Explain that scheduled income is an assumption and missing obligations change the answer.
4. **1:40–2:10 — Conversation memory.** Restore the $200 scenario, then ask “What if I wait until September 20?” The same purchase is retained and the projected minimum becomes $120. Ask “Why?” to hear the bill/paycheck explanation. September 19 still shows a conservative pre-paycheck shortfall; do not promise that buying anytime on payday is safe. If a $50 headphones reference was explicitly saved, ask “And the headphones?” to demonstrate a combined $250 scenario.
5. **2:10–2:40 — Optional identity or second platform.** If Persona and transfers are tested, show the sandbox action review and approved identity gate. Otherwise show the same core interaction on the other operating system. Never substitute a staged success for a live integration claim.
6. **2:40–3:00 — Contribution.** “An existing desktop companion inspired the cursor companion. We built the purchase extraction, cash-flow engine, confidence handling, and financial overlay.” Mention optional integration status accurately.

Use the fixed fixture date in Synthetic demo; live mode uses current date in the configured timezone. Do not mix live data with the fixed demo narrative. A sandbox transfer may be pending: only describe the actual returned state.

## Fallback hierarchy

1. Live Nessie sandbox when verified and working.
2. Explicitly selected Recorded sandbox snapshot with original timestamp and stale indication.
3. Explicitly selected Synthetic demo with deterministic fixture.
4. Manual purchase amount if OCR or screen permissions fail.
5. Clearly labeled recorded demo video if a desktop/device fails during presentation; do not describe the recording as a live run.

For each fallback, explain only the material change. Preserve the same deterministic calculation engine so screenshots or narrative cannot quietly replace the implementation.

## Submission evidence

- [ ] Two-platform verification table, including any untested combinations.
- [ ] Exact tests/build commands and actual results, plus remaining failures.
- [ ] Screenshot or recording of core hover flow and uncertainty flow.
- [ ] Provider mode visible in every demo capture.
- [ ] API usage evidence with credentials and sensitive identifiers redacted.
- [ ] Attribution inventory separating inspiration, copied source and original code.
- [ ] README startup/permission instructions and optional integration status.
- [ ] Confirm actual event rules before claims of sponsor-track compliance.

## Handoff after switching models

Read the design specification first, then the implementation plan. Begin with Task 1 only after the user requests implementation. Keep application code out of this planning session. Do not reopen settled platform/framework decisions unless evidence shows they are infeasible; report that evidence and choose the smallest compatible adjustment. Do not claim blocked external integrations were verified.

Suggested next message:

> Implement the finalized design in specs/2026-09-12-cursor-financial-bodyguard-design.md using plans/2026-09-12-cursor-financial-bodyguard.md. Start with Task 1. Target macOS and Windows, prioritize the conversational cursor, follow-up memory and hover-and-forecast core, and use the delivery checklist to verify and document the result.

## Local privacy and README constraint

This file is part of the visible plan set at `plans/`; keep it aligned with implementation and do not edit README unless requested.
