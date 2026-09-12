# Task 3 report

Implemented the Cappy tool registry and replaceable model boundary.

- Added the read-only, session-required, account-scoped registry with `getSnapshot`, `forecastPurchase`, `compareScenario`, and `explainForecast`.
- Added deterministic offline formatting and an environment-configured HTTP model provider with timeout handling.
- Wired the registry endpoint and model boundary into the service while preserving deterministic forecast calculations and auth/session policy.
- Added focused tests for unknown tools, schema/account/session enforcement, deterministic replies, and model timeouts.

Validation: `npm run typecheck` and `npm test` (96 tests passed).
