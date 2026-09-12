# Development

```sh
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

The app starts with synthetic data because Nessie and speech credentials are not present. Use the packaged `demo/checkout.html` as a harmless checkout surface. Set `FLICKY_DATA_MODE=recorded-sandbox` and `FLICKY_SNAPSHOT_PATH` only with an explicitly labeled recording. Live Nessie is disabled until its contract and credentials are verified.

Renderer code receives only validated preload methods. The local service owns snapshots, session memory and provider secrets. `src/domain` contains all money arithmetic and uses integer cents.

## ElevenLabs voice

Copy `.env.example` to `.env` for local voice testing. Set `ELEVENLABS_API_KEY` in the local file and keep `ELEVENLABS_VOICE_ID` set to an API-eligible voice. The service uses Scribe v2 after recording release and ElevenLabs Flash v2.5 for reply audio. Credentials stay in the child service process; the renderer receives only capability flags, transcripts, validated replies, and reply audio.

If the key or voice is missing, Flicky starts with typed input and reports speech as unavailable. `ELEVENLABS_ZERO_RETENTION=true` requests provider zero-retention mode when the account supports it; local audio and transcripts are still discarded after the request.
