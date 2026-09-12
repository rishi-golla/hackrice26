# Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The app starts with synthetic data unless another mode is selected. Use the packaged `demo/checkout.html` as a harmless checkout surface. Set `FLICKY_DATA_MODE=recorded-sandbox` and `FLICKY_SNAPSHOT_PATH` only with an explicitly labeled recording.

Renderer code receives only validated preload methods. The local service owns snapshots, session memory and provider secrets. `src/domain` contains all money arithmetic and uses integer cents.

## Nessie live sandbox

Configure the service process without printing or committing the server-only secret:

```sh
FLICKY_DATA_MODE=live-sandbox
FLICKY_SESSION_TOKEN=$(openssl rand -hex 32)
NESSIE_API_KEY=<server-only-secret>
NESSIE_CUSTOMER_ID=<sandbox-customer-id>
NESSIE_AMOUNT_UNIT=dollars
# optional: NESSIE_ACCOUNT_ID, NESSIE_BASE_URL, NESSIE_TIMEOUT_MS, NESSIE_RETRY_COUNT, NESSIE_CACHE_TTL_MS, CAPPY_TIMEZONE
npm run typecheck && npm test && npm run build && npm run dev
```

The current credential authenticates but returns no customer rows. Create or obtain a sandbox customer and account, then set `NESSIE_CUSTOMER_ID` and optionally `NESSIE_ACCOUNT_ID`, before expecting live snapshots or insights to contain account data.

For a safe smoke test, start the local service with the variables above, confirm its startup record says `live-sandbox`, authenticate through the loopback service, and request `/snapshot` plus one of the read-only `/tool` names. Record only HTTP status, resource counts, mode, coverage flags, and source endpoint names. Keep the API key out of command arguments, terminal output, URLs, saved responses, and logs; do not invoke any Nessie write route.

## ElevenLabs voice

Copy `.env.example` to `.env` for local voice testing. Set `ELEVENLABS_API_KEY` in the local file and keep `ELEVENLABS_VOICE_ID` set to an API-eligible voice. The service uses Scribe v2 after recording release and ElevenLabs Flash v2.5 for reply audio. Credentials stay in the child service process; the renderer receives only capability flags, transcripts, validated replies, and reply audio.

If the key or voice is missing, Flicky starts with typed input and reports speech as unavailable. `ELEVENLABS_ZERO_RETENTION=true` requests provider zero-retention mode when the account supports it; local audio and transcripts are still discarded after the request.
