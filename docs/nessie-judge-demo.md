# Demonstrating Flicky’s Nessie integration

## The claim to make

“Flicky reads a synthetic customer’s records from Capital One’s Nessie sandbox over HTTPS. We selected an existing customer from Nessie’s shared enterprise dataset; the running app fetches its records from the API and calculates contextual financial metrics from those responses.”

These are persisted sandbox records, not a real bank connection. A customer name alone does not prove integration. The app’s request log and SHA-256 hashes are useful debugging evidence, not independent attestation.

## Current API profile

- Customer: **Maya PartyFund**
- Customer ID: `053a3abf-34e5-4508-93d9-ba6f625fa8bf`
- Checking: **PartyFund everyday**, ID `38bb287b-4c19-40e8-b551-8a46cc3364a5`, balance **$1,280**
- Savings: **PartyFund trip goal**, ID `aff74238-85a5-48a2-9b0c-f9db90b5a176`, balance **$540**
- Checking bill records: phone **$35** and housing **$450**. Only the phone bill falls within the current 14-day window.

These records existed before Flicky selected them. The API does not identify their original creator; do not claim Capital One authored this specific synthetic profile. Read-only discovery returned 301 customers from `/enterprise/customers` and 747 accounts from `/enterprise/accounts` on September 13, 2026. The developer-scoped `/customers` and `/accounts` endpoints returned only the earlier Flicky Demo profile. That earlier profile remains in Nessie but is no longer selected.

Local `FLICKY_NESSIE_DATA_SCOPE=enterprise` enables enterprise customer, account, and merchant detail requests. Account relationships and transaction collections use the normal relationship routes. Values can change in Nessie; this document is not a runtime data source.

## A two-minute judge demo

1. Open Flicky. Show the customer name and account selector. Open **API connection details** and click **Refresh from Nessie**. Show the customer ID, account ID, request paths, HTTP statuses, and fetch times. Expand a response to see its returned JSON (credentials and full account numbers are redacted).
2. From the repository root, run the separate read-only verifier:

   ```sh
   python3 scripts/verify_nessie_connection.py > /tmp/flicky-nessie-proof.json
   ```

   Open that JSON beside Flicky. Compare the customer ID, account IDs, balance, and bill records. The script calls Nessie directly using curl; it does not read Flicky’s financial state or seed manifest. Credentials come from the local owner-only `~/Library/Application Support/Flicky/nessie.plist` file and are excluded from the report. For an account chosen in Flicky, compare its ID against the report’s account list; the verifier’s selected-account detail uses the configured account ID.
3. Ask Flicky: **“Based on this account, what bills are coming up and how much cash is left after them and a $500 reserve? Show the numbers.”** Compare the evidence with the raw API values. The current calculation is `$1,280 − $35 − $500 = $745`, floored at zero. The reserve is an app assumption, not a Nessie field or an investment recommendation.

For stronger independence, have a judge choose a record and inspect it using their own API client with the authorized sandbox key. Keep the key in a private environment variable rather than displaying a credential-bearing URL.

## Showing independence

Use a separate read-only API client to retrieve a judge-selected account or bill and compare it against Flicky’s response inspector. Refresh to show current request timestamps and statuses. This shared customer was not created by Flicky, so the demo does not modify its records. A future mutation demo should use a separate profile you own.

## What each API call powers

| API request | Visible use |
| --- | --- |
| `GET /enterprise/customers/{customerId}` | Customer name and identity |
| `GET /customers/{customerId}/accounts` | Account list, ownership validation, account selection |
| `GET /enterprise/accounts/{accountId}` | Selected balance, nickname, type, rewards |
| `GET /accounts/{accountId}/bills` | Upcoming obligations and cash after bills/reserve |
| `GET /accounts/{accountId}/deposits` | Completed recent inflows |
| `GET /accounts/{accountId}/withdrawals` | Completed recent withdrawals |
| `GET /accounts/{accountId}/purchases` | Completed recent spending |
| `GET /enterprise/merchants/{merchantId}` | Spending category labels |

The app explicitly shows unavailable data when required requests fail; it does not substitute local financial fixtures. Purchase-data failure is shown separately from zero spending. Research specialists analyze supplied account evidence; this integration does not provide live stock prices or stock-market research.
