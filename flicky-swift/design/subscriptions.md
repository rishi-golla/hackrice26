# Subscription review and cancellation

## Overview

Mode: Operate. This is a local extension of PeppaPrice's existing native charcoal, mint, and system-type interface. The subscription list and provider browser share one window so the user can review a renewal, authorize cancellation for the correct account, and see its progress. This document describes this feature; it does not establish a new global design identity.

`Subscriptions.swift` owns records and persistence, `SubscriptionPanel.swift` owns the native review surface, and `SubscriptionCancellation.swift` owns the WebKit cancellation runner. Voice/text requests use `SUBSCRIPTIONS` to open review; a model response tag cannot authorize cancellation.

## Colors

The panel uses the incumbent charcoal background (`Color(red: 0.07, green: 0.085, blue: 0.09)`) and mint accent (`Color(red: 0.35, green: 0.94, blue: 0.64)`). Mint marks upcoming renewals, saved cancellations, the empty-state symbol, and the prominent confirmation button. The button uses black text. Secondary system text carries provenance and explanatory copy; orange identifies validation and storage errors. Provider pages retain their own styling.

## Typography

Use native system typography. The panel title is semibold `title2`; service names, per-charge amounts, and tracked counts use `headline`. The browser title uses semibold `title3`, status and decisions use `callout`, and dates, provenance, receipts, and supporting copy use `caption`. Amounts and counts use monospaced digits. Status and form explanations wrap; receipt text and the displayed provider address are selectable.

## Layout

The resizable window starts at 1120 × 760 points with a minimum of 850 × 600. Opening constrains it to the visible screen with a 20-point inset when needed. The left column has 24-point padding and a width range of 340–440 points, with 400 preferred. A divider separates it from the expanding provider browser. There is no stacked compact layout.

The left column keeps its heading, tracked counts, optional add/edit form, and date caveat outside a scrolling list. Rows show service and amount together, followed by source/date, upcoming status, decisions, notes, and an optional receipt disclosure. Dividers have 16-point vertical padding. The right column keeps provider identity and status above WebKit and the account confirmation and actions below it; both regions use 20-point padding. The initial browser placeholder is constrained to 380 points with 32-point padding.

## Elevation & Depth

This surface uses a flat charcoal background, native window chrome, and dividers rather than decorative cards or custom shadows. Depth comes from the embedded provider page and native controls.

## Shapes

Inputs use native rounded-border text fields. Other controls retain native button and toggle shapes; the feature adds no custom radius system.

## Components

### Tracked list and upcoming renewals

Real subscriptions are user-added. Nessie supplies recurring sandbox bill candidates, which must be classified with **Yes, track it** or **Not a subscription**. Recurring rent is not silently counted as a subscription. Ignored candidates disappear from the list.

The headline separates active real and sandbox counts. The upcoming count combines both sources and includes recorded dates from today through 14 days ahead, inclusive. Unclassified, ignored, and cancelled entries are excluded. Counts are exact for this tracked list, not exhaustive discovery of the user's real subscriptions. Missing, past, and later dates are not marked upcoming. No interval or future charge is inferred; there is no scheduled monitoring or renewal-notification service.

**Keep** records a local decision to continue. It does not change the provider's account. A sandbox **Request cancellation** records a sandbox request only and never drives a real provider action. Cancelled records remain visible with a saved-receipt disclosure but leave the active count.

### Add and edit

The plus button opens a form for service name, positive USD amount per charge, renewal date (`YYYY-MM-DD`), and an HTTPS provider account URL. Inputs have accessibility labels and validation feedback. Editing updates the existing real record, including its recorded date. Active entries with the same service name and host are rejected as duplicates; distinct account names can distinguish multiple subscriptions to one provider. Saving is disabled while the cancellation runner is active.

### Provider review and confirmation

**Cancel…** opens the user-supplied provider page in an embedded, account-isolated WebKit profile. The user signs in as needed, checks the provider account and subscription, selects the confirmation toggle, and presses **Confirm cancellation**. The button remains disabled until the toggle is selected, during a run, and after cancellation has been saved. Explicit confirmation persists the cancellation intent before starting the runner.

The runner observes page text and controls and asks the existing Claude proxy for one structured action at a time. It can follow supported cancellation controls, including retention-offer declines, for up to 18 steps with a 180-second deadline checked between operations. A hanging planner call is not forcibly terminated by that deadline. Model output is never executable JavaScript: the app maps an observed ID to a local DOM control and rechecks its identity immediately before clicking.

Authentication, verification, ambiguous identity, fees/new terms, unsupported controls or forms, lack of progress, and navigation to another host pause the run. The user can complete the required step and confirm again from the saved provider host. This is bounded assistance, not guaranteed unattended cancellation across all providers. The browser is blocked from direct pointer interaction while the runner is active; **Stop** remains available. Closing the window lets an authorized run continue in the running app. App shutdown does not provide a background worker.

### Completion, interruption, and email fallback

Navigation alone is never cancellation evidence. The runner must observe an explicit provider confirmation that matches its supported cancellation/auto-renewal wording before saving a receipt containing the statement, provider host, and observation time. This English wording check can leave other valid confirmations unverified. The UI marks a subscription cancelled only after the receipt write succeeds. If confirmation is observed but storage fails, it tells the user to save the provider confirmation themselves.

**Stop** records that a submitted action may already have taken effect. Restarted working jobs require review instead of automatically replaying clicks. Account changes stop the run and discard the browser view; each account retains its own persistent WebKit profile and local records.

The runner can identify an actual provider `mailto:` link and prepare a cancellation request with an account-identifier placeholder. **Open email draft** hands it to the user's mail application. Outbound email is not connected, and sending a request is not proof of cancellation. The draft does not assert a legal entitlement.

### Data handling

Local JSON history lives in account-hashed files under Application Support/Flicky/subscriptions, with owner-only file permissions. The planner receives sanitized page text, control descriptions, and host-only destinations, not form values, full URL paths, cookies, or raw DOM identities. Sanitization masks recognizable email addresses, links, and long identifiers; it is not a guarantee that all personal information in visible page text is removed.

## Do's and Don'ts

- Do preserve the incumbent native palette, system typography, flat rows, and persistent progress area.
- Do keep real and sandbox provenance visible and describe dates as recorded rather than guaranteed charges.
- Do distinguish a local Keep/request decision, an active cancellation attempt, and a provider-confirmed cancellation.
- Don't imply exhaustive account discovery, automatic renewal monitoring, universal provider compatibility, or connected email sending.
- Don't mark navigation, pending requests, or unsaved receipts as completed cancellations.

## Validation

`bash scripts/checks/run-subscription-checks.sh` covers classification, date boundaries, persistence failure, editing, duplicates, account isolation, and a local HTML cancellation flow with an injected planner. SubscriptionCheck and SubscriptionBrowserCheck passed. The running native list and add form were inspected; truncated help text was then changed to wrap. The final Xcode build passed at 3:39 AM on September 13, 2026. No real subscription cancellation or live planner/provider flow was tested. Full application builds and runs use Xcode.

## Customer-scoped mock subscriptions

The customer selected for this demo is `7d0da646-431a-49f0-be82-a1bb10189f10`. Only this customer receives three explicitly `.demo` records: Spotify Premium ($12.99), Netflix ($17.99), and iCloud+ ($2.99). These are illustrative monthly prices, not retrieved provider prices or Nessie transactions. First creation sets renewal dates 3, 8, and 20 calendar days ahead and persists them within the existing account-scoped store. Reopening never advances dates, duplicates records or resets a decision. Other customers receive no mock data.

The list includes bundled official service icons, separate real/sandbox/demo counts, and exact relative renewal labels. The detail surface defaults to an unacknowledged mock renewal within three days and asks Keep or Cancel. Keep saves a local choice; Cancel in demo saves a clearly labeled demo receipt and never invokes the real browser runner. Open provider website is a plain external link, with no automatic provider mutation or transmission of account data. Real records retain their existing cancellation flow.

Voice and research context includes mock provenance, exact renewal dates, relative days, decisions and provider URLs. The voice instruction flags an unacknowledged imminent mock renewal when discussing subscriptions or bills, asks whether to keep/cancel, and offers website navigation. This is in-app/voice context, not an OS push-notification or background scheduling service.

Logo sources (retrieved September 13, 2026):
- Spotify: https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png
- Netflix: https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2016.png
- iCloud: https://www.icloud.com/system/icloud.com/2630Build56/favicons/default-favicon-light-180x180.png

These identify the respective providers, without implying affiliation. Files are bundled in SubscriptionSpotify, SubscriptionNetflix, and SubscriptionICloud image sets.

### Guided cancellation update
Cancel now opens the saved provider in the embedded browser immediately and starts navigation for one named service. CANCEL_SUBSCRIPTION tags route voice/research requests to this same flow. Only unambiguous account/settings/billing navigation labels can be clicked automatically. Cancellation, confirmation and ambiguous actions are scrolled into view and outlined in mint for the user to click. Continue resumes after sign-in or a manual step. Guidance never writes cancellation state or receipts, and cannot enter the legacy confirmed cancellation runner. Sample-record provenance remains in Data sources and model context; action labels are plain Keep and Cancel. This supersedes earlier Cancel in demo and UI confirmation-button descriptions. Local browser fixtures verify navigation, highlighting and no cancellation submission.

Subscription voice copy: routine listings/reminders/navigation omit internal demo/mock/sandbox labels and use service, listed renewal, and next action. Provenance stays in model context; answer source/authenticity questions honestly, never claim sample data came from Nessie or a provider, and disclose relevant limits for actual financial decisions.
