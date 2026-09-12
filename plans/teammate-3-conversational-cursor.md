# Cursor Financial Bodyguard — Part 3: conversational cursor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after explicit implementation authorization. Steps use checkbox syntax.

**Goal:** Make the cursor the character users talk to: it listens on explicit activation, remembers confirmed hypothetical purchases, answers follow-ups with deterministic financial facts and responds through temporary speech and visuals.

**Owns:** session memory, intent schema/router, scenario follow-ups, speech adapters, hold-to-talk, cursor states, response bubble and conversation tests.

**Does not own:** raw OCR/capture, money arithmetic, Nessie translation, Persona execution, packaging or README.

**Dependencies:** Part 1 exports `Snapshot`, `Forecast`, `evaluateScenario`, `explain`, and authenticated analysis. Part 2 exports fresh candidate registration/confirmation and cursor coordinates. Read companion plans `plans/2026-09-12-conversation-behavior.md` and `plans/2026-09-12-cursor-interaction-design.md`.

## Global constraints

- Voice recording begins only after explicit hold-to-talk/button activation and stops on release, Escape, lock/suspend, permission loss or 30 seconds.
- The native pointer remains visible and movable; the character is a nearby passive halo plus anchored bubble.
- LLM output can select only validated read-only intents; it cannot supply financial facts, call arbitrary tools or execute transfers.
- Store at most ten turns and ten explicitly confirmed hypothetical references; expire after 30 minutes and clear on account/data-mode change or Forget.
- No raw screenshots, provider credentials, arbitrary screen instructions, audio or transcripts are persisted by default.
- If hold-to-talk or provider access fails, expose typed deterministic input and clearly report degraded scope.

## Owned files

Create: `src/service/conversation/{types,session,router,controller}.ts`, `src/domain/scenario.ts`, `src/desktop/talk-hotkey.ts`, `src/ui/{CursorCharacter,ConversationBubble,VoiceControl}.tsx`, `src/service/providers/speech.ts`, `tests/service/{conversation,session,speech}.test.ts`, `tests/domain/scenario.test.ts`, `tests/desktop/talk-hotkey.test.ts`, `tests/ui/CursorCharacter.test.tsx`.

## Task 1 — scenario and session contracts

- [ ] Define `HypotheticalPurchase={id,label,cents,date}`; `PurchaseRef` adds `origin:'screen'|'spoken'|'typed'` and `confirmed`; `ConversationSession` stores account/mode, timestamps, ten-turn buffer, ten references and last scenario.
- [ ] Implement `evaluateScenario(snapshot,purchases,reserveCents):Forecast` by adding dated debits to Part 1's event walk exactly once. Reject duplicate IDs, invalid cents and out-of-horizon dates.
- [ ] Test today $200 → −$80, September 20 $200 → minimum $120 after scheduled income, and tickets + headphones $250 → −$130. Assert dates/status from deterministic output.
- [ ] Implement session expiry with injected clock, explicit Forget, account/mode clearing and coordinate expiry independent from semantic purchase references. Commit `feat: add dated scenarios and bounded conversation memory`.

## Task 2 — grounded intent router and turn controller

- [ ] Define strict intents: `evaluate`, `remember`, `explain`, `forget`, `clarify`, `unsupported`. Route output through runtime schema validation; unknown fields/tool names fail closed.
- [ ] Send the configured structured-output LLM only the utterance, minimal confirmed references, snapshot date/timezone and allowed schema. OCR labels are quoted untrusted data. No screenshot or raw provider response goes to the router.
- [ ] Resolve “this” only from one fresh candidate or explicit remembered reference; “both” only when exactly two references are clear; “What about next Saturday?” changes the active date and repeats the full resolved date. Ambiguity produces a question before calculation.
- [ ] Generate replies from `evaluateScenario`/`explain`, not model-authored amounts. Reject stale snapshots unless user explicitly chooses preview. Recheck account/mode and turn generation before publishing.
- [ ] Test “Can I afford these?” → “What about September 20?” → “and the headphones?”; missing antecedent; evicted reference; account switch; prompt injection in OCR; cancelled turn; fake tool call. Commit `feat: ground conversational turns in validated financial tools`.

## Task 3 — speech and cursor character

- [ ] Implement `transcribe(audio,mime)` and server-owned `synthesize(replyId)` with strict size/MIME/time limits, deadlines and memory-only audio. Arbitrary renderer text cannot become financial speech.
- [ ] Verify provider APIs and credentials at execution time. On denial/failure leave typed bubble available and expose a recoverable state.
- [ ] Implement a narrowly scoped native adapter for configurable Control+Shift+Space press/release, with collision checks, no auto-repeat duplication and cleanup on quit. If a target cannot deliver release, label toggle-to-talk explicitly.
- [ ] Render cursor states `idle`, `listening`, `thinking`, `speaking`, `clarifying`, `error`; halo tracks pointer, bubble anchors at response point, graph opens only for analysis, reduced motion is respected.
- [ ] Escape cancels mic/audio/turn; a new activation barges in and invalidates old results. Bubble dismisses 8 seconds after playback unless pinned/hovered/focused; clarifications remain until answered.
- [ ] Test normal pointer actions under passive overlays, bottom-right/top-left clamping, native key release in another app, mic denial, timeout, barge-in, stale async result, mute, reduced motion and bubble pinning. Commit `feat: make the cursor a grounded conversational companion`.

## Handoff checklist

- [ ] Demonstrate three real turns on both OSs: “Can I afford these?”, “What about September 20?”, “Why?”
- [ ] Give Part 4 actual speech/router permissions, provider latency and packaging requirements.
- [ ] Report if typed deterministic mode is the only working mode; do not present a scripted recording as live conversation.
