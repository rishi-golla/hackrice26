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
 *   POST /fetch-page        → Fetches a single listing URL and extracts
 *                             readable text (title + body copy) so Flicky
 *                             can fact-check a listing against the real
 *                             page instead of only Serper's search snippet.
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ELEVENLABS_VOICE_ID: string;
  ASSEMBLYAI_API_KEY: string;
  SERPER_API_KEY?: string;
}

// Minimal hand-rolled ambient type for the Workers runtime's HTMLRewriter
// API. This project intentionally avoids the @cloudflare/workers-types
// dependency (see the hand-written `Env` interface above for the same
// pattern) — `wrangler deploy` bundles via esbuild and doesn't type-check,
// so this is just enough shape for editor/IDE clarity.
declare class HTMLRewriter {
  on(
    selector: string,
    handlers: {
      element?(element: { onEndTag(callback: () => void): void }): void;
      text?(chunk: { text: string }): void;
    }
  ): HTMLRewriter;
  transform(response: Response): Response;
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
      if (url.pathname === "/fetch-page") return await handleFetchPage(request);
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
    shopping?: Array<{ title?: string; price?: string; link?: string; source?: string; rating?: number; imageUrl?: string; delivery?: string }>;
  };

  const newResults = (serperData.shopping ?? []).slice(0, 8).map((item) => ({
    title: item.title ?? "Product",
    price: item.price ?? "See site",
    url: item.link ?? "",
    source: item.source ?? "Google Shopping",
    rating: item.rating ?? null,
    imageUrl: item.imageUrl ?? null,
    delivery: item.delivery ?? null,
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
      const usedData = await usedResp.json() as { shopping?: Array<{ title?: string; price?: string; link?: string; source?: string; rating?: number; imageUrl?: string; delivery?: string }> };
      usedResults = (usedData.shopping ?? [])
        .filter((i) => i.source?.toLowerCase().includes("ebay") || i.source?.toLowerCase().includes("mercari"))
        .slice(0, 3)
        .map((i) => ({
          title: i.title ?? "Used item",
          price: i.price ?? "See site",
          url: i.link ?? "",
          source: (i.source ?? "eBay") + " (used)",
          rating: i.rating ?? null,
          imageUrl: i.imageUrl ?? null,
          delivery: i.delivery ?? null,
        }))
        .filter((i) => i.url.startsWith("http"));
    }
  } catch { /* ignore */ }

  const allResults = [...usedResults, ...newResults].slice(0, 10);
  return new Response(JSON.stringify({ results: allResults, searchUrls, query }), {
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

/**
 * Fetches a single listing page and extracts readable text (page title +
 * visible body copy, with script/style/nav/header/footer/etc. stripped
 * out) so Flicky can fact-check a listing (stock status, real shipping
 * cost, condition, etc.) against the actual page instead of only Serper's
 * search snippet.
 *
 * Deliberately called for at most the 1-3 listings that are about to be
 * shown to the user in a given round (see CompanionManager.swift), not
 * every search result — full page text is expensive to both fetch and
 * feed into Claude, so this route is only ever invoked sparingly.
 */
async function handleFetchPage(request: Request): Promise<Response> {
  const requestBody = (await request.json()) as { url?: string };
  const targetUrl = typeof requestBody.url === "string" ? requestBody.url.trim() : "";

  if (!targetUrl.startsWith("https://")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid 'url' (must start with https://)" }),
      { status: 400, headers: { "content-type": "application/json", ...corsHeaders } }
    );
  }

  // Many retail/listing sites hang or throttle scraping-looking requests —
  // bound the fetch so a single slow site can't stall a research round.
  const abortController = new AbortController();
  const abortTimeoutId = setTimeout(() => abortController.abort(), 8000);

  let pageResponse: Response;
  try {
    pageResponse = await fetch(targetUrl, {
      signal: abortController.signal,
      redirect: "follow",
      headers: {
        // Plenty of retail sites block requests that don't look like a
        // real browser, so present a normal desktop Chrome UA.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    console.error(`[/fetch-page] Fetch failed for ${targetUrl}:`, error);
    return new Response(JSON.stringify({ error: "Failed to fetch page" }), {
      status: 502,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  } finally {
    clearTimeout(abortTimeoutId);
  }

  if (!pageResponse.ok) {
    console.error(`[/fetch-page] ${targetUrl} returned ${pageResponse.status}`);
    return new Response(JSON.stringify({ error: `Page returned ${pageResponse.status}` }), {
      status: 502,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  const contentType = pageResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    return new Response(JSON.stringify({ error: "Not an HTML page" }), {
      status: 415,
      headers: { "content-type": "application/json", ...corsHeaders },
    });
  }

  const MAX_EXTRACTED_TEXT_CHARACTERS = 6000;
  const NOISE_TAG_SELECTOR = "script, style, nav, header, footer, noscript, svg, iframe, form";

  let extractedTitleText = "";
  let extractedBodyText = "";
  // Shared counter for "are we currently inside a noise tag (script/nav/
  // etc.)". Incremented on every matching open tag, decremented on its
  // matching end tag, so nested noise tags (e.g. <header><nav>) are still
  // correctly tracked as "inside a skip region" until fully closed.
  let noiseTagNestingDepth = 0;

  const rewriter = new HTMLRewriter()
    .on("title", {
      text(chunk) {
        if (extractedTitleText.length < 200) {
          extractedTitleText += chunk.text;
        }
      },
    })
    .on(NOISE_TAG_SELECTOR, {
      element(element) {
        noiseTagNestingDepth += 1;
        element.onEndTag(() => {
          noiseTagNestingDepth = Math.max(0, noiseTagNestingDepth - 1);
        });
      },
    })
    .on("body *", {
      text(chunk) {
        if (noiseTagNestingDepth > 0) return;
        if (extractedBodyText.length >= MAX_EXTRACTED_TEXT_CHARACTERS) return;
        const trimmedChunkText = chunk.text.trim();
        if (!trimmedChunkText) return;
        extractedBodyText += (extractedBodyText.length > 0 ? " " : "") + trimmedChunkText;
      },
    });

  const transformedResponse = rewriter.transform(pageResponse);
  // HTMLRewriter transforms lazily as the response body is read — the
  // handlers above never fire unless something actually consumes the
  // transformed body, so force that here (the text itself is discarded;
  // we only want the side effects captured above).
  await transformedResponse.text();

  return new Response(
    JSON.stringify({
      url: targetUrl,
      title: extractedTitleText.trim(),
      text: extractedBodyText.slice(0, MAX_EXTRACTED_TEXT_CHARACTERS).trim(),
    }),
    { headers: { "content-type": "application/json", ...corsHeaders } }
  );
}
