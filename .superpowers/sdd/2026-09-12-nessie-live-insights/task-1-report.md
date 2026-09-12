# Task 1 report

Implemented a typed, server-side Nessie read client in `src/service/providers/nessie.ts` with the required customer, account, merchant, ATM, and branch reads. Requests use native `URL`, `fetch`, and `AbortController`; retries are bounded for rate limits, server errors, and network/timeout failures. Provider errors expose the required kinds and status while messages contain no API key. No logging or write/transaction methods were added.

Added focused tests covering URL key construction, auth/not-found mapping, retry success, timeout mapping, malformed JSON, and key redaction. The required red phase failed because the client module was missing.

Verification:

- `npm run typecheck` — passed.
- `npm test -- tests/service/nessie-client.test.ts` — 7 passed.
- `npm test` — 33 files, 137 tests passed.

Concerns: none within task scope. The worktree contains unrelated pre-existing changes (`.env.example`, plan/spec files); they were left untouched.
