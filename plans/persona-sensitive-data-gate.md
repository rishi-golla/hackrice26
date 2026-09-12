# Persona verification gate — Luna implementation plan

## Objective

Require identity verification before Cappy retrieves, explains, displays, or speaks protected account information. Preserve the existing typed and cursor workflows, deterministic forecasts, session authentication, and account authorization.

This plan is implementation-ready guidance, not a claim that verification is implemented. Start with Persona Sandbox and synthetic account data. Do not read, print, copy, or modify existing environment files during implementation; the developer supplies secrets privately.

## Decisions and limits

- Use Persona Hosted Flow in the system browser, started only after the user clicks Verify. Do not put identity capture in the passive overlay.
- Use bounded backend polling for the local demo. No public webhook server, new database, or workflow framework is needed for this first slice.
- Configure a Persona inquiry template and decision workflow that reaches `approved`. `completed`, review, failed, declined, expired, unknown, and network-error states do not grant access.
- Require both a valid application session/account authorization and a matching verification grant. A Persona inquiry passing does not independently establish ownership of a bank account.
- A server-generated reference ID binds an inquiry to a user; it is correlation, not proof that the verified identity matches that user. Before using real customer data, establish enrollment and identity matching against a trusted account holder record. Keep that production requirement explicit.
- Sandbox approval unlocks only synthetic demo data. Recorded or live customer data must never be unlocked by sandbox verification.
- The current local demo authentication is not a production identity system. A local process controlled by the user is not a strong enforcement boundary for remote customer data; production enforcement belongs on the trusted data backend.
- No payments, transfers, click automation, or financial writes are included.

## Where the key goes

For local development, the developer may manually add the following variables to the existing ignored root `.env`. The child service already loads dotenv. These are configuration names and illustrative values, not working credentials:

```dotenv
PERSONA_API_KEY=<developer-supplied sandbox API key>
PERSONA_INQUIRY_TEMPLATE_ID=<configured inquiry template ID>
PERSONA_ENVIRONMENT=sandbox
PERSONA_ENVIRONMENT_ID=<sandbox environment ID starting with env_>
PERSONA_VERIFICATION_TTL_SECONDS=300
```

`PERSONA_ENVIRONMENT` is an application policy setting; use an environment-specific Persona key and verify the actual inquiry environment. Do not assume this string changes the Persona API environment. Pin the supported Persona API version explicitly in the adapter after checking current documentation.

Implementation pins API version `2025-10-27` and validates the authoritative `Persona-Environment-Id` response header against `PERSONA_ENVIRONMENT_ID`. This first implementation only permits Sandbox verification with synthetic data; production/recorded/live access stays disabled. The environment ID is not a secret; obtain the Sandbox ID from Persona's dashboard.

The key is read only by the service adapter. Never use a `VITE_` prefix, return it in public config, log it, send it over preload, or bundle it into Electron or Swift assets. Keep example documentation credential-free. Do not overwrite an existing `.env` by copying an example over it.

For production, store the production key in the hosted backend's secret manager, injected as a server environment variable. A `.env` shipped inside a desktop app is not secure key storage. macOS Keychain is suitable for user-specific credentials, not for protecting a shared provider secret distributed to every customer.

The polling MVP does not need a webhook secret. If webhooks are added later, store `PERSONA_WEBHOOK_SECRET` separately in the hosted backend secret store.

## User workflow

1. User requests protected account information or triggers a protected forecast.
2. Service checks session, account, operation, and verification grant before reading account data or constructing model context. If locked, return HTTP 403 with a structured `verification_required` code and an opaque pending-request ID.
3. Cursor shows a neutral message: “Verify your identity to view account information.” Do not include amounts, transaction labels, or a generated explanation in this response.
4. User clicks Verify. Backend creates or reuses an active inquiry bound to this session and pending request; Electron opens its validated hosted URL in the system browser.
5. UI shows Waiting for verification and a Cancel option. Backend checks Persona status with bounded polling. Browser completion and redirect parameters never authorize access.
6. Backend verifies the inquiry decision, environment, template, and stored ownership binding, then creates a five-minute grant capped by session expiry.
7. UI offers Continue to resume the original request. Revalidate its session, account, request expiry, and grant; recompute with current data. Do not replay an old generated answer.
8. Display the explanation. Speaking protected content requires a separate explicit “Read aloud” action and a fresh authorization check at `/speak`.
9. Logout, account switch, session expiry, app lock, cancellation, or grant expiry invalidates relevant pending work and clears protected UI/audio state. Ignore late results from old generations.

## Minimal state and interfaces

Add `src/service/verification.ts` with an in-memory store and injected clock/ID generator, matching the repository's session-store style. Keep provider HTTP details in `src/service/providers/persona.ts`.

```ts
type VerificationScope = 'account-sensitive-read';
type VerificationState = 'pending' | 'approved' | 'declined' | 'expired' | 'unavailable';

type VerificationGrant = {
  authSessionId: string;
  userId: string;
  accountId: string;
  scope: VerificationScope;
  inquiryId: string;
  environment: 'sandbox' | 'production';
  expiresAt: number;
};
```

Store pending requests with opaque ID, auth-session binding, account, normalized operation and arguments, generation, and expiry. Store no financial result or identity-document payload in this record. Bound storage and clear expired entries. Store only the Persona decision metadata needed for access checks; never persist ID photos or selfie data.

Provider interface: `createInquiry(binding)` and `getInquiryDecision(inquiryId)`. Inject `fetch` and configuration so tests never read dotenv or contact Persona. Use typed errors and a finite request timeout. Do not automatically retry inquiry creation without a verified idempotency mechanism.

## Task 1 — Establish the policy boundary

Files: `src/service/policy.ts`, `src/service/server.ts`, `src/service/tools.ts`, `src/service/verification.ts`, corresponding tests.

- [x] Add `requireVerification(session, accountId, scope)` alongside existing account checks. Derive identity and account from authenticated server state.
- [x] Gate `/snapshot`, `/forecast`, all account-reading tool calls, and the account-data portion of `/turn`. The current `/turn` reads a snapshot before conversation handling: move the check before that read.
- [x] Protect `/profile` responses containing account-specific information such as reserve settings, or return only deliberately public fields before verification.
- [x] Keep login, logout, health, verification routes, and generic help available without verified financial access. Do not introduce an LLM classifier to enforce access.
- [x] Protect direct API calls, not just the cursor UI. Existing `/tool` and `/turn` paths must both enforce the same policy; neither may bypass the other.
- [x] Make missing Persona configuration return `verification_unavailable` for protected operations. Do not silently unlock.
- [x] Prove denied requests never invoke snapshot providers, financial tools, model formatting, or speech synthesis with protected data.

## Task 2 — Implement Persona Sandbox adapter and endpoints

Files: `src/service/providers/persona.ts`, `src/service/verification.ts`, `src/service/server.ts`, `src/service/entry.ts`, tests.

- [x] Verify current Persona create/retrieve inquiry schemas and hosted-link generation against official documentation. Do not invent API request fields.
- [ ] Configure an inquiry template with the identity checks appropriate to the intended assurance level and an approval workflow; use sandbox identities for testing.
- [x] Add authenticated `POST /verification/start` accepting only a pending-request ID. Backend chooses user, reference ID, account, template, and environment.
- [x] Reuse an active inquiry for repeated clicks in the same session/request. Apply a small per-session creation limit and reject foreign or expired request IDs.
- [x] Add authenticated `GET /verification/status?requestId=...`. Resolve inquiry IDs from server storage; do not accept arbitrary client-supplied inquiry approvals.
- [x] Poll at most once per two seconds per active inquiry, coalesce concurrent checks, and stop automatically after two minutes. Show a pending/retry state if review takes longer; a polling timeout is not necessarily a Persona inquiry expiry.
- [x] Verify the authoritative decision and binding before minting a grant. Validate unknown statuses and malformed responses fail closed. Cap grant expiry at auth-session expiry.
- [x] Add cancel and resume endpoints for the bound pending request. Resume reruns the authorized operation and consumes the request once; repeat resumes must not execute it again.
- [x] Return only safe UI status and the hosted URL when needed. Never log the full hosted link, provider response, credentials, or identity fields.

Dashboard template configuration and real hosted-flow testing remain developer steps. Credentials/environment files were not inspected. Automated tests use injected providers only.

## Task 3 — Wire Electron and the cursor UI

Files: `src/shared/contracts.ts`, `src/desktop/preload.ts`, `src/desktop/main.ts`, `src/ui/VerificationPrompt.tsx`, `src/ui/main.tsx`, `src/ui/voice.ts`, focused UI tests.

- [x] Add narrow typed methods/events for verification start, status, cancel, and resume. Preserve sender validation and runtime IPC schemas.
- [x] Preserve structured service errors through `request()` in Electron; the current generic `Error(message)` discards machine-readable codes.
- [x] Open only backend-issued HTTPS Persona hosted URLs after explicit user activation. Validate the exact hostname against official supported hosts; expose no arbitrary URL-opening IPC method.
- [x] Implement a small prompt component with locked, pending, approved, retry, and canceled states. Reuse existing styling and buttons.
- [x] Pause automatic account previews while locked; a hover may show the verification prompt but must never repeatedly create inquiries or open browser windows.
- [x] Handle the protected snapshot request used by capture itself. OCR may remain local, but capture cannot fetch financial data before the gate.
- [x] Suppress automatic TTS for protected replies. A voice request receiving `verification_required` displays the prompt and may speak only a generic verification instruction.
- [x] Add explicit Read aloud for a verified sensitive reply. `/speak` rechecks reply ownership, account, session, sensitivity, and current grant before provider upload; reject expired grants even for old reply IDs.
- [x] Hide protected content and cancel pending work/audio at grant expiry, logout, account change, and lock. Check generation/authorization again after asynchronous work and before publishing results.

## Task 4 — Verification and handoff

- [x] Unit tests: grant expiry using an injected clock; foreign session/account/request; unknown status; sandbox-versus-production isolation; unavailable provider; duplicate start; cancellation and late approval; one-time resume.
- [x] Route tests: direct `/snapshot`, `/forecast`, `/tool`, `/turn`, protected profile, and `/speak` access denied before verification; approved bound session succeeds; another session for the same user does not inherit the grant; logout invalidates it.
- [x] Race tests: logout or expiry while Persona, model, or speech request is pending; late response cannot unlock, display, or play protected content.
- [x] UI tests: no protected text before verification, Verify opens one inquiry, Continue resumes once, cancellation leaves content locked, sensitive replies do not auto-play.
- [x] Run `npm run typecheck`, `npm test`, `npm run build`, and update/run `npm run test:e2e` to cover locked → sandbox approved → permitted → expired. Keep mock approval inside injected test providers only, never a runtime bypass route.
- [ ] Manually test hosted Sandbox flow with approved, failed, and abandoned inquiries; complete the actual browser flow and verify the backend decision, not merely a mocked UI state.
- [x] Record automated results and remaining production identity/enrollment requirements in `docs/verification.md`. Do not claim real identity verification from sandbox tests.
- [x] Leave credentials and existing unrelated changes untouched. Review a file-scoped diff; do not stage all workspace changes blindly. Do not push or deploy without an explicit request.

Automated Task 4 checks pass (185 tests across 39 files, HTTP e2e, Chrome renderer smoke, and real sandboxed Electron preload smoke). Actual Hosted Sandbox approval/failure/abandonment is still an unchecked manual acceptance requirement, not covered by these injected-provider tests. See `docs/verification.md` for the handoff.

## Later production extension — not part of the MVP

Move provider calls and access enforcement to an authenticated hosted backend connected to the real account system. Establish trusted user enrollment/identity matching and a suitable reauthentication policy. Add durable grant/revocation state if the backend has multiple instances. Prefer signed webhooks for ongoing inquiry status changes; validate Persona signatures against the raw request body, check timestamp freshness, deduplicate events, and reconcile authoritative decisions. A browser callback never replaces this check.

## Acceptance example

“Explain my balance” initially returns only a verification prompt. After the user completes the configured Persona Sandbox flow and the backend observes an approved decision for that same session/request, Continue returns the synthetic explanation. Reading aloud requires an explicit click. After five minutes or logout, both direct API access and replaying the old speech reply are denied until verification is renewed.

## Official references

- [Persona API keys and environment separation](https://docs.withpersona.com/api-keys)
- [Unique hosted inquiry links through the API](https://docs.withpersona.com/tutorial-hosted-flow-unique-api)
- [Inquiry decisions, polling, and callback limitations](https://docs.withpersona.com/accessing-inquiry-status)
- [Webhook signature verification](https://docs.withpersona.com/quickstart-webhooks)
- [Webhook best practices](https://docs.withpersona.com/webhooks-best-practices)

Suggested Luna handoff: “Implement plans/persona-sensitive-data-gate.md task by task. Start with the Sandbox polling MVP. Keep changes modular and limited to the listed integration boundaries. Do not read or edit environment files. Use injected mock providers for tests, report actual verification results, and leave production enrollment/webhooks as documented follow-up work.”
