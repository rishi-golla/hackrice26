# Plaid bank connection

The compact main panel offers “Connect bank with Plaid”. This development-only integration uses Plaid Hosted Link and Auth in Sandbox; it does not certify, replace, or modify the selected Nessie account or its balance. A connection is displayed only after an Auth response includes ACH details for the returned account. Pending verification remains pending. Only account names and masks reach the UI; account/routing numbers, tokens and credentials never enter prompts or logs.

Configure the local, unbundled `~/Library/Application Support/Flicky/plaid.plist` with string keys `PLAID_CLIENT_ID` and `PLAID_SANDBOX_SECRET`. Protect the file with mode 600. Never commit this file or put the secret in Info.plist. No credentials are currently supplied by the repository. Requests are pinned to `https://sandbox.plaid.com`; Production is unsupported. A distributed integration must move credential-bearing requests to an authenticated backend.

Flow: `/link/token/create` with `products: [auth]` and `hosted_link: {}` → open the returned HTTPS Plaid URL → poll `/link/token/get` for at most 15 minutes → `/item/public_token/exchange` → `/auth/get`. Tokens remain in memory. Closing the panel, cancelling, or changing customer clears the in-memory flow and results; it does not unlink the Item at Plaid. Repeat connections create new Sandbox Items. No production account verification or identity verification is claimed.

References: https://plaid.com/docs/link/hosted-link/ and https://plaid.com/docs/api/link/ and https://plaid.com/docs/api/products/auth/ (reviewed 2026-09-13).

Checks: compile `PlaidBankConnection.swift` with `scripts/checks/PlaidBankConnectionCheck.swift`. Fixtures cover URL boundaries, sandbox token restrictions, masked Auth results, pending verification, and reset. Actual Hosted Link completion still requires configured sandbox credentials and user interaction.
