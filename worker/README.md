# Article Reader TTS Worker

A tiny Cloudflare Worker that proxies the Article Reader page to Cloudflare
Workers AI text-to-speech (MeloTTS, Deepgram Aura-1 and Aura-2), so the static
page can use premium voices without exposing any Cloudflare API token. Two
optional backup tiers call Cartesia and Deepgram directly with their own keys.

It authenticates to Workers AI via the **AI binding** (no token), and gates
public access with a shared **access key** you choose.

## What it does

- `POST /` with header `X-Access-Key: <your key>` and JSON
  `{ "model": "melotts" | "aura-1" | "aura-2" | "cartesia" | "deepgram", "voice": "<voice>", "text": "..." }`
- Returns the spoken text as `audio/mpeg` (MP3).
- Rejects: wrong/missing key (`401`), unknown model or text over 2000 chars
  (`400`). Unknown voices fall back to the model's default voice.
- Quota or out-of-credit errors return `429`; a backup tier with no key (or a
  rejected one) returns `503 provider_unavailable`. The page moves to the next
  tier on both.
- CORS is pinned to the site origin (`ALLOWED_ORIGIN` in `worker.js`).

## Deploy (one time, free, no credit card)

1. Install wrangler locally (already done if `node_modules/` exists here) and
   log in. Use `npx wrangler` rather than a global install:
   ```sh
   npm install --save-dev wrangler   # one time, in this worker/ directory
   npx wrangler login
   ```
2. From this `worker/` directory, set your access key (pick a long random
   string — e.g. `openssl rand -hex 24`):
   ```sh
   npx wrangler secret put ACCESS_KEY
   ```
3. Deploy:
   ```sh
   npx wrangler deploy
   ```
4. Copy the printed Worker URL (e.g.
   `https://article-reader-tts.<your-subdomain>.workers.dev`) into
   `index.html` — set the `CF_WORKER_URL` constant.
5. If your site origin differs from `https://ofirsharony.github.io`, update
   `ALLOWED_ORIGIN` in `worker.js` and redeploy.

## Backup tiers (optional, free, no credit card)

Both are skipped by the page until their key is set.

- **Cartesia** (20K characters/month, resets monthly): sign up at
  https://play.cartesia.ai, create an API key, then
  `npx wrangler secret put CARTESIA_API_KEY`.
- **Deepgram** (one-time $200 credit, no expiry): sign up at
  https://console.deepgram.com, create an API key, then
  `npx wrangler secret put DEEPGRAM_API_KEY`.

Setting a secret takes effect without a redeploy, but the code that uses them
needs one `npx wrangler deploy`. The Cartesia voice ids in `CARTESIA_VOICES`
came from third-party docs; if Cartesia rejects one, list the real ids with
`curl -H "Authorization: Bearer $KEY" -H "Cartesia-Version: 2026-08-14" https://api.cartesia.ai/voices`.

## Notes

- The free Workers AI allocation is 10,000 Neurons/day. MeloTTS is cheap
  (~537 audio-min/day free); Aura-1 is richer but pricier (~7,300 chars/day).
- To rotate the key (e.g. if it leaks): `wrangler secret put ACCESS_KEY` again.
- Never commit the key. `.dev.vars` is gitignored; the key lives only as a
  Worker secret.
- `voice` is only used for `aura-1`; allowed values are in `AURA_VOICES`.
  Verify Aura-1's exact input field names against current Cloudflare docs if
  inference fails (the Worker tolerates stream / ArrayBuffer / base64 output).
