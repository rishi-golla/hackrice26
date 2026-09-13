# Credit simulation

Mode: Operate. Extend the incumbent macOS charcoal panel, native system typography, SF Symbols, mint action color, and shared DS tokens. No redesign or raster assets. The floating, keyboard-capable panel is 780 × 820 points, bounded by the screen, with a fixed title/navigation and scrolling body. Compact verification uses 640 × 650 points. Preserve the menu bar companion and existing account/voice/shopping flows.

The requested workflow is self-reported credit score → local simulated soft pull → comparative personal-loan costs → scenario selection and history. Nessie is the requested API. Its existing validated account snapshot supplies dated historical context; it is not a bureau or underwriting provider. No SSN is collected or generated; UUID-based SIM references identify runs.

## Native design system

Implemented in `leanring-buddy/CreditSimulationPanel.swift`, with shared colors from `DesignSystem.swift`. All dimensions and type sizes below are macOS points.

- **Typography:** system font throughout; panel title 23 semibold, section titles 19 semibold, lender labels 15 semibold, primary action and context heading 14 semibold, input values 16 regular. Body copy uses 13 regular; supporting copy and field labels use 12 (labels medium); metric labels and sort badges use 11. Comparison and sandbox metrics use 19 medium with monospaced digits. SF Symbols supply the credit-card, lender, warning, close, and navigation icons.
- **Color and shape:** forced dark appearance, `DS.Colors.background` (`#101211`), primary text (`#ECEEED`), secondary text (`#ADB5B2`), and a 1-point subtle border (`#373B39`). The panel has a 20-point corner radius and native window shadow. The local mint accent uses RGB `(0.35, 0.94, 0.64)` for the primary action, credit-card icon, lowest-cost/payment label, and source links. Primary-action text uses the background color; validation and persistence messages use system orange.
- **Spacing and layout:** title and scrolling body have 24-point padding; navigation has 24 horizontal and 12 vertical padding. Body sections are separated by 22 points; forms, results, and history use 18-point internal spacing. Paired fields use equal flexible widths, a 16-point column gap, and 8 points between label and input. Scenario rows use 12-point spacing and native dividers; three equal-width metrics have 24-point gaps. The full-width primary action has 14-point padding and a 10-point radius; the close control has a 30 × 30 content frame.
- **Panel and scrolling:** the centered floating panel is capped at 780 × 820, or the screen’s visible width minus 32 and height minus 40, whichever is smaller. It can become key, moves by its background, remains visible on app deactivation, and joins all Spaces, including full-screen auxiliary use. Title and navigation stay outside the vertical `ScrollView`; forms, comparisons, context, and history scroll within it. Compact fixtures retain the two-column fields and three-column metrics at 640 × 650.
- **Controls and states:** rounded-border native text fields retain native focus behavior and submit on Return; checkbox toggles, a segmented sort picker, secondary buttons, and a disclosure group use native controls. Interactive controls use the pointer cursor helper; disabled controls retain their disabled state. Refresh changes to “Refreshing…” and disables during its task; refresh, API sources, and saving require an account. Selected scenarios change their button label and expose the selected accessibility trait. Close and Escape hide the panel. There are no custom animation or scroll-position overrides.

## Behavior

Open Options → Credit simulation, or ask for a credit simulation (the CREDIT action tag opens it). Score and dollar fields have accessible labels, validation messages, and Return submission. Score must be an integer 300–850; amount $1,000–$100,000; monthly gross income $1–$1,000,000; existing monthly debt $0–$1,000,000. Dollar parsing accepts plain decimal input with no grouping and at most two fractional digits.

Each scenario displays a lender/term, modeled APR, payment, total interest, total repayment, final payment, and entered debt plus proposed payment as a percentage of gross income. Users sort by modeled total cost or payment and select one scenario; selection never applies for a loan. The first row is marked as the cheapest under the selected sort, not recommended or approved.

Historical context shows actual Nessie sandbox balance and 30-day deposit/withdrawal totals, source-inspector navigation and refresh. Transactions exclude purchases/transfers and are never substituted for income. A snapshot older than five minutes is omitted from a new run. A run retains its own observation date when reviewed later.

History is per Nessie account, at most 30 runs; disk persistence is opt-in for each run. Local files use SHA-256 account filenames, owner-only directory/file permissions and atomic writes. Inputs are not injected into AI prompts or sent to lenders. Existing screenshot capture excludes this app's windows. Logout/account changes clear transient state. Clear history removes the current account's history, including unreadable files. Saving failures are visible; the saved indicator reflects successful persistence. Historical score changes describe user-entered scenarios, not changes to a bureau score.

## Catalog and assumptions

Source examples manually checked **2026-09-13**, versioned with each run. These are bundled reference examples, not a live lender feed. Recheck the linked pages before changing the version or rates. There are no lender API credentials, rate-check submissions, scraped offers, or simulated successful network calls.

- [SoFi rate examples](https://www.sofi.com/personal-loans/personal-loan-rates/): no-origination-fee $30,000 examples for 36/48/60 months with lower APRs 7.38%/8.23%/9.50%, upper APR 35.49%. The examples assume both 0.25% autopay and 0.25% member discounts. The simulator scales payment examples to the entered principal and explicitly does not validate amount/state eligibility.
- [Wells Fargo personal loans](https://www.wellsfargo.com/personal-loans/): the published 6.74%–26.74% range assumes $10,000+ and 36 months, a 0.25% relationship discount, and no origination fee. The scenario is included only for a self-reported 12-month customer relationship and at least $10,000. Other requirements remain unverified.

The model linearly interpolates from each example's maximum APR at score 300 to minimum at 850, rounded to 0.01 percentage point. It is an explicit teaching rule, not a fitted or lender-supplied model. The annuity payment is rounded to cents, interest accrues monthly and rounds to cents, and the final payment pays the remaining balance. No origination fee is modeled, matching the selected examples. Lender-specific daily accrual and billing rules may differ. Income/debt affect the displayed ratio, not the modeled rate or eligibility.

## Verification

Run `bash scripts/checks/run-credit-checks.sh` from `flicky-swift`. Append `--render /tmp/flicky-credit-review` for standard/compact native screenshot fixtures. The checks cover invalid money/scores, an independently published SoFi payment example, zero-rate rounding, repayment reconciliation, lender conditions, monotonic score scenarios, stale snapshot rejection, selection, opt-in persistence, file permissions, account isolation, history limits, and corrupt-file recovery.

Build the full app in Xcode (Command-B); never use terminal xcodebuild. Fixture renders do not establish a live Nessie refresh or a billable AI/voice turn. No production credentials are needed for the focused checks.
