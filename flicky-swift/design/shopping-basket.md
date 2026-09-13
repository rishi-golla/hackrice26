# PeppaPrice shopping

Mode: Operate. This surface covers `ShoppingBasketPanel.swift` and the checkout view in `ShoppingCheckout.swift`. The user asked for a clean, professional, simple interface matching the main PeppaPrice panel, and “Buy it” on the green action instead of “Review demo payment.”

## Visual direction

Reuse the main companion's charcoal glass, cool gray supporting text, white system typography and mint action. The basket and payment review share `ShoppingPanelStyle`, `ShoppingQuietButtonStyle`, `ShoppingPrimaryButtonStyle` and `ShoppingProductImage`, defined in the basket source. This is a scoped refinement; the main panel and other features retain their styling.

The native floating panel remains at most 720 × 690 points, clamped to the visible screen. A 19-point continuous outer corner and one-point 18%-white edge frame an ultra-thin material with the same diagonal charcoal gradient as the main panel: RGB (0.14, 0.15, 0.19) at 88% opacity to (0.065, 0.07, 0.085) at 94%. Both views use 24-point horizontal insets. Native hosting remains bounded using `sizingOptions = []`.

A 40-point PeppaPrice logo accompanies the 21-point semibold title and 12-point subtitle. Product names are 14-point medium and limited to two lines with full-title help. Supporting text is 12 points; tertiary links are 11 points. Financial values use monospaced digits; the fixed subtotal is 28-point semibold. Gray supporting text uses RGB (0.65, 0.67, 0.73), matching the reference panel.

Products are open rows with 14-point image/text gaps, 64 × 72-point image wells, and fine 8%-white separators. Product imagery comes from retailer/search metadata; loading/missing images use a bag symbol. No generated product imagery. Merchant groups are separated by 24 points. Quantity controls remain inline; alternatives remain in a menu. The basket list and checkout items scroll while the total and primary button remain fixed.

The primary action is 46 points tall with 12-point corners and dark text over mint. Quiet close/add/back/remove controls use subtle tonal fill and borders. Hover and pressed feedback are explicit; pointer cursors remain on controls. Basket changes retain the existing reduced-motion-aware animation. Checkout's redundant flying icons were removed; item states and the busy spinner communicate progress.

## Interaction and copy

- Basket header shows item/store counts and persistence state. The product-link field is compact with a labeled add control.
- Product name, price, quantity, availability problems and checkout verification state stay visible. Supporting query, provenance time, retailer limitations and delivery metadata are under Details. Product links and alternatives remain accessible.
- The basket action says **Buy it**. Product verification happens before insertion; stale prices refresh automatically on reopening or continuing to review. Preparation shows **Preparing…** and prevents duplicate interaction. There is no manual Check products action.
- Only relevant retailer products with a direct link, photo, positive verified USD price and explicit in-stock status appear. Missing matches produce a message, never a category placeholder. Alternatives obey the same rule. Legacy unverified saved rows are removed on load; failed rechecks remove affected products.
- Buy it opens the existing account/payment review. The review button says **Buy it · $amount**, or **Check status** for reconciliation, **Working…** while busy, and **Done** once the existing completion conditions pass. Back remains available only where the existing coordinator allows cancellation.
- One short note beneath the primary action identifies sandbox checkout and simulated retailer orders. Shipping/tax exclusions stay next to the total. Removing “demo” from action labels does not imply real retailer purchasing.
- The review leads with a compact Capital One Nessie account tile, item rows, then total/action. API IDs and transaction metadata are under Payment details after submission. Failed product-link tasks expose an explicit Open product recovery link.
- The existing coordinator still records one sandbox debit, opens product links, and simulates cart/order steps. Completion labels explicitly say Order simulated. No retailer order is placed, and no payment credentials are collected.

## Preserved behavior

The persistent basket, USD parsing, quantity bounds, product verification, selection rules, price freshness, account verification, draft lock, duplicate-payment suppression, pending-payment reconciliation, receipt archival and paid-line clearing are unchanged. The UI uses the existing coordinator, ledger and checkout state. No live payment was submitted while validating this visual update.

## Verification

Swift type checking, the existing `ShoppingCheckoutCheck.swift` suite, and an Xcode application build validate the updated views and checkout integration. Native fixtures inspect basket, payment review and completion at 720 × 690, plus compact basket/review at 560 × 650. The fixture bank intercepts every request; product images use placeholders. These captures establish layout and test-state behavior, not real retailer orders. Build using Xcode, never terminal xcodebuild.
