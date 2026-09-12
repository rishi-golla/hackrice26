# Cursor Financial Bodyguard — Part 2: capture, OCR and overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans after explicit implementation authorization. Steps use checkbox syntax.

**Goal:** Turn a selected-display cursor dwell into a reviewable purchase candidate and a cursor-adjacent forecast card without changing ordinary pointer behavior.

**Owns:** Electron capture, display coordinates, dwell/cancellation pipeline, local OCR, amount confirmation, forecast card, chart and passive warning annotation.

**Does not own:** cents arithmetic, Nessie translation, conversational routing, speech, Persona actions, packaging or README.

**Spec:** `specs/2026-09-12-cursor-financial-bodyguard-design.md`

**Inputs from Part 1:** `Snapshot`, `Forecast`, `Frame`, service `POST /forecast`, and typed IPC validation. Use a fake snapshot/provider while Part 1 is in progress. Do not reimplement the financial engine.

## Global constraints

- Monitoring is off by default, visibly armed, and limited to one explicitly selected display.
- Capture is on demand after 700 ms dwell within 8 DIP; cooldown is 5 seconds and only one OCR job runs at once.
- The system pointer remains visible and under user control; passive surfaces are click-through.
- OCR proposes amounts; ambiguous, stale or unsupported results require confirmation/manual entry.
- Hide overlays during capture and restore them in `finally`; do not persist screenshots.
- Coordinates carry display ID, bounds, work area, image size and scale; test Retina, 125% Windows scaling and negative origins.

## Owned files

Create: `src/desktop/{main,preload,windows,capture,coordinates,monitor,pipeline}.ts`, `src/desktop/ocr/{recognize,extract}.ts`, `src/ui/{main,App,ForecastCard,ForecastChart,AmountForm,Annotation}.tsx`, `src/ui/styles.css`, `tests/desktop/`, `tests/ui/`, `tests/fixtures/checkout.png`, `index.html`.

## Task 1 — windows, coordinate mapping and capture

- [ ] Write `overlayPolicy` test requiring transparent frameless always-on-top windows, `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`; the annotation window must call `setIgnoreMouseEvents(true)` and `setFocusable(false)`.
- [ ] Define and test `Rect`, `Frame`, `CursorSample`, `toDesktopRect(box,frame)` and `clampCard(anchor,size,workArea)`. Map `x=bounds.x+box.x*bounds.width/imageWidth` and corresponding y/width/height; never scale twice.
- [ ] Implement selected-display capture via Electron desktopCapturer keyed by display ID, not source array order. Hide both overlays before capture and restore in a `finally` block.
- [ ] Denied screen permissions must expose recoverable instructions and manual amount entry. No loop that repeatedly prompts without user action.
- [ ] Test 699 ms no dwell, 700 ms one dwell, anchor movement reset, cooldown, display change, disarm and no concurrent capture. Commit `feat: capture selected display with safe coordinate mapping`.

## Task 2 — OCR and purchase candidate extraction

- [ ] Define `OcrWord={text,confidence,box,lineId}` and `PurchaseCandidate={amountCents,sourceText,state,buttonBox,totalBox,reason}`.
- [ ] Write direct-word tests: subtotal alone cannot preview; conflicting totals require confirm; euro is unsupported; missing purchase phrase is no candidate; stale frame is rejected.
- [ ] Implement a persistent English Tesseract worker with bundled assets, word/line boxes, 5-second timeout and termination on quit. Late output cannot publish after cancellation.
- [ ] Recognize only final-total labels `total`, `order total`, `grand total`; exclude subtotal, savings, crossed-out and installment-only values. Match `buy now`, `checkout`, `place order`, `complete purchase`.
- [ ] Automatic preview requires one unique valid USD final total, final-total and purchase phrase confidence ≥90, cursor association within 80 DIP and frame age ≤3 seconds. Else return confirmation/manual state.
- [ ] Do not infer tax/shipping, convert currency, multiply installments or trust text instructions embedded in the screen. Commit `feat: extract reviewable checkout candidates with local OCR`.

## Task 3 — forecast card and passive annotation

- [ ] Write the UI test against the Part 1 fixture: synthetic badge, −$80, projected-negative label and responsible bills render. Test amber $0, stale/incomplete badges, amount edit, text-only result and dismiss.
- [ ] Implement a 360-DIP expandable card with amount, editable input, two SVG curves, zero/reserve lines, low-point date, reasons, freshness timestamp and data-mode badge. Use exact statuses `Projected negative balance`, `Below your reserve`, `Within your reserve`.
- [ ] Place the passive cursor halo 12–20 DIP beside the real pointer. The card anchors once and clamps inside workArea; it must not chase the pointer or steal focus. Keep ordinary clicking, dragging, selection and scrolling working underneath.
- [ ] Render annotation only for fresh confirmed coordinates plus `negative` status. Add 6 DIP padding, red outline/arrow and warning text. Clear after 5 seconds, cursor departure, new capture, disarm or display change.
- [ ] Preserve a manual amount flow whenever permissions/OCR fail. Monitor→candidate→analysis requests use generation IDs so late results cannot reappear.
- [ ] Measure five dwell-to-card runs per OS; target ≤3 seconds but report actual timing. Commit `feat: show explainable purchase impact beside cursor`.

## Handoff checklist

- [ ] Provide Part 3 a candidate registry interface: `registerCandidate(candidate):string`, `confirmCandidate(id):PurchaseRef`, `onCandidate(listener):unsubscribe`.
- [ ] Provide Part 4 actual OS permission and coordinate evidence.
- [ ] Run Part 1 domain/service tests alongside desktop/UI tests; no duplicate forecast arithmetic.
- [ ] Do not ship persistent chat UI from this part; Part 3 owns the conversational bubble.
