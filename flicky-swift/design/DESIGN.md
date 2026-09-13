---
name: Flicky menu bar panel and Insights
description: Native charcoal glass financial companion surfaces
colors:
  text-primary: "#ffffff"
  text-secondary: "rgb(65% 67% 73%)"
  mint: "rgb(35% 94% 64%)"
  glass-top: "rgb(14% 15% 19% / 88%)"
  glass-bottom: "rgb(6.5% 7% 8.5% / 94%)"
  tile-fill: "rgb(100% 100% 100% / 2.5%)"
  composer-fill: "rgb(100% 100% 100% / 5.5%)"
typography:
  balance:
    fontFamily: "system-ui"
    fontSize: "44pt"
    fontWeight: 600
    letterSpacing: "-1.2pt"
  title:
    fontFamily: "system-ui"
    fontSize: "21pt"
    fontWeight: 600
  question:
    fontFamily: "system-ui"
    fontSize: "15pt"
    fontWeight: 400
rounded:
  panel: "19pt"
  tile: "17pt"
  glass-button: "16pt"
spacing:
  panel-inset: "18pt"
  paired-controls: "12pt"
  financial-sections: "22pt"
---

# Design System: Flicky menu bar panel and Insights

## Overview

This document covers `CompanionPanelView.swift`, its `MenuBarPanelManager.swift` host, and the companion dashboard in `FinancialInsightsDashboardManager.swift`. The established direction is charcoal glass, fine illuminated edges, white system typography, and restrained mint accents, following [the panel contract](menu-bar-panel.md). Frontmatter tokens describe the menu bar panel; dashboard differences are specified below.

The connected state leads from account identity to balance, safe-to-spend information, bills, and a question composer. The design was inspected in a standalone native preview with a stub manager; its screenshot is a fixture, not evidence of a running app or successful live account/voice integration.

## Colors

An ultra-thin macOS material sits beneath the diagonal charcoal gradient defined above. White is reserved for primary values and labels; muted cool gray supports the hierarchy. Mint marks the ready status and account connection. Safe-to-spend uses the existing `DS.Colors.success` at $200 or above, `DS.Colors.warning` below $200, and red below $50; it is not always mint. Setup/sign-in status uses warning, while listening/thinking/responding uses `DS.Colors.blue400`.

Account and merchant marks retain their own color accents. Permissions, login errors, and Stop Flicky retain existing shared semantic colors rather than defining a new palette for the rest of the app.

Insights uses the same ultra-thin material with gradient endpoints `(0.14, 0.15, 0.19)` at 90% opacity and `(0.06, 0.07, 0.08)` at 96%. Cards have 3.2%-white fill. Semantic chart and health colors remain data-dependent; spending categories use a varied categorical palette rather than mint alone.

## Typography

Use native SwiftUI system fonts and SF Symbols. The balance is 44-point semibold with monospaced digits, −1.2-point tracking, and single-line scaling down to 60%. Flicky is 21-point semibold; the subtitle, status, and balance label are 14 points. Safe-to-spend is 20-point semibold with a 13-point label. The composer is 15 points; account details, bill chips, suggestions, model choices, and footer are predominantly 12 points. The email scales to 80% and truncates in the middle, with the full value available as help text.

## Layout

The panel is 480 points wide with 18-point outer padding. The header remains above a scrollable body capped at 410 points, followed by a divider and fixed footer. Header-to-body and body-to-divider spacing is 22 points; divider-to-footer spacing is 16 points. Body sections use 20-point gaps; the financial stack uses 22 points.

Account tiles and suggestion buttons are paired with 12-point gaps. The bank tile has a 168-point content width plus 12-point padding on each side; the email tile takes remaining width. Bill chips are 38 points high with 10-point gaps. The composer is 60 points high with 16-point horizontal padding; suggestions are 46 points high and sit 18 points below it.

The host starts with a 556-point fallback height and uses the hosting view's fitting height when shown. It centers beneath the status item with a 4-point vertical gap and clamps horizontal placement to an 8-point screen inset. This is a fixed-width native panel, with scrolling for extra body content, not a responsive web layout.

Insights is a separate 520 × 760-point panel, centered on the main screen when opened. A fixed header and four-tab selector sit above vertically scrolling content with 18-point padding and section gaps. Its header uses a 21-point semibold title, 13-point subtitle, and 20-point horizontal/18-point vertical padding. Standard cards have 14-point padding; section labels are 10-point semibold with 1.1-point tracking.

## Elevation & Depth

The transparent, borderless floating NSPanel has the native window shadow. Its glass surface uses a one-point white gradient edge at 35%, 9%, and 22% opacity. Tiles use subtle tonal fills and edges rather than separate shadows. The 14-point status dot adds a nine-point glow at 45% opacity. The composer has a brighter 24%-white edge; ordinary tiles use 9%.

Insights retains the native shadow, with a one-point white outer edge at 34%/10%/24% and card edges at 18%/7%/14%. Its header dot is 11 points with a seven-point glow. The custom options menu casts a black 45%-opacity shadow with an 18-point radius and ten-point downward offset.

## Shapes

Use continuous 19-point panel corners, 17-point tile/composer corners, and 16-point bill/suggestion corners. The options control and send control are 34-point circles. Model selection uses a 12-point outer container and 10-point selected segment. Existing login fields use six-point corners; login and stop actions use eight-point corners; permission Grant actions are capsules.

Insights uses 20-point outer corners and 17-point cards. Its tab container has 15-point corners and selected segments have 12-point corners. The options menu has 16-point corners and 10-point row backgrounds.

## Components

- **Header:** Status text reports Setup, Sign in, Ready, Listening, Thinking, or Responding. The ellipsis menu exposes refresh, full insights, dismiss, and quit; refresh requires login and insights requires available data.
- **Custom options menu:** A 220-point-wide overlay opens 44 points below the ellipsis, using eight-point padding, four-point row gaps, 34-point rows, 13-point medium labels, and 14-point icons. Its near-black fill is `(0.055, 0.06, 0.07)` at 98%, with a 20%-white edge. The trigger brightens while open; opening uses a 0.16-second ease-out opacity/scale transition. Actions close the menu before executing. Disabled rows dim and omit the pointer cursor. This is a custom overlay, not a native menu; keyboard/VoiceOver behavior requires separate validation.
- **Accounts and balance:** The bank tile reflects Nessie login state; the email is a display label, not Google authentication. The bank tile's tooltip shows the masked card number. Balance appears only when insights exist, with separate refreshing and error feedback.
- **Bills:** Show up to three recurring bills, falling back to upcoming bills, plus a count for additional items. All chips open full insights. Labels and counts are data-dependent; the fixture's merchants and amounts are not fixed content. Hide the row when there are no bills.
- **Glass buttons:** Bill chips and suggestions use 2.5%-white resting fill, 7.5% on hover, and 12% while pressed. The one-point edge changes from 8.5% to 20% on hover. Interactive controls use the pointer cursor.
- **Questions:** Return and the arrow submit trimmed text through the manager, then clear the field. Empty or whitespace-only input disables submission. Suggestions submit their displayed question immediately. Stop Flicky appears in the connected body when voice state is not idle.
- **Footer:** Keep the Control–Option voice hint, Sonnet/Opus choice with selected-state accessibility, and conditional sign-out action. The selected model has an 8%-white fill inside a 4.5%-white segmented container.
- **Setup and login:** Missing permissions take precedence over login. Setup lists microphone, accessibility, and screen recording, adding screen content after screen recording is granted. Login accepts a Nessie customer ID and display email, supports blank-ID demo mode, and exposes connecting/error states.
- **Panel lifecycle:** The status item toggles visibility. The non-activating panel can become key for text entry and joins all Spaces, including full-screen auxiliary presentation. Outside clicks dismiss after a short delay, except during inactive-app permission onboarding; the dismiss notification also closes it.
- **Insights navigation:** Overview contains balance, financial health, runway/cash flow, safe-to-spend gauge, allocation, and recent activity. Spending contains category totals and bars. Bills contains upcoming bills, recurring commitments, and conditional rewards. Scenarios hosts the existing Nessie simulation view. Selected tabs use a 10%-white fill and white text; selection animates with a 0.3-second spring.
- **Insights states:** Missing account data shows an empty state. When a local simulation cohort exists without account insights, Scenarios remains usable and other tabs explain the account requirement. Explicit simulation requests select Scenarios. Spending and bills have distinct empty messages; runway/cash-flow and rewards cards appear conditionally. Rewards value is explicitly an estimate.
- **Insights lifecycle and verification:** The separate floating non-activating panel joins all Spaces, fades in over 0.2 seconds and out over 0.15 seconds, and closes through its x control or manager toggle. These notes describe source behavior; the documented standalone panel fixture does not establish live dashboard, menu, or service interaction verification.

## Do's and Don'ts

- **Do** preserve the central balance hierarchy, charcoal material, fine edges, and compact native controls within this panel.
- **Do** retain real loading, error, permission, voice, and account variations when extending the surface.
- **Don't** replace data-driven bills or account labels with screenshot fixture values or imply unsupported authentication providers.
- **Don't** treat these scoped panel and dashboard notes as a redesign mandate for other app surfaces.
- **Don't** claim the standalone preview validates live services. Follow `AGENTS.md`: do not run terminal `xcodebuild` for verification.
