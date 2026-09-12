# Verification record

## Persona Tasks 1–4 (2026-09-12)

Task 1 was pushed to `persona_integration` as `6f3cd5d`. Tasks 2–3 implementation and Task 4 automated checks are local changes on that branch, not yet committed or pushed. The subsequent implementation adds a Persona Sandbox adapter, bounded in-memory requests/grants, service endpoints, and a verification prompt inside the existing Electron card. No identity-document payloads, provider responses, hosted URLs, or credentials are logged or persisted. Provider HTTP details live in `src/service/providers/persona.ts`; approval and expiry policy live in `src/service/verification.ts`.

Local developer setup (supply privately; existing env files were not inspected or modified):

- `PERSONA_API_KEY`: Sandbox API key, service process only.
- `PERSONA_INQUIRY_TEMPLATE_ID`: Dynamic Flow template ID (`itmpl_…`).
- `PERSONA_ENVIRONMENT=sandbox` and `FLICKY_DATA_MODE=synthetic`.
- `PERSONA_ENVIRONMENT_ID`: the non-secret Sandbox environment ID (`env_…`), checked against Persona's response header.
- `PERSONA_VERIFICATION_TTL_SECONDS`: optional, default 300; clamped to at most 300 seconds and auth-session expiry.

In Persona's Sandbox dashboard, use a template with the required identity checks and an approval workflow. `completed` and `needs_review` do not grant access. Confirm a passing inquiry actually reaches `approved`; the code cannot configure or confirm your dashboard settings without accessing your account. API calls are pinned to `2025-10-27`, using the [published Persona OpenAPI schema](https://github.com/persona-id/persona-openapi/tree/main/2025-10-27) and the documented [Hosted Flow URL](https://docs.withpersona.com/tutorial-hosted-flow-unique-api).

Run `npm run dev`, ask a purchase question, click **Verify identity**, finish the Sandbox browser flow, then click **Continue** when approval arrives. **Read aloud** is a separate action. A paused capture is recaptured after Continue so the app does not reuse stale screen coordinates. Expired speech requests resume as freshly computed text answers, not automatic audio. Monitoring pauses on lock and must be rearmed deliberately.

Limits are explicit: one pending operation per auth session, 10-minute request expiry, three inquiry creation attempts per session per 10 minutes, 100 entries per store, and 16 KiB per pending operation. Polls coalesce and run no faster than every two seconds for two minutes. Retry resumes status checks; ambiguous creation timeouts are not automatically retried. Cancellation, logout and app lock revoke grants and discard pending work. Stored operations are consumed synchronously before replay under the original session; clients cannot supply a replay URL or approval.

Automated verification passed on this checkout and uses injected test providers, never live credentials:

- `npm run typecheck`: passed.
- `npm test`: **185 tests passed across 39 files**, including cancellation and late results, foreign session/account/inquiry/template/environment, concurrent one-time resume, storage/creation limits, expiry, and logout during Persona/model/TTS work.
- `npm run build`: desktop, preload, service and renderer build.
- `npm run test:e2e`: actual localhost HTTP flow, locked → pending → completed (still locked) → approved → resumed once → expired → logged out.
- `node tests/e2e/verification-ui.mjs` after building: headless Chrome renders the built card at 384px and 320px, exercises Verify/Continue/expiry, and checks no automatic protected speech or retained protected answer. Uses a test-only preload bridge and prints temporary screenshot paths.
- `node tests/e2e/verification-electron.mjs` after building: real Electron with the built sandboxed preload and renderer confirms verification errors retain their code/request ID through context isolation. Its isolated host never loads dotenv or the real service.
- `git diff --check -- docs plans scripts src tests`: passed; reviewed only task files. Existing `.env.example`, `package-lock.json`, and `package-lock.json.backup` changes were not read, edited, or staged.

Task 4 caught and fixed two integration issues: requests now retain their original grant ID so reapproval cannot revive revoked work; plain error envelopes cross both Electron IPC and context isolation, with `ServiceError` reconstructed in `src/ui/bridge.ts`. Electron documents that [custom Error properties are lost across contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge). The scoped Impeccable UI review also led to clearing candidate-derived composer text on expiry and wrapping the voice controls at 320px. Both were checked in the browser smoke test and screenshots.

### Manual acceptance still required

No live Hosted Sandbox inquiry was created or completed. Task 2's dashboard template configuration and Task 4's hosted-flow checkbox remain open; neither credentials nor dashboard settings were inspected. With the privately configured Sandbox template, run `npm run dev` and check:

1. **Approved:** ask a protected question, click Verify identity once, complete a Sandbox test identity flow, and confirm the backend reports approved before Continue appears. Continue should return a fresh synthetic answer; speech must wait for Read aloud.
2. **Failed/declined:** use the template's supported Sandbox failure case. The backend must remain locked with no account answer or audio. A browser completion page alone must not unlock it.
3. **Abandoned:** close the hosted tab before completion. Polling must stop after two minutes with Retry; Cancel must leave data locked. Later browser completion must not restore a canceled request.
4. **Native lifecycle:** after approval, test screen capture, logout, OS lock/suspend, and the five-minute expiry. Protected text and audio must clear. These OS interactions were not exercised by the isolated Electron preload test.

No live Persona identity check is claimed from mocks. This demo intentionally rejects production, recorded, and live account data. Trusted account-holder enrollment, a hosted enforcement backend, and production identity matching remain the plan's later production work.

## Earlier platform verification

Verified on Windows with Node/npm:

- `npm test` passes: 16 files, 91 tests.
- `npm run typecheck` passes.
- `npm run build` passes and emits `dist/main.cjs`, `dist/preload.cjs`, `dist/service.cjs`, renderer assets and local OCR assets.
- `npm run test:e2e` passes the authenticated local service flow.
- Provider unit tests cover ElevenLabs Scribe request construction, validation, timeout/error handling and TTS response handling without logging credentials.

Known gates: no ElevenLabs credentials were present in this checkout, so live provider calls were not run; the Electron GUI, microphone permission prompt and packaged Windows launch still require a local desktop smoke test. Live Nessie remains intentionally disabled.

Native macOS note: Clicky's Xcode target is vendored under `macos/` and customized with local Vision OCR plus deterministic financial responses. This environment has Command Line Tools but no full Xcode build validation was run; follow `macos/README.md` and run the target from Xcode so TCC permissions remain valid.
