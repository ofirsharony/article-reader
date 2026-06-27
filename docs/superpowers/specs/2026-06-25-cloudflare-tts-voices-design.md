# Cloudflare MeloTTS / Deepgram Aura voices — design

**Date:** 2026-06-25
**Status:** Approved (brainstorming) → implementation

## Goal

Add higher-quality, more natural text-to-speech voices to the Article Reader,
sourced from Cloudflare Workers AI, alongside the existing built-in
`speechSynthesis` voices. Personal use, on a **public** GitHub Pages site, with
**no credit card** required.

## Why a Worker is required

The browser cannot call `https://api.cloudflare.com/.../ai/run/...` directly: a
live probe showed the endpoint returns no CORS headers and `405` on the OPTIONS
preflight, so the browser blocks the request. A same-origin-friendly proxy is
unavoidable. We use the owner's own **Cloudflare Worker** with an **AI binding**
(`env.AI.run(...)`), which authenticates as the account server-side — so there is
**no Cloudflare API token anywhere** (not in the browser, not in the repo).

## Cost / plan

- Free Workers plan, free Workers AI allocation: **10,000 Neurons/day**, no CC.
- `@cf/myshell-ai/melotts`: ~18.6 Neurons/audio-min → ~537 min/day free.
- `@cf/deepgram/aura-1`: ~1,364 Neurons/1k chars → ~7,300 chars/day free.
- The free plan's hard daily cap is also a **security backstop**: a worst-case
  key compromise cannot produce a runaway bill. Going Workers Paid removes this
  backstop.

## Architecture / data flow

```
built-in voices:   page ──speechSynthesis──▶ local audio
Cloudflare voices: page ──POST {model,voice,text} + X-Access-Key──▶ Worker
                                                 │ env.AI.run(model, …)
                                                 ▼
                                            Workers AI (MeloTTS / Aura-1)
                   page ◀──────── audio/mpeg (MP3) ───────────────┘
```

## Components

### 1. Worker (`worker/` in repo, deployed separately via wrangler)

Single `POST` endpoint + `OPTIONS` preflight handler. Responsibilities:

- **Access gate:** read `X-Access-Key` header; constant-time compare to
  `env.ACCESS_KEY`. Mismatch/absent → `401`.
- **Model allowlist (critical):** accept only `melotts` and `aura-1`. Map to the
  real model id + that model's input schema:
  - `melotts` → `@cf/myshell-ai/melotts`, input `{ prompt: text, lang: "en" }`
  - `aura-1` → `@cf/deepgram/aura-1`, input `{ text, speaker: <voice> }`
    *(verify exact aura-1 param names against current docs at deploy time)*
- **Voice allowlist:** for `aura-1`, validate `voice` against the known set;
  default if absent. Ignored for `melotts`.
- **Input cap:** reject `text` longer than `MAX_CHARS` (2000) → `400`.
- **CORS:** `Access-Control-Allow-Origin: https://ofirsharony.github.io`
  (exact origin, never `*`, never reflect arbitrary Origin),
  `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: Content-Type, X-Access-Key`.
- **Response:** the model's MP3 as `audio/mpeg` (binary), plus CORS headers.
- **Errors:** generic messages only; no internal detail/stack to the client.

Config:
- `wrangler.toml` with `[ai] binding = "AI"`; no secrets committed.
- `ACCESS_KEY` set via `wrangler secret put ACCESS_KEY` (long random string).
- `.gitignore` includes `.dev.vars` and `node_modules`.

### 2. Page (`index.html`)

- **Worker URL:** hardcoded constant `CF_WORKER_URL` (not secret; passphrase
  protects it). Placeholder to be filled after deploy.
- **Premium section** (new, below existing controls), visually separate:
  - Checkbox **"Use Cloudflare voice"** → selects the active engine.
  - **Model** select: `MeloTTS — English` / `Deepgram Aura — natural`.
  - **Aura voice** select: shown/enabled only when model = aura-1; populated
    with the known Aura voice names.
  - **Access key** field (`type=password`), prefilled from localStorage,
    saved on change. Key `cf_access_key`.
  - Small note: stored in this browser only; article text is sent to Cloudflare.

### 3. Two-engine playback abstraction

Shared state stays: `chunks`, `chunkIndex`, `playbackState`, plus `setControls`
/ `updateNav`. Active engine = `cfEnable.checked ? "cloudflare" : "browser"`.

- `startReading(text)` — splits into chunks (size by engine: ~1400 for browser,
  ~500 for Cloudflare to cut first-audio latency) and calls `playFrom(0)`.
- `playFrom(index)` — `stopAll()`, set index, dispatch to the active engine's
  chunk player.
- `stopAll()` — `speechSynthesis.cancel()`, stop/teardown any current `<audio>`
  (pause, revoke object URL), and bump async guard tokens.
- **Browser engine:** existing `speakChunks()` (unchanged), guarded by
  `currentUtterance`.
- **Cloudflare engine:** `playCloudflareChunk()`:
  - guard token `cfPlayToken` (++ on each start / stopAll) so a superseded
    fetch's result is discarded;
  - `setStatus("Generating audio…")`, POST chunk to Worker, get MP3 blob →
    object URL → `new Audio()`; set `playbackRate` from the speed slider;
  - `onended` → revoke URL, advance index, play next;
  - `onerror` → error handling;
  - pause/resume via `audio.pause()/play()`.
- **Controls dispatch by engine:**
  - play/pause toggle: browser → `speechSynthesis.pause/resume`; cloudflare →
    `currentAudio.pause/play`.
  - ⏮/⏭: `playFrom(chunkIndex ∓ 1)` (engine-agnostic).
  - speed slider: browser → next chunk; cloudflare → also update
    `currentAudio.playbackRate` live.
  - toggling the Cloudflare checkbox or changing model/voice re-reads loaded
    text with the new engine (no Jina refetch), mirroring existing voice-change
    behavior.

## Error handling (Cloudflare engine)

- In-flight: status "Generating audio…".
- No key entered: focus the key field, status "Enter your Cloudflare access key."
- `401`: "Access key rejected — check your key." Keep field; don't wipe storage.
- Network / `5xx` / other: "Cloudflare voice failed. Retry, or use a built-in
  voice." Built-in always available as fallback.
- Set controls to idle on unrecoverable error.

## Security posture (baked in)

1. Server-side **model + voice allowlist** (prevents open-proxy to expensive models).
2. **Access-key gate**, long random key, constant-time compare.
3. Server-side **input cap** (2000 chars/request).
4. **Origin-pinned CORS** (exact origin, never `*`).
5. **No secrets in repo**: `ACCESS_KEY` via wrangler secret; `.dev.vars` gitignored.
   Treated as high-scrutiny under the repo's no-sensitive-push rule.
6. **Stay on free plan** → hard daily Neuron cap = bill safety net.

Accepted residual risks (personal use): localStorage key readable by same-origin
scripts (low — no third-party scripts / no `innerHTML` today); unauthenticated
request flooding bounded by free plan limits + Cloudflare DDoS protection (rate
limiting intentionally deferred); article text sent to Cloudflare (same posture
as Jina extraction).

## Scope / non-goals (YAGNI)

- English only (MeloTTS `lang=en`; Aura English voices).
- No per-chunk audio prefetch (sequential fetch-then-play).
- No Worker rate limiting yet (KV counter is an easy future add-on).
- No Aura-2 yet.

## Testing

- Page logic is tested in-browser with **fetch mocked** to return a fake MP3
  (the real Worker isn't deployed and the key/URL don't exist yet): verify engine
  switching, chunked playback, play/pause, ⏮/⏭, live speed, passphrase save,
  and 401 / network error handling.
- End-to-end against the real Worker is a manual step the owner runs after
  deploying (deploy steps in `worker/README.md`).
