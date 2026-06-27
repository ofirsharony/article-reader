// Article Reader TTS proxy — Cloudflare Worker
//
// Gates access with a shared key, allowlists models/voices, caps input length,
// pins CORS to the site origin, and proxies to Workers AI via the AI binding
// (so there is NO Cloudflare API token stored anywhere).
//
// Deploy: see README.md. Set the access key with:
//   wrangler secret put ACCESS_KEY

// Allowlisted origins (not a wildcard). localhost is for local testing.
const ALLOWED_ORIGINS = new Set([
  "https://ofirsharony.github.io",
  "http://localhost:8000",
]);
const DEFAULT_ORIGIN = "https://ofirsharony.github.io";
const MAX_CHARS = 2000;

// Known Deepgram Aura-1 English voices (allowlist). Update if Cloudflare changes them.
const AURA_VOICES = new Set([
  "angus", "asteria", "arcas", "athena", "helios", "hera",
  "luna", "orion", "orpheus", "perseus", "stella", "zeus",
]);
const DEFAULT_AURA_VOICE = "asteria";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Access-Key",
    "Access-Control-Max-Age": "86400",
  };
}

function json(request, status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(request) },
  });
}

function audioResponse(request, body) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "audio/mpeg", ...corsHeaders(request) },
  });
}

// Constant-time comparison that also hides length: hash both sides to a
// fixed 32-byte SHA-256 digest, then compare the digests byte-by-byte. The
// loop always runs over 32 bytes regardless of input length, so neither the
// match result nor the key length is observable via timing.
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const [ah, bh] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const av = new Uint8Array(ah);
  const bv = new Uint8Array(bh);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method !== "POST") {
      return json(request, 405, { error: "method_not_allowed" });
    }

    // Access gate.
    const key = request.headers.get("X-Access-Key") || "";
    if (!env.ACCESS_KEY || !(await timingSafeEqual(key, env.ACCESS_KEY))) {
      return json(request, 401, { error: "unauthorized" });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json(request, 400, { error: "bad_json" });
    }

    const text = (body.text || "").toString();
    if (!text.trim()) return json(request, 400, { error: "empty_text" });
    if (text.length > MAX_CHARS) return json(request, 400, { error: "text_too_long" });

    // Model + voice allowlist — never let the client pick an arbitrary model.
    const model = (body.model || "melotts").toString();
    let aiModel;
    let input;
    if (model === "melotts") {
      aiModel = "@cf/myshell-ai/melotts";
      input = { prompt: text, lang: "en" };
    } else if (model === "aura-1") {
      aiModel = "@cf/deepgram/aura-1";
      let voice = (body.voice || DEFAULT_AURA_VOICE).toString();
      if (!AURA_VOICES.has(voice)) voice = DEFAULT_AURA_VOICE;
      input = { text, speaker: voice };
    } else {
      return json(request, 400, { error: "model_not_allowed" });
    }

    try {
      const result = await env.AI.run(aiModel, input);

      // The AI binding may return audio as a stream, a base64 string in
      // { audio }, or an ArrayBuffer — handle all three.
      if (result instanceof ReadableStream) {
        return audioResponse(request, result);
      }
      if (result instanceof ArrayBuffer) {
        return audioResponse(request, result);
      }
      if (result && typeof result.audio === "string") {
        const bin = atob(result.audio);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return audioResponse(request, bytes);
      }
      return json(request, 502, { error: "unexpected_model_output" });
    } catch {
      return json(request, 502, { error: "inference_failed" });
    }
  },
};
