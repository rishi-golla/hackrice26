/**
 * Flicky Proxy Worker
 *
 * Proxies requests to Claude, ElevenLabs, and Serper so the app never
 * ships with raw API keys. Keys are stored as Cloudflare secrets.
 *
 * Routes:
 *   POST /chat              → Anthropic Messages API (streaming)
 *   POST /tts               → ElevenLabs TTS API
 *   POST /transcribe-token  → AssemblyAI short-lived token
 *   POST /search            → Serper.dev product search
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  ASSEMBLYAI_API_KEY: string;
  SERPER_API_KEY?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      if (url.pathname === "/chat") return await handleChat(request, env);
      if (url.pathname === "/tts") return await handleTTS(request, env);
      if (url.pathname === "/transcribe-token") return await handleTranscribeToken(env);
      if (url.pathname === "/search") return await handleSearch(request, env);
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/chat] Anthropic error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
      ...corsHeaders,
    },
  });
}

async function handleTTS(request: Request, env: Env): Promise<Response> {
  const body = await request.text();
  const voiceId = env.ELEVENLABS_VOICE_ID;

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/tts] ElevenLabs error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "audio/mpeg",
      ...corsHeaders,
    },
  });
}

async function handleTranscribeToken(env: Env): Promise<Response> {
  const response = await fetch("https://streaming.assemblyai.com/v3/token?expires_in_seconds=480", {
    method: "GET",
    headers: { authorization: env.ASSEMBLYAI_API_KEY },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/transcribe-token] AssemblyAI error ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  return new Response(await response.text(), {
    status: 200,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { q?: string };
  const query = typeof body.q === "string" ? body.q.trim() : "";

  if (!query) {
    return new Response(JSON.stringify({ error: "Missing 'q'" }), {
      status: 400,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  const encoded = encodeURIComponent(query);
  const searchUrls: Record<string, string> = {
    google: `https://www.google.com/shopping?q=${encoded}`,
    amazon: `https://www.amazon.com/s?k=${encoded}`,
    ebay: `https://www.ebay.com/sch/i.html?_nkw=${encoded}`,
    ebayUsed: `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_ItemCondition=4`,
    facebook: `https://www.facebook.com/marketplace/search/?query=${encoded}`,
  };

  if (!env.SERPER_API_KEY) {
    return new Response(JSON.stringify({ results: [], searchUrls, query }), {
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  const serperResp = await fetch("https://google.serper.dev/shopping", {
    method: "POST",
    headers: { "X-API-KEY": env.SERPER_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "us", hl: "en", num: 10 }),
  });

  if (!serperResp.ok) {
    console.error(`[/search] Serper error ${serperResp.status}`);
    return new Response(JSON.stringify({ results: [], searchUrls, query }), {
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  const serperData = await serperResp.json() as {
    shopping?: Array<{ title?: string; price?: string; link?: string; source?: string; rating?: number }>;
  };

  const newResults = (serperData.shopping ?? []).slice(0, 8).map((item) => ({
    title: item.title ?? "Product",
    price: item.price ?? "See site",
    url: item.link ?? "",
    source: item.source ?? "Google Shopping",
    rating: item.rating ?? null,
  })).filter((item) => item.url.startsWith("http"));

  // Also fetch used items from eBay/Mercari for best-deal detection
  let usedResults: typeof newResults = [];
  try {
    const usedResp = await fetch("https://google.serper.dev/shopping", {
      method: "POST",
      headers: { "X-API-KEY": env.SERPER_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ q: `${query} used`, gl: "us", hl: "en", num: 5 }),
    });
    if (usedResp.ok) {
      const usedData = await usedResp.json() as { shopping?: Array<{ title?: string; price?: string; link?: string; source?: string; rating?: number }> };
      usedResults = (usedData.shopping ?? [])
        .filter((i) => i.source?.toLowerCase().includes("ebay") || i.source?.toLowerCase().includes("mercari"))
        .slice(0, 3)
        .map((i) => ({
          title: i.title ?? "Used item",
          price: i.price ?? "See site",
          url: i.link ?? "",
          source: (i.source ?? "eBay") + " (used)",
          rating: i.rating ?? null,
        }))
        .filter((i) => i.url.startsWith("http"));
    }
  } catch { /* ignore */ }

  const allResults = [...usedResults, ...newResults].slice(0, 10);
  return new Response(JSON.stringify({ results: allResults, searchUrls, query }), {
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}
