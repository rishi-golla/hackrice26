# Credit demo

## Borrowing-request shortcut

Voice or typed requests such as “I need $8,000 for 36 months,” “I need five thousand,” and “I need 5k for 3 years at 7.5%” open Meet your options directly. The compact four-bank carousel preserves its 448 × 486-point cards. Requested amounts and terms drive the metrics; missing amounts/terms use explicitly labeled $8,000 / 36-month examples. A supplied APR overrides the score model. Published ranges remain visible; their original reference amounts, terms and discounts appear in help text. The manual demo entry remains available.

Routing occurs before provider research; voice opens as soon as a transcript is available, and the research callback supplies the spoken introduction. Ordinary shopping/account questions and explicit issuer-site navigation retain their own behavior. Requested terms clear on account changes, logout, and Back. CreditSimulationCheck covers numeric/spoken values, years-to-months conversion, exclusions, context resets, and standard/compact rendering. Render fixtures register the official images from the asset folders and fail if any image cannot load. This shortcut supersedes the manual-only flow described below.

Mode: Operate. The existing charcoal, mint, native macOS system typography and PeppaPrice branding remain. The panel is 560 × 650 points, scaled down uniformly to fit smaller screens.

## Current flow

Options → Credit simulation and CREDIT open a two-step demo. The entry screen contains only an SSN field and Validate & continue. The field accepts dummy values starting with 000 (for example 000-12-3456), never authenticates a person, and performs only local format validation. Input lives in SwiftUI state and is cleared on continuation, Back, account change and disappearance. It is never sent to the model, lender, bureau or history store. No credit report, credit score, approval or encryption guarantee is implied.

The second step is a fixed card stack under “Meet your options”. The selected bank sits in front; the other cards are smaller, offset, blurred slightly and faded behind it. Previous/next buttons and arrow keys cycle through the banks with a spring transition. No part of either step scrolls. All loan details and the terms link fit inside one card. Official bundled logos, white primary text, mint positives and coral negatives give a concise overview. Benefits and tradeoffs have text labels and symbols as well as color. Reduce Motion disables carousel animation. The product logo/header, top demo badge, explanatory subtitle and bottom comparison banner are removed. Published-APR labels remain inside the cards, with source dates in the terms-link help text. Back returns to an empty entry; Escape and Close hide the window.

Four distinct cards show SoFi, Wells Fargo, American Express and U.S. Bank. Each includes an official logo, illustrative APR, monthly payment, total interest, one benefit, one limitation, and a terms link. The small Example score field defaults to 720, is editable across all cards, and resets on Back/account change. It is local example input, never a retrieved bureau score. Invalid scores outside 300–850 hide modeled metrics; an explicitly requested APR remains independent of score.

The teaching rule is `minAPR + (850 − score) / 550 × (maxAPR − minAPR)`, rounded to two decimals. It is not lender underwriting or an approval prediction. Monthly payments use the existing amortization engine with integer-cent rounding and an adjusted final payment; total interest is total payments minus principal. No fees are modeled. The published range is a reference, not assurance that a lender offers the requested amount/term. Actual lender eligibility, discounts, income and term restrictions still apply. Cards label the computed values as modeled/illustrative and not bank offers. Existing history is retained but these transient comparisons are not saved. No bank application or login occurs.

## Sources and bundled logos

Reviewed September 13, 2026:

- SoFi: https://www.sofi.com/personal-loans/personal-loan-rates/ — the $30,000 / 36-month no-origination-fee example has APR 7.38–35.49%, assuming autopay and member discounts. Actual underwriting applies.
- Wells Fargo: https://www.wellsfargo.com/personal-loans/ — $10,000+ / 36-month example range 6.74–26.74%, including relationship discount; customers must have 12+ months of history. No origination/closing fees or prepayment penalties; other charges may apply.
- American Express: https://www.americanexpress.com/en-us/banking/personal-loans/ — 6.99–19.99% APR (published April 15, 2026); eligible Card Members with an offer only; no origination fee or prepayment penalty.
- U.S. Bank: https://www.usbank.com/loans-credit-lines/personal-loans-and-lines-of-credit/personal-loan.html — 7.24–24.99% APR (August 31, 2026); non-clients up to $25,000 / 60 months. Lowest APR requires $10,000+, 12–36 months, score 800+, home improvement and qualifying autopay. No origination or prepayment fee.
- American Express icon: https://www.americanexpress.com/favicon.ico (converted to PNG).
- U.S. Bank logo: https://www.usbank.com/etc.clientlibs/ecm-global/clientlibs/clientlib-resources/resources/images/svg/logo-personal.svg
- SoFi logo: https://d32ijn7u0aqfv4.cloudfront.net/git/svgs/sofi-logo.svg
- Wells Fargo icon: https://www17.wellsfargomedia.com/assets/images/icons/icon-hires_192x192.png

Marks identify their respective banks; no affiliation is implied. Assets live in the four Credit*Logo.imageset folders. Links on each card open the official published terms without transmitting the dummy entry.

## Verification

Run `bash scripts/checks/run-credit-checks.sh` from flicky-swift. Existing engine/history checks remain and dummy-entry validation is checked. Optional `--render /tmp/credit-review` creates native entry and carousel fixtures; fixtures load the actual bundled logo files and cover all four cards at standard and compact sizes. Verify actual logos and navigation in the Xcode-built application. Full builds use Xcode, never terminal xcodebuild.

### Credit copy refinement
Routine UI and speech avoid demo/mock/sandbox/simulation narration. Credit cards say Estimated APR and Credit score, with a compact estimates-exclude-fees note and official terms links. Local starting values remain 720 / $8,000 / 36 months, not retrieved customer facts; score help explains the starting value. The manual screen is Access code (000 prefix), not an SSN or credit pull; validation checks format only. Keep accurate internal provenance and answer source questions honestly. This supersedes prior visible demo labels and dummy-SSN UI copy.
