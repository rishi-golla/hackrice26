import { timingSafeEqual } from "node:crypto";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = { "content-type": "application/json", "cache-control": "no-store" };
    if (new URL(request.url).pathname !== "/session") {
      return new Response(null, { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const suppliedToken = request.headers.get("authorization") ?? "";
    const encoder = new TextEncoder();
    const [suppliedHash, expectedHash] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(suppliedToken)),
      crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${env.FLICKY_CLIENT_TOKEN}`)),
    ]);
    if (!env.FLICKY_CLIENT_TOKEN || !timingSafeEqual(new Uint8Array(suppliedHash), new Uint8Array(expectedHash))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    try {
      const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            type: "realtime",
            model: "gpt-realtime",
            max_output_tokens: 800,
            output_modalities: ["audio"],
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                turn_detection: null,
                transcription: { model: "gpt-4o-mini-transcribe" },
              },
              output: { format: { type: "audio/pcm", rate: 24000 }, voice: "marin", speed: 0.9 },
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        console.error(JSON.stringify({ event: "realtime_session_failed", status: response.status }));
        return new Response(JSON.stringify({ error: "OpenAI could not start voice. Check API billing and model access." }),
          { status: 502, headers });
      }
      return new Response(response.body, { headers });
    } catch {
      return new Response(JSON.stringify({ error: "Voice service connection timed out. Try again." }),
        { status: 504, headers });
    }
  },
} satisfies ExportedHandler<Env>;
