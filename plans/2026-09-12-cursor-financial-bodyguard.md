# Cursor Financial Bodyguard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task after the user authorizes implementation. Use superpowers:subagent-driven-development only if delegation is subsequently requested. Steps use checkbox syntax for tracking.

**Goal:** Deliver a macOS and Windows conversational cursor that understands purchase questions and follow-ups, and explains their 14-day financial impact through speech and temporary visuals.

**Architecture:** Electron owns desktop capture and windows; React renders the buddy and forecast. A pure TypeScript domain module calculates results, while a local Node service isolates sandbox provider credentials and optional action execution. OCR remains local and cannot initiate financial actions.

**Tech Stack:** Electron, TypeScript, React, Vite, Tesseract.js, Node.js, Fastify, Zod, Vitest, React Testing Library, Electron Builder; ElevenLabs Scribe v2 transcription, ElevenLabs text-to-speech, and a configurable structured-output LLM provider for intent routing. Choose compatible stable releases at execution time, verify their official documentation, and commit exact resolved versions in package-lock.json. No dependencies are installed by this plan.

**Spec:** `specs/2026-09-12-cursor-financial-bodyguard-design.md`

## Global Constraints

- Target a single selected display and USD checking-account purchases.
- Both operating systems require a real-device smoke test; cross-compilation alone is insufficient.
- Monitoring is visibly indicated and off by default.
- Never silently choose a subtotal or infer taxes.
- Renderer has context isolation enabled and Node integration disabled.
- Completed alone is not approved.
- Client callbacks cannot authorize execution.
- No Venmo integration is planned.
- Do not collect production identity documents for this demo.
- Never send screenshots to the financial service or an LLM in the core build.
- The cursor is the character; temporary overlays are its gestures.
- The system pointer stays visible and moves only under user control.
- Voice and follow-up conversation are core requirements; Persona remains optional.
- No application implementation in the planning session; begin only after a new user instruction.

## Scope and dependencies

The core is Tasks 1–8 and 10. Task 8 is the required conversational cursor, including voice and session memory. Optional identity-gated mitigation is Task 9, independently skippable without breaking the read-only core. Task 10 is mandatory even when optional features are omitted. Sequence: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → optional 9 → 10. Individual checklist entries are small actions; each task is a coherent reviewable deliverable.

There is no existing application in this repository. All application paths below are proposed new files, not claims about existing code. Inspect AGENTS.md and current git status again at execution time. Use a `codex/` branch if creating a branch; preserve the visible planning documents. Do not copy planning content into unrelated public docs. Do not clone Clicky into this repository as the implementation foundation.

## File ownership map

| Path | Responsibility |
|---|---|
| package.json, package-lock.json, tsconfig.json, vite.config.ts, vitest.config.ts, electron-builder.yml | One root package, compilation, tests, packaging |
| src/domain/types.ts, money.ts, dates.ts, normalize.ts, forecast.ts, explain.ts | Pure monetary/event logic |
| src/fixtures/demo.ts | Deterministic synthetic account, bills and income |
| src/contracts/api.ts, desktop.ts | Runtime request validation and typed boundaries |
| src/service/server.ts, config.ts, snapshot.ts | Local authenticated service and snapshot policy |
| src/service/providers/nessie.ts, persona.ts, speech.ts | Provider-specific translation |
| src/service/conversation/types.ts, session.ts, router.ts, controller.ts | Validated intents, reference memory and grounded turns |
| src/domain/scenario.ts | Dated and combined hypothetical purchase calculation |
| src/desktop/talk-hotkey.ts; src/ui/CursorCharacter.tsx, ConversationBubble.tsx | Cursor states, activation and temporary replies |
| src/service/actions/types.ts, ledger.ts, coordinator.ts | Optional action lifecycle |
| src/desktop/main.ts, preload.ts, windows.ts, capture.ts, coordinates.ts, monitor.ts, pipeline.ts | Electron orchestration |
| src/desktop/ocr/recognize.ts, extract.ts | Worker lifecycle and purchase candidates |
| src/ui/main.tsx, App.tsx, ForecastCard.tsx, ForecastChart.tsx, AmountForm.tsx, Annotation.tsx, VoiceControl.tsx, ActionReview.tsx, styles.css | Product UI |
| tests/domain/, tests/service/, tests/desktop/, tests/ui/ | Behavior tests grouped by boundary |
| scripts/seed-sandbox.ts | Explicit sandbox-only fixture preparation after contract verification |
| demo/checkout.html | Clearly labeled local checkout-like demo page |
| docs/provider-contracts.md, docs/verification.md, docs/attribution.md | API evidence, test results, credits and startup |

## Task 1: Establish the runnable desktop boundary and feasibility gate

**Files:** Create root configuration files from the map, `src/desktop/{main,preload,windows}.ts`, `src/ui/{main.tsx,App.tsx,styles.css}`, `index.html`, `src/contracts/desktop.ts`, `tests/desktop/window-policy.test.ts`, `docs/provider-contracts.md`, `.gitignore`, `.env.example`.

**Interfaces:** Produce `createDesktopWindows(): { card: BrowserWindow; annotation: BrowserWindow }`; expose `window.bodyguard.setMonitoring(enabled: boolean): Promise<void>` via a typed preload bridge. Initially monitoring only changes visible state; capture arrives in Task 5.

- [ ] Inspect the current machine's Node/Xcode/toolchain and available Windows runner/device. Record OS versions and test access. Verify Electron's current supported OS versions; set the package's supported minimum to those versions without claiming older support.
- [ ] Review official Nessie documentation supplied by the event or accessible portal. Record base URL, authentication scheme, exact account/bill read contracts, response examples with IDs anonymized, recurrence semantics, and balance meaning in `docs/provider-contracts.md`. Do not log API keys or query strings containing keys. If inaccessible, record `liveSandboxAvailable: false`, reason, and use synthetic mode; proceed with core work.
- [ ] Verify global hold-to-talk key-down/key-up support on both targets through a narrowly scoped native adapter; record permission and packaging requirements. Verify configured speech and structured-output LLM access. If key release is unavailable, explicitly mark toggle-to-talk as degraded, rather than claiming hold-to-talk works.
- [ ] Verify Persona sandbox account/template availability only if credentials are supplied. Record approved-status semantics and allowed hosted-flow URLs. Do not create production inquiries.
- [ ] Set up one TypeScript package with scripts `dev`, `build`, `typecheck`, `test`, `test:watch`, `package:mac`, and `package:win`. `test` must mean `vitest run`; `typecheck` means `tsc --noEmit`; package commands must build first. Compile main/preload separately from the browser renderer. Ignore `.env`, logs, recordings, local ledgers, `dist`, `release`, and `node_modules`.
- [ ] Write the policy test, then run `npm test -- tests/desktop/window-policy.test.ts`; expect a failure until the policy exists:

```ts
import { expect, it } from 'vitest';
import { overlayPolicy } from '../../src/desktop/windows';
it('isolates the renderer and makes drawing passive', () => {
  expect(overlayPolicy.webPreferences).toMatchObject({
    contextIsolation: true, nodeIntegration: false, sandbox: true,
  });
  expect(overlayPolicy.transparent).toBe(true);
  expect(overlayPolicy.frame).toBe(false);
});
```

- [ ] Implement `overlayPolicy` and window creation using the following policy, with a separate interactive card. Export policy without starting Electron during a test; separate Electron initialization if module imports require it.

```ts
export const overlayPolicy = {
  transparent: true, frame: false, alwaysOnTop: true,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
};
// Main process after creation:
// annotation.setIgnoreMouseEvents(true);
// annotation.setFocusable(false);
// card must accept clicks but must not steal focus when merely showing a preview.
```

- [ ] Validate IPC sender is a known application window and validate boolean inputs. Apply a restrictive content security policy, deny arbitrary navigation/new windows, and never expose generic shell, filesystem, or HTTP execution through preload.
- [ ] Run the test, typecheck, and development app. Manually verify transparent overlay and card clicks on both OSs if available; record a missing Windows device as an unresolved validation item, not a passing check.
- [ ] Commit only this task's non-plan application files with message `chore: establish desktop shell and integration gates`.

## Task 2: Define cents, dates, events and reproducible fixtures

**Files:** Create `src/domain/{types,money,dates,normalize}.ts`, `src/fixtures/demo.ts`, `tests/domain/{money,normalize,dates}.test.ts`.

**Interfaces:** Define the canonical types below. Export `parseUSD(text: string): number`, `addDays(date: string, offset: number): string`, `normalizeEvents(events: CashEvent[], today: string): CashEvent[]`, and `demoSnapshot(): Snapshot`.

```ts
export type DataMode = 'live-sandbox' | 'recorded-sandbox' | 'synthetic';
export type CashEvent = {
  id: string; sourceId: string; date: string; cents: number;
  label: string; kind: 'bill' | 'income' | 'transfer' | 'expense';
  confidence: 'scheduled' | 'user-entered' | 'unconfirmed';
  reflectedInBalance: boolean; cancelled: boolean;
  recurrence?: 'monthly';
};
export type Snapshot = {
  accountId: string; balanceCents: number; currency: 'USD';
  asOf: string; today: string; timezone: string; mode: DataMode;
  complete: boolean; stale: boolean; events: CashEvent[];
};
export type DayPoint = { date: string; openingCents: number; lowCents: number; closingCents: number };
export type Forecast = {
  baseline: DayPoint[]; afterPurchase: DayPoint[];
  minimumCents: number; minimumDate: string; baselineMinimumCents: number;
  safeToSpendCents: number; purchaseCents: number; reserveCents: number;
  status: 'negative' | 'below-reserve' | 'within-reserve';
  complete: boolean; stale: boolean; reasons: string[];
};
```

- [ ] Write the tests below and run `npm test -- tests/domain/money.test.ts tests/domain/normalize.test.ts tests/domain/dates.test.ts`; expect missing exports initially.

```ts
import { expect, it } from 'vitest';
import { parseUSD } from '../../src/domain/money';
it('parses cents without float multiplication', () => {
  expect(parseUSD('$1,234.56')).toBe(123456);
  expect(parseUSD('0.10')).toBe(10);
  for (const text of ['€200', '1.234,56', '20.009', '-1', '1,00']) {
    expect(() => parseUSD(text)).toThrow();
  }
});
```

- [ ] Implement parsing with a strict optional USD/$ prefix, valid comma grouping, whole dollars and up to two decimals. Strip grouping only after validation; calculate whole-part × 100 plus a right-padded two-digit fractional part; reject unsafe integers. Date utilities validate ISO calendar dates and add days through UTC calendar arithmetic, not local millisecond offsets. Derive live `today` with `Intl.DateTimeFormat(..., {timeZone})`.
- [ ] Create the synthetic fixture: balance 80000, USD, account `demo-checking`, today `2026-09-12`, timezone `America/Chicago`, fixed asOf timestamp, complete true, stale false, mode synthetic. Bill events: rent -60000 on 2026-09-14 and utilities -8000 on 2026-09-16. Scheduled income +100000 on 2026-09-19. Set reflected/cancelled false; IDs and source IDs distinct.
- [ ] Normalize by rejecting conflicting duplicate source records; deduplicate identical records; expand monthly schedules into the horizon using source ID plus occurrence date. Clamp month-end occurrences to the month's last day while retaining the original anchor day. Reject unsupported recurrence values at the provider boundary. Exclude reflected, cancelled, unconfirmed and pre-today events from forecasts; surface overdue unreflected obligations as incomplete data in Task 4.
- [ ] Add exact tests: monthly Jan 31 → Feb 28 in 2027; duplicate rent yields one debit; reflected rent yields zero debits; unconfirmed +15000 yields no base income; date today+13 included and today+14 excluded; timezone conversion across UTC midnight; conflicting source amount fails. Run this task's tests and typecheck.
- [ ] Commit with `feat: add validated cash-flow inputs and fixtures`.

## Task 3: Implement the deterministic forecast and explanation

**Files:** Create `src/domain/{forecast,explain}.ts`, `tests/domain/forecast.test.ts`, `tests/domain/explain.test.ts`.

**Interfaces:** Consume Snapshot/CashEvent; produce `forecast(snapshot: Snapshot, purchaseCents: number, reserveCents: number): Forecast` and `explain(result: Forecast): string`. Reject negative purchase/reserve values, fractional cents and unsafe arithmetic.

- [ ] Write the canonical tests and run `npm test -- tests/domain/forecast.test.ts tests/domain/explain.test.ts`; expect failure before implementation.

```ts
import { expect, it } from 'vitest';
import { forecast } from '../../src/domain/forecast';
import { demoSnapshot } from '../../src/fixtures/demo';
it('finds the shortfall before scheduled income', () => {
  const r = forecast(demoSnapshot(), 20000, 10000);
  expect(r).toMatchObject({ minimumCents: -8000, minimumDate: '2026-09-16',
    baselineMinimumCents: 12000, safeToSpendCents: 2000, status: 'negative' });
  expect(r.baseline).toHaveLength(14);
});
it('separates reserve risk from a negative balance', () => {
  const s = demoSnapshot();
  s.events = s.events.filter(e => e.label !== 'Utilities');
  expect(forecast(s, 20000, 10000)).toMatchObject({minimumCents: 0, status: 'below-reserve'});
});
it('allows equality with reserve', () => {
  expect(forecast(demoSnapshot(), 2000, 10000).status).toBe('within-reserve');
});
```

- [ ] Implement the event walk. Normalize first; for each calendar date sort negative events before positive events, breaking ties by ID. Record opening and each post-event balance; low includes opening. Derive the after-purchase curve by subtracting the purchase from every value. Choose the earliest date on tied minima.

```ts
// Core arithmetic; integrate in forecast() with validated inputs.
const safeToSpendCents = Math.max(0, baselineMinimumCents - reserveCents);
const status = minimumCents < 0 ? 'negative'
  : minimumCents < reserveCents ? 'below-reserve' : 'within-reserve';
```

- [ ] Generate reasons from actual negative events through the first minimum and their dates, plus scheduled-income, stale, incomplete and already-negative-baseline qualifiers. `explain` formats those computed values; no LLM is allowed to invent amounts, bills, income, or transfers.
- [ ] Add tests for $10 → minimum $110, baseline negative at opening, outgoing-before-incoming on the same date, no events, unknown income exclusion, purchase 0, date edges, and safe-integer overflow. Explanation tests assert amount/date/status facts and stale/incomplete qualifiers, avoiding brittle exact wording.
- [ ] Run this task's tests and the existing domain suite, then typecheck. Commit with `feat: calculate explainable fourteen-day purchase impact`.

## Task 4: Implement the authenticated snapshot service and Nessie adapter

**Files:** Create `src/contracts/api.ts`, `src/service/{config,server,snapshot}.ts`, `src/service/providers/nessie.ts`, `tests/service/{snapshot,auth,nessie}.test.ts`; update `.env.example` and `docs/provider-contracts.md`.

**Interfaces:** `SnapshotProvider.read(accountId: string): Promise<Snapshot>`; `SnapshotStore.get(accountId: string, refresh: boolean): Promise<Snapshot>`; `buildServer(config, provider): FastifyInstance`. Define config type with `sessionToken: string`, `mode: DataMode`, and allowed account IDs. Runtime schemas mirror domain types.

Internal routes (these are our routes, not unverified Nessie endpoint claims):

| Route | Input | Output |
|---|---|---|
| GET /health | none | `{ok:true}` with no account/config data |
| GET /snapshot?accountId=...&refresh=true | allowlisted account ID | Snapshot |
| POST /forecast | `{accountId,purchaseCents,reserveCents,allowStale:boolean}` | `{snapshot,forecast}` |

- [ ] Write service tests using Fastify injection and fake provider, then run `npm test -- tests/service`. Test unauthorized requests return 401, unknown account returns 403, invalid money returns 400, and provider failure without a cached snapshot returns 503.

```ts
import { expect, it } from 'vitest';
import { buildServer } from '../../src/service/server';
import { demoSnapshot } from '../../src/fixtures/demo';
it('does not expose snapshots without session authorization', async () => {
  const app = buildServer({ sessionToken:'test-secret', mode:'synthetic',
    accountIds:['demo-checking'] }, { read: async () => demoSnapshot() });
  const res = await app.inject({method:'GET',url:'/snapshot?accountId=demo-checking'});
  expect(res.statusCode).toBe(401);
  await app.close();
});
```

- [ ] Implement the local service as a child process managed by Electron. Bind to 127.0.0.1 and an available port. Pass a random per-launch token via process environment; renderer accesses only the preload bridge, never the token. Main owns service requests; reject requests from untrusted origins and do not enable broad CORS.
- [ ] Implement snapshot caching per account with an injected clock. At <=60000 ms use cache for monitoring; explicit analysis requests refresh. On failure with cache, return stale true; POST /forecast rejects stale data unless allowStale is true. Never convert malformed/missing bills into an empty complete list. Never change data mode automatically.
- [ ] Implement Nessie read translation only from Task 1's verified contract. Keep raw monetary parsing decimal-safe. Use configured selected accounts; exclude non-liquid accounts from the spend calculation. Reject unexplained balance semantics, unsupported recurrence and unknown bill status as incomplete or contract errors. Historical deposits do not become scheduled income. Overdue unreflected obligations make the snapshot incomplete.
- [ ] If live contracts are unavailable, implement synthetic and explicitly imported recorded Snapshot providers only. Record live adapter as unavailable and disable live selection; do not fabricate an HTTP endpoint. Captured snapshots must be sanitized and opt-in, with keys excluded.
- [ ] Add fake-clock tests for 60-second expiry, forced refresh, stale preview opt-in, separate-account caches, malformed payload, repeated bill IDs and missing bills. Run service/domain tests and typecheck. Commit with `feat: serve validated sandbox snapshots and forecasts`.

## Task 5: Implement capture, coordinates, dwell and cancellation

**Files:** Create `src/desktop/{capture,coordinates,monitor,pipeline}.ts`, `tests/desktop/{coordinates,monitor,pipeline}.test.ts`; modify `main.ts`, `preload.ts`, `src/contracts/desktop.ts`.

**Interfaces:**

```ts
export type Rect = {x:number;y:number;width:number;height:number};
export type Frame = {id:string;capturedAt:number;displayId:string;
  bounds:Rect;workArea:Rect;imageWidth:number;imageHeight:number;png:Uint8Array};
export type CursorSample = {x:number;y:number;displayId:string;at:number};
// captureDisplay(displayId:string): Promise<Frame>
// toDesktopRect(box:Rect, frame:Frame): Rect
// clampCard(anchor:{x:number;y:number}, size:{width:number;height:number}, workArea:Rect): Rect
// createMonitor(onDwell:(sample:CursorSample)=>void):
//   {setEnabled(enabled:boolean):void;sample(value:CursorSample):void;dispose():void}
// createPipeline<T>(extract:(frame:Frame)=>Promise<T>, publish:(value:T)=>void):
//   {run(frame:Frame):Promise<void>;invalidate():void}
```

- [ ] Write coordinate tests and run `npm test -- tests/desktop/coordinates.test.ts`.

```ts
import { expect, it } from 'vitest';
import { toDesktopRect } from '../../src/desktop/coordinates';
it('maps Retina pixels onto a display with a negative desktop origin', () => {
  const frame = {id:'f',capturedAt:0,displayId:'left',
    bounds:{x:-1440,y:0,width:1440,height:900},workArea:{x:-1440,y:0,width:1440,height:900},
    imageWidth:2880,imageHeight:1800,png:new Uint8Array()};
  expect(toDesktopRect({x:200,y:100,width:400,height:80},frame))
    .toEqual({x:-1340,y:50,width:200,height:40});
});
```

- [ ] Implement mapping by actual image dimensions (do not apply display scale twice): `x = bounds.x + box.x * bounds.width / imageWidth`, with corresponding y/width/height ratios. Clamp the card in workArea. Add 125% scaling, edge clamping and invalid dimensions cases.
- [ ] Implement capture using Electron desktopCapturer for the explicitly selected display. Temporarily hide card/annotation windows and restore in finally, after a compositor frame where necessary. Match source display_id to Electron display ID; do not assume array order. Capture on demand; do not retain image files. If permission is denied, expose a recoverable state with platform-specific instructions and manual input.
- [ ] Implement 100 ms cursor sampling while armed. Start dwell from a fixed anchor; trigger after 700 ms staying within 8 DIP. Movement resets the anchor; cooldown is 5000 ms. Display change and disarm invalidate work. One OCR run may remain physically running after cancellation, but its generation token cannot publish.

```ts
// Generation guard inside createPipeline:
let generation = 0;
let busy = false;
// invalidate(): generation += 1
// run(frame): if busy return; capture generation; set busy true;
// await extract(frame); publish only if captured generation === generation;
// finally set busy false. Do not enqueue an unbounded capture backlog.
```

- [ ] Use fake timers/deferred promises to test no dwell at 699 ms, one dwell at 700 ms, anchor drift reset, no concurrent job, cooldown, and late result discarded after disarm. Stop timers on app quit. Run tests and manually capture on both operating systems.
- [ ] Commit with `feat: capture selected display on cancellable cursor dwell`.

## Task 6: Extract purchase candidates with an explicit uncertainty state

**Files:** Create `src/desktop/ocr/{recognize,extract}.ts`, `tests/desktop/{ocr,extract}.test.ts`, `tests/fixtures/checkout.png`; modify `pipeline.ts`.

**Interfaces:** `recognize(frame: Frame): Promise<OcrWord[]>`; `extractPurchase(words: OcrWord[], cursorInImage: {x:number;y:number}): PurchaseCandidate`.

```ts
export type OcrWord = {text:string; confidence:number; box:Rect; lineId:string};
export type PurchaseCandidate = {
  amountCents:number|null; sourceText:string;
  state:'preview'|'confirm'|'no-candidate';
  buttonBox:Rect|null; totalBox:Rect|null;
  reason:'single-total'|'ambiguous'|'missing-total'|'missing-button'|'unsupported-currency'|'low-confidence';
};
```

- [ ] Write extraction tests and run `npm test -- tests/desktop/extract.test.ts`. Construct words directly for fast deterministic tests:

```ts
import { expect, it } from 'vitest';
import { extractPurchase } from '../../src/desktop/ocr/extract';
it('does not treat a subtotal as a final total', () => {
  const words = [
    {text:'Subtotal',confidence:99,lineId:'1',box:{x:0,y:0,width:60,height:20}},
    {text:'$200.00',confidence:99,lineId:'1',box:{x:70,y:0,width:80,height:20}},
  ];
  expect(extractPurchase(words,{x:20,y:50}).state).not.toBe('preview');
});
```

- [ ] Create one persistent English Tesseract worker with word/line bounding-box output enabled per the installed version's official API. Bundle its language/worker assets so demo runtime does not depend on a first-use download. Terminate on quit. A recognition timeout of 5 seconds returns manual-entry state and ignores late output.
- [ ] Group words by line. Recognize exact normalized labels `total`, `order total`, `grand total`; exclude `subtotal`, savings, crossed-out/duplicate ambiguous totals, and installment-only amounts. Match purchase phrases `buy now`, `checkout`, `place order`, `complete purchase`. Use cursor distance <=80 DIP converted to image coordinates for label association. OCR boxes refer to text, so annotate the recognized label rectangle with padding rather than pretending to know the full button border.
- [ ] Automatic preview requires one unique valid USD final total, final-total line and purchase phrase confidences >=90 on the 0–100 OCR scale, a cursor-associated phrase, and a frame <=3 seconds old when published. This threshold is a heuristic; visible amount remains editable. Any ambiguity returns confirm; missing amount returns null. Unsupported currencies are rejected, not converted. Never infer tax/shipping or multiply an installment into a final total.
- [ ] Add cases for two conflicting totals, repeated equal total, subtotal plus final total, unsupported euro, low confidence, missing purchase phrase, unrelated nearby price and stale frame. Run one integration OCR test against a saved synthetic screenshot with a known total; record output confidence and boxes without logging unrelated screen contents.
- [ ] Run desktop tests and typecheck. Commit with `feat: extract reviewable checkout totals with local OCR`.

## Task 7: Connect the forecast card and warning annotation

**Files:** Create `src/ui/{ForecastCard,ForecastChart,AmountForm,Annotation}.tsx`, `tests/ui/ForecastCard.test.tsx`, `tests/desktop/annotation.test.ts`; modify `App.tsx`, `styles.css`, `windows.ts`, `pipeline.ts`, `src/contracts/desktop.ts`.

**Interfaces:** Bridge methods `analyze({purchaseCents:number,allowStale:boolean}): Promise<{snapshot:Snapshot;forecast:Forecast}>`, `setMonitoring(boolean)`, `selectDisplay(string)`, `selectAccount(string)`, `onCandidate(listener): ()=>void`. Validate all requests in main and use account IDs from settings, never from OCR. ForecastCard props are `{snapshot:Snapshot;forecast:Forecast;onAmountChange:(cents:number)=>void}`.

- [ ] Write a React test and run `npm test -- tests/ui/ForecastCard.test.tsx` with jsdom:

```tsx
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ForecastCard } from '../../src/ui/ForecastCard';
import { forecast } from '../../src/domain/forecast';
import { demoSnapshot } from '../../src/fixtures/demo';
it('shows the lowest balance and data provenance', () => {
  const snapshot = demoSnapshot();
  render(<ForecastCard snapshot={snapshot} forecast={forecast(snapshot,20000,10000)}
    onAmountChange={() => {}} />);
  expect(screen.getByText(/Synthetic demo/i)).toBeTruthy();
  expect(screen.getByText(/-\$80\.00/)).toBeTruthy();
  expect(screen.getByText(/projected negative balance/i)).toBeTruthy();
});
```

- [ ] Treat this card as a temporary expandable response, not a permanent chat interface. Keep the native pointer unchanged; Task 8 adds the character and conversational lifecycle.
- [ ] Implement a 360-DIP-wide card with purchase amount, accessible status text, two SVG curves, reserve line, minimum/date, bill reasons, freshness timestamp, data-mode badge, amount editor and dismiss. Limit height to the current work area with scrolling. Keep the chart data range inclusive of zero, reserve and both curve extrema; show intraday low markers so a closing-only line cannot hide risk.
- [ ] Use exact labels `Projected negative balance`, `Below your reserve`, and `Within your reserve`; prefix incomplete/stale results with corresponding qualifiers. Show scheduled income as an assumption. A pre-existing baseline shortfall gets explicit text. No “guaranteed safe” wording.
- [ ] Wire candidate preview to cached snapshot forecast. Manual amount confirmation triggers fresh analysis. Error and permission states retain manual entry. Display mode is always visible and may only change through explicit user selection. Disarming hides passive overlays and prevents new captures.
- [ ] Implement annotations only for negative status plus fresh confirmed label coordinates. Convert text bounds and add 6 DIP padding; draw red rounded rectangle/arrow and warning label. Drawing window ignores all mouse input. Clear after 5000 ms, cursor departure from padded region, new capture, disarm, or display change. Card receives interaction independently.
- [ ] Add tests for amber at zero, missing/stale badges, amount edit recalculation, text-only risk when no box exists, timeout clearing and disarm clearing. Measure dwell-to-card latency; target <=3 seconds on both demo devices, and log only duration metrics.
- [ ] Run domain/service/desktop/UI tests, typecheck, build and manual core flow on both systems. Commit with `feat: show purchase impact beside the cursor`.

## Task 8: Core conversational cursor, session memory and voice

**Entry condition:** Task 7 works. This task is required for the revised product, not optional polish. Reserve hours 14–20; omit Persona before cutting this task. If speech/LLM access fails, a typed deterministic subset is a recovery path, and the final report must identify full conversation as incomplete.

**Files:** Create `src/service/conversation/{types,session,router,controller}.ts`, `src/domain/scenario.ts`, `src/desktop/talk-hotkey.ts`, `src/ui/{CursorCharacter,ConversationBubble,VoiceControl}.tsx`, `src/service/providers/speech.ts`, `tests/service/{conversation,session,speech}.test.ts`, `tests/domain/scenario.test.ts`, `tests/desktop/talk-hotkey.test.ts`, `tests/ui/CursorCharacter.test.tsx`. Modify service routes, main/preload, App and desktop contracts.

**Interfaces:** All types below belong to conversation/types.ts except HypotheticalPurchase (domain/scenario.ts). Router provider is injected; validate output with a strict discriminated Zod union. No unlisted tool names or extra fields.

```ts
export type HypotheticalPurchase = {id:string;label:string;cents:number;date:string};
export type PurchaseRef = HypotheticalPurchase & {origin:'screen'|'spoken'|'typed';confirmed:boolean};
export type Intent =
  | {kind:'evaluate';purchaseIds:string[];amountCents?:number;date?:string}
  | {kind:'remember';purchaseId:string}
  | {kind:'explain'} | {kind:'forget'}
  | {kind:'clarify';question:string} | {kind:'unsupported'};
export type ConversationSession = {id:string;accountId:string;mode:DataMode;
  lastActivityAt:number;references:PurchaseRef[];
  turns:{role:'user'|'assistant';text:string}[];lastScenario:HypotheticalPurchase[]};
export type CursorState = 'idle'|'listening'|'thinking'|'speaking'|'clarifying'|'error';
export type TurnRequest = {sessionId:string;turnId:string;text:string;candidateId?:string};
export type TurnReply = {turnId:string;replyId:string;state:CursorState;text:string;
  forecast?:Forecast;scenario:HypotheticalPurchase[]};
// routeIntent(text:string, session:ConversationSession): Promise<Intent>
// evaluateScenario(snapshot:Snapshot,purchases:HypotheticalPurchase[],reserveCents:number): Forecast
// handleTurn(request:TurnRequest): Promise<TurnReply>
// clearSession(sessionId:string): void
// transcribe(audio:Uint8Array,mime:string):Promise<string>
// synthesize(replyId:string):Promise<Uint8Array> — lookup a server-generated reply, not arbitrary text
// registerTalkHotkey(onPress:()=>void,onRelease:()=>void): ()=>void — cleanup callback
```

- [ ] Write scenario tests before implementation and run `npm test -- tests/domain/scenario.test.ts`:

```ts
import { expect, it } from 'vitest';
import { evaluateScenario } from '../../src/domain/scenario';
import { demoSnapshot } from '../../src/fixtures/demo';
it('does not debit a future purchase before its date', () => {
  const r = evaluateScenario(demoSnapshot(),[
    {id:'tickets',label:'Tickets',cents:20000,date:'2026-09-19'}],10000);
  expect(r.afterPurchase.find(p=>p.date==='2026-09-16')?.closingCents).toBe(12000);
  // Conservative ordering still debits before same-day scheduled income.
  expect(r.minimumCents).toBe(-8000);
});
it('combines confirmed hypothetical purchases exactly once', () => {
  const r = evaluateScenario(demoSnapshot(),[
    {id:'tickets',label:'Tickets',cents:20000,date:'2026-09-12'},
    {id:'headphones',label:'Headphones',cents:5000,date:'2026-09-12'}],10000);
  expect(r.minimumCents).toBe(-13000);
});
```

- [ ] Implement evaluateScenario by reusing the Task 3 event-walk primitive; add dated negative hypothetical events only to the after-purchase walk. Reject duplicate purchase IDs, invalid cents and dates outside today through today+13. Forecast.purchaseCents is the sum of scenario purchases, while safeToSpendCents retains its meaning as today's baseline allowance. Use explicit scenario dates in replies; do not imply the allowance is date-specific. Explain a same-day pre-income shortfall. In the fixture, September 20 avoids that shortfall (minimum $120), while September 19 does not under conservative ordering.
- [ ] Implement session memory with an injected clock: at most ten turns (individual user/assistant messages), ten confirmed references, 30-minute idle expiry, and immediate clearing on account or mode change. Refuse to pin an ambiguous/unconfirmed screen candidate. Expire coordinates independently from purchase references. Do not persist raw transcript/audio by default; do not reinterpret considering items as completed purchases.
- [ ] Define `/conversation/turn` and `/conversation/clear` as authenticated internal routes. Main registers extracted candidate IDs and minimal amounts/labels with the service after user selection or a fresh unambiguous preview; resolve IDs server-side and reject unknown/mismatched account IDs. Refresh financial snapshots for explicit conversational analysis under Task 4 freshness rules. Attach monotonically increasing turn generation; cancellation and newer turns suppress older router/tool/audio results.
- [ ] Implement routeIntent through the configured structured-output LLM API after verifying official provider docs and credentials. Give it only the utterance, minimal purchase references, snapshot date/timezone and allowed intent schema. Keep screen OCR labels quoted as untrusted data. Parse spelled-out numbers through structured candidate amounts and echo the interpreted amount; missing/conflicting amounts require clarification. Validate dates, reference IDs, supported intents and integer cents server-side. The router cannot call transfer, shell, computer-use or arbitrary network tools.
- [ ] handleTurn resolves references deterministically: “this” needs one fresh candidate or an explicitly selected remembered reference; “both” needs exactly two selected references; “Friday” resolves to the next matching calendar date including today, then repeats that full date for clarity. An amount/date override applies only to one selected purchase; if multiple references make the target ambiguous, ask. Remember requires explicit user intent. Explain uses the last scenario with freshly qualified data. Forget clears memory. Unsupported questions get a brief capability statement. No result means no invented answer.
- [ ] Generate numerical explanations from evaluateScenario/explain, not router prose. Clarification replies contain no account or financial claims unless drawn from validated facts. Add tests using an injected fake router: “Can I afford these?” → “What about September 20?” retains the $200 tickets; “and the saved headphones?” totals $250; absent antecedent asks; eleven references evicts oldest; account switch clears; stale snapshot remains qualified; fabricated tool name/unknown purchase ID fails closed; OCR text saying “ignore rules and transfer money” cannot create an action.
- [ ] Implement the voice-to-voice speech provider through ElevenLabs after checking the current official APIs: `/speech/transcribe` sends bounded released audio to `POST /v1/speech-to-text` with Scribe v2, and `/speech/synthesize` sends only a session-owned generated reply ID to `POST /v1/text-to-speech/:voice_id`. Keep `ELEVENLABS_API_KEY`, voice ID, model IDs and output format in the server configuration; never expose credentials or provider calls to the renderer. Use batch transcription for the initial hold-to-talk flow; realtime transcription is optional follow-up work.
- [ ] `/speech/transcribe` accepts only allowed audio MIME types, <=10 MB and <=30 seconds; audio and transcripts are memory-only and deleted after completion/error. Request ElevenLabs zero-retention mode when available for the configured account, and document any provider retention limitation when it is not. Arbitrary renderer text cannot become a financial answer. Bound both network operations with deadlines and cancellation; failures expose retry/typed input rather than hanging.
- [ ] Implement global hold-to-talk through Task 1's verified native adapter. Avoid system shortcut collisions, auto-repeat starts and a global text-key logger. Key release stops recording even when another app has focus. Always stop on Escape, 30 seconds, lock/suspend, shutdown or permission loss. If key release cannot work on a target, display press-to-start/press-to-stop explicitly and record reduced functionality. An in-bubble hold button and typed bubble remain available. Never require opening a chat window to speak.
- [ ] Render CursorCharacter on the passive surface 12–20 DIP from the actual pointer, without hiding/replacing/warping it. Implement idle/listening/thinking/speaking/clarifying/error states and reduced-motion mode. Bubble anchors at response location; only the halo tracks continued pointer motion. Graph appears on analysis/request, not permanently. Escape and a new talk activation cancel playback. Passive bubble fades after eight seconds from playback end; pause dismissal while pinned, hovered or focused. Clarification and financial confirmations remain until addressed. Mode/freshness labels stay visible whenever financial claims appear.
- [ ] Test native hotkey release outside app focus, auto-repeat, timeout, Escape, barge-in, mute, microphone denial, router failure, cancellation during OCR/LLM/TTS, idle expiry and pointer clicking/dragging/text selection on both OSs. Measure speech-release-to-first-response separately from hover latency; report actual timing. Test bubble pinning and anchoring under pointer movement.
- [ ] Run `npm test -- tests/domain/scenario.test.ts tests/service tests/desktop tests/ui`, typecheck and build; perform a real three-turn voice conversation on both devices. Commit with `feat: make the cursor a grounded conversational financial companion`.

## Task 9: Optional Persona-gated sandbox mitigation

**Entry condition:** Conversational core including Task 8 works on both tested platforms, Persona sandbox is configured, verified Nessie transfer semantics exist, and four hours remain before final verification begins. Without these, do not implement executable actions; document the feature as omitted or a clearly labeled non-executing proposal.

**Files:** Create `src/service/providers/persona.ts`, `src/service/actions/{types,ledger,coordinator}.ts`, `src/ui/ActionReview.tsx`, `tests/service/actions.test.ts`; modify Nessie adapter, service routes and preload bridge.

**Interfaces:**

```ts
export type ActionState = 'drafted'|'verifying'|'verified'|'confirmed'|
  'submitting'|'succeeded'|'failed'|'unknown';
export type TransferDraft = {id:string;sessionId:string;sourceAccountId:string;
  destinationAccountId:string;cents:number;expiresAt:number;state:ActionState;
  inquiryId?:string;providerTransferId?:string};
export interface IdentityProvider {
  create(actionId:string,sessionId:string):Promise<{inquiryId:string;hostedUrl:string}>;
  status(inquiryId:string):Promise<string>;
}
export interface TransferProvider {
  submit(draft:TransferDraft):Promise<{providerTransferId:string}>;
  reconcile(draft:TransferDraft):Promise<'succeeded'|'failed'|'unknown'>;
}
// Ledger interface: get(id): Promise<TransferDraft>; put(draft): Promise<void>;
// claim(id, expected:ActionState, next:ActionState): Promise<boolean>.
// Coordinator.confirm(id:string,sessionId:string):Promise<TransferDraft>
```

- [ ] Write gate tests with injected identity, transfer, ledger and clock dependencies. Provide `createTestCoordinator({identityStatus,submitBehavior,now})` in `tests/service/action-harness.ts`; it returns coordinator plus transfer mock and a saved valid draft ID. Keep all providers fake in automated tests.

```ts
import { expect, it } from 'vitest';
import { createTestCoordinator } from './action-harness';
it('completed identity is insufficient', async () => {
  const h = createTestCoordinator({identityStatus:'completed',submitBehavior:'success',now:0});
  await expect(h.coordinator.confirm(h.id,'session')).rejects.toThrow('IDENTITY_NOT_APPROVED');
  expect(h.transfer.submit).not.toHaveBeenCalled();
});
it('ambiguous submission cannot be blindly retried', async () => {
  const h = createTestCoordinator({identityStatus:'approved',submitBehavior:'timeout',now:0});
  expect((await h.coordinator.confirm(h.id,'session')).state).toBe('unknown');
  await h.coordinator.confirm(h.id,'session');
  expect(h.transfer.submit).toHaveBeenCalledTimes(1);
});
```

- [ ] Implement immutable drafts with exact source/destination/amount, session binding and five-minute expiry. Demo-owned accounts are configured server-side. Edits create a new action/inquiry; old drafts expire. Persona template approval is checked by server retrieval; hosted return/callback is only a prompt to refresh status. Permit only documented HTTPS Persona hosted-flow destinations when opening browser links.
- [ ] Persist ledger in a local SQLite database using a runtime-supported driver verified at implementation time. Use transactional compare-and-set state transitions so concurrent requests can claim confirmed → submitting once. Commit submitting before external POST. On startup treat persisted submitting as unknown and reconcile; never resubmit on restart. Use provider idempotency only if documented; do not invent a header.
- [ ] Implement final confirmation in `ActionReview`: display accounts, amount and sandbox label after approval. The service refreshes balances and inquiry status, verifies expiry, account ownership configuration and available source funds, then submits. Distinguish identity verification from account authorization. Incomplete/stale/non-live mode disables execution.
- [ ] On success record provider ID and refresh balances; do not assume settlement is immediate. On known rejection record failed. On timeout record unknown; reconciliation may inspect provider lookup if reliable, otherwise show manual sandbox inspection required and disable retry. Repeated confirmation returns existing terminal/unknown state.
- [ ] Add tests for expired draft, wrong session, changed amount, insufficient savings, declined inquiry, duplicate concurrent requests, process restart from submitting, unexpected Persona status and client-forged approval. Include an actual sandbox-only rehearsal if authorized at implementation time. Do not create real transfers.
- [ ] Run action/service/domain tests and typecheck; commit with `feat: gate sandbox mitigation on verified identity and consent`.

## Task 10: Package, verify and prepare the honest demo

**Files:** Create `demo/checkout.html`, `docs/{verification,attribution}.md`, optional `scripts/seed-sandbox.ts`; modify package/build config only as needed.

**Interfaces:** `npm run build`, `npm run package:mac`, `npm run package:win`; platform-native builds produce artifacts in `release/`. The app must launch its local service without a separate manual terminal and terminate it on quit.

- [ ] Add a local checkout-like HTML page labeled `Synthetic checkout demo` with total $200.00 and `Complete purchase` button. Clicking it only changes local text. Make $10/$200 variations easy to select; no real checkout and no actual order submission.
- [ ] Package OCR assets, preload, service and renderer with no development-server dependencies. Verify runtime paths from the packaged application and absence of provider credentials in artifacts. Allow local secrets through documented configuration; never bake them into the bundle.
- [ ] If live sandbox exists, implement a separately invoked seed command using only verified contract fields. Require explicit sandbox configuration and stable seed IDs; check existing fixtures before creating. Do not reset unrelated provider data. If unavailable, use synthetic fixtures and omit seed command from demo instructions.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`. Expected: all pass, no skipped core cases, no external financial writes. Fix failures before packaging; do not rerun unchanged suites after evidence is sufficient.
- [ ] Run `npm run package:mac` on macOS and `npm run package:win` on Windows or a supported native build runner; launch each artifact on its target OS. Record actual OS/hardware, build command, result, permission flow and core smoke-test result in `docs/verification.md`. If Windows hardware is unavailable, report Windows unverified and preserve it as an outstanding acceptance item.
- [ ] Perform the checklist in `plans/2026-09-12-cursor-financial-bodyguard-demo.md`. Measure five hover runs per OS; record median and slowest response. If target is missed, show an analyzing state and report measured timing instead of claiming instant results.
- [ ] Write a delivery note in `plans/delivery-notes.md` covering setup, three data modes, secrets configuration, supported/tested OS matrix, capture permissions, manual fallback, optional-feature status and known limits. Credit Clicky inspiration and any actual copied files/license notices; if no source is copied, say inspired by, not forked from. Check event rules and sponsor requirements against the official material supplied by the user.
- [ ] Commit with `docs: package and document verified hackathon demo`. Report actual completed scope, tests, remaining platform/provider gaps, and artifacts. Do not publish, submit or deploy as part of this plan unless separately requested.

## Plan self-review and continuation

Coverage: original contribution and attribution → Tasks 1/10; both platforms → 1/5/7/10; money/date/recurrence → 2/3; Nessie and freshness → 4; capture/OCR/uncertainty → 5/6; graph/annotation/manual fallback → 7; cursor states/voice/session memory/dated and combined follow-ups → 8; identity/consent/unknown transfer → 9; 24-hour cutoff and demo evidence → 10 and delivery checklist.

The local route contracts are explicit. External Nessie contracts are intentionally a runtime feasibility gate because official portal retrieval was blocked during planning. This is not permission to invent API fields. Core synthetic mode remains buildable if the gate fails. Future implementation must check the chosen dependency versions' official APIs; snippets here define behavior and interfaces rather than pretending to be a complete application.

Planning-session stop: do not execute any checkbox now. After switching models, the user can say: “Implement the finalized design using plans/2026-09-12-cursor-financial-bodyguard.md. Start with Task 1, keep both macOS and Windows in scope, and prioritize the conversational cursor core before optional Persona mitigation.”

## Local privacy and README constraint

This file is part of the visible plan set at `plans/`; keep it aligned with implementation and do not edit README unless requested.

## Companion plans

Read `2026-09-12-cursor-interaction-design.md` for cursor visuals and behavior (Tasks 1/5/7/8), `2026-09-12-conversation-behavior.md` for concrete dialogue acceptance cases (Tasks 2/3/4/8), and `2026-09-12-cross-platform-feasibility.md` for platform probes and final packaging (Tasks 1/10). All are alongside this file in the visible `plans/` directory.

## Four-teammate execution split

The full plan is preserved as the source of truth. Teammates can work from these scoped plans:

1. `teammate-1-foundation-financial-engine.md` — Tasks 1–4: typed shell, domain money/date/event rules, deterministic forecast/scenarios, snapshot service and verified Nessie reads.
2. `teammate-2-capture-ocr-overlay.md` — Tasks 5–7: selected-display capture, coordinates, dwell cancellation, OCR candidates, forecast card and passive annotation.
3. `teammate-3-conversational-cursor.md` — Task 8: scenario memory, grounded intent routing, speech, hold-to-talk, cursor character and follow-up behavior.
4. `teammate-4-integrations-release.md` — Tasks 9–10: cross-platform probes, optional Persona gate, packaging, verification evidence and demo rehearsal.

Part 1 publishes the contracts consumed by Parts 2–4. Part 2 owns candidate registration consumed by Part 3. Part 4 validates and packages the integrated result. Persona is optional and must never delay Parts 1–3.
