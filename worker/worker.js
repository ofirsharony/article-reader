// Article Reader TTS proxy — Cloudflare Worker
//
// Gates access with a shared key, allowlists models/voices, caps input length,
// pins CORS to the site origin, and proxies to Workers AI via the AI binding
// (so there is NO Cloudflare API token stored anywhere). Two backup tiers call
// external free-tier APIs directly: Cartesia and Deepgram, each keyed by its own
// Worker secret.
//
// Deploy: see README.md. Set the keys with:
//   wrangler secret put ACCESS_KEY
//   wrangler secret put CARTESIA_API_KEY   (optional)
//   wrangler secret put DEEPGRAM_API_KEY   (optional)

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

// Known Deepgram Aura-2 English voices (allowlist). Larger, newer voice set.
const AURA2_VOICES = new Set([
  "amalthea", "andromeda", "apollo", "arcas", "aries", "asteria",
  "athena", "atlas", "aurora", "callista", "cora", "cordelia",
  "delia", "draco", "electra", "harmonia", "helena", "hera",
  "hermes", "hyperion", "iris", "janus", "juno", "jupiter",
  "luna", "mars", "minerva", "neptune", "odysseus", "ophelia",
  "orion", "orpheus", "pandora", "phoebe", "pluto", "saturn",
  "thalia", "theia", "vesta", "zeus",
]);
const DEFAULT_AURA2_VOICE = "luna";

// Cartesia voices (allowlist): short name -> voice id. IDs come from third-party docs
// (LiveKit, Cartesia's Sonic-3 examples); check them with GET /voices if a request fails.
const CARTESIA_VOICES = {
  katie: "f786b574-daa5-4673-aa0c-cbe3e8534c02",
  jacqueline: "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
  kiefer: "228fca29-3a0a-435c-8728-5cb483251068",
  blake: "a167e0f3-df7e-4d52-a9c3-f949145efdab",
};
const DEFAULT_CARTESIA_VOICE = "katie";
const CARTESIA_MODEL = "sonic-3";
const CARTESIA_VERSION = "2026-08-14";

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
    const voice = (body.voice || "").toString();
    if (model === "cartesia") return cartesia(request, env, text, voice);
    if (model === "deepgram") return deepgram(request, env, text, voice);

    let aiModel;
    let input;
    if (model === "melotts") {
      aiModel = "@cf/myshell-ai/melotts";
      input = { prompt: text, lang: "en" };
    } else if (model === "aura-1") {
      aiModel = "@cf/deepgram/aura-1";
      input = { text, speaker: AURA_VOICES.has(voice) ? voice : DEFAULT_AURA_VOICE };
    } else if (model === "aura-2") {
      aiModel = "@cf/deepgram/aura-2-en";
      input = { text, speaker: AURA2_VOICES.has(voice) ? voice : DEFAULT_AURA2_VOICE };
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
    } catch (err) {
      // Surface why inference failed (the access key already gates who can
      // see this). Quota/capacity exhaustion gets its own status so the
      // client can tell "out of free Neurons" apart from a transient error.
      const detail = String((err && err.message) || err).slice(0, 200);
      const isQuota = /quota|capacity|neurons|rate.?limit|exceeded|3040/i.test(detail);
      return json(request, isQuota ? 429 : 502, { error: "inference_failed", detail });
    }
  },
};

// Cartesia Sonic, free plan: 20K characters/month.
async function cartesia(request, env, text, voice) {
  if (!env.CARTESIA_API_KEY) return notConfigured(request, "cartesia");
  const id = CARTESIA_VOICES[voice] || CARTESIA_VOICES[DEFAULT_CARTESIA_VOICE];
  return upstream(request, "cartesia", "https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.CARTESIA_API_KEY}`,
      "Cartesia-Version": CARTESIA_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: CARTESIA_MODEL,
      transcript: text,
      voice: id,
      output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      language: "en",
    }),
  });
}

// Deepgram's own API (Aura-2, same voices as the Workers AI tier), paid from the
// one-time $200 signup credit.
async function deepgram(request, env, text, voice) {
  if (!env.DEEPGRAM_API_KEY) return notConfigured(request, "deepgram");
  const name = AURA2_VOICES.has(voice) ? voice : DEFAULT_AURA2_VOICE;
  const url = `https://api.deepgram.com/v1/speak?model=aura-2-${name}-en&encoding=mp3`;
  return upstream(request, "deepgram", url, {
    method: "POST",
    headers: { "Authorization": `Token ${env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

// A backup tier without its secret is skipped by the client like an exhausted one.
function notConfigured(request, provider) {
  return json(request, 503, { error: "provider_unavailable", detail: `${provider}: no API key set on the Worker` });
}

// Call an external TTS API and pass its MP3 through. Out of credit (402) or rate
// limited (429) maps to 429, so the client moves to the next tier; a rejected key
// (401/403) maps to 503 provider_unavailable, which the client treats the same way.
async function upstream(request, provider, url, init) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return json(request, 502, { error: "inference_failed", detail: `${provider}: ${String(err).slice(0, 160)}` });
  }
  if (res.ok) return audioResponse(request, res.body);
  const detail = `${provider} HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`;
  if (res.status === 402 || res.status === 429) return json(request, 429, { error: "inference_failed", detail });
  if (res.status === 401 || res.status === 403) return json(request, 503, { error: "provider_unavailable", detail });
  return json(request, 502, { error: "inference_failed", detail });
}
