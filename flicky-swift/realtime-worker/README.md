# Flicky Realtime gateway

Authenticated session-credential endpoint for the native Mac app. The OpenAI API key stays in Cloudflare; the app receives a short-lived Realtime credential.

```sh
npm ci
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put FLICKY_CLIENT_TOKEN
npm run typecheck
npm test
npm run deploy
```

Use a random client token for each private deployment. Configure this installation in `~/Library/Application Support/Flicky/realtime.json` with file permissions `0600`:

```json
{
  "endpoint": "https://YOUR-WORKER.workers.dev/session",
  "accessToken": "YOUR_CLIENT_TOKEN"
}
```

The client token must match the Worker secret. Do not put the OpenAI API key in this file or in the app bundle. Local `.dev.vars` files are ignored by Git. Removing the local configuration and restarting the app restores the legacy voice pipeline.

Control + Option captures audio while held and requests the response on release. Press it again to interrupt; Stop cancels pending audio and research. The microphone closes on release. A turn is limited to 30 seconds of recording, 120 seconds overall, and two research calls. The model is `gpt-realtime`, with `marin` and playback speed `0.9`.

The live test in `../scripts/checks/RealtimeVoiceCheck.swift` uses a synthetic audio fixture, exercises the research function and streamed playback, and consumes API credit. It never opens the microphone.
