# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static web app (`index.html`) that extracts article text from a URL and reads it aloud, plus an optional Cloudflare Worker (`worker/`) that proxies premium text-to-speech. The page is deployed as-is to GitHub Pages — no build step, no dependencies, no tests. All HTML, CSS, and JS live inline in `index.html`.

## Running and testing

Open `index.html` directly in a browser, or serve the directory (e.g. `python3 -m http.server`) and reload after changes. Deploying the page is just uploading `index.html` (and `README.md`) to a repo root with GitHub Pages serving from the `main` branch root.

The Worker is deployed separately with wrangler from `worker/` (`npx wrangler deploy`); see `worker/README.md`. Its shared access key is a Worker secret (`wrangler secret put ACCESS_KEY`) — never commit it. The page finds the Worker via the `CF_WORKER_URL` constant in `index.html`.

## Architecture

**Article extraction** — `loadArticle()` fetches `https://r.jina.ai/<article-url>` (Jina Reader, keyless) with headers that request plain text (`X-Return-Format: text`), drop images, and strip page chrome via `X-Remove-Selector`. The text then passes through a cleanup pipeline: `cleanArticle()` (strips residual Jina preamble/markdown, adds terminal punctuation to headings so the voice pauses) → `normalizeForSpeech()` (removes leaked CSS, reference markers `[12]`, nav remnants) → `expandForSpeech()` (expands `$`, `%`, `e.g.`, ranges, etc. into spoken words; strips emoji). This pipeline was tuned against ~11 real sources — be conservative when changing regexes; each one guards against a specific false positive noted in its comment. Extraction failure falls back to a manual paste textarea.

**Two TTS engines**, selected by the "Use premium voice" checkbox (`activeEngine()`):

- **Browser** — `speechSynthesis`. Chunks of ~1400 chars (`BROWSER_CHUNK`) play sequentially via `utterance.onend` chaining in `speakChunks()`. Rate changes require re-speaking the current chunk (the API can't change rate mid-utterance). Word-level highlighting uses `onboundary` where supported (not iOS Safari). Voices load asynchronously — `loadVoices()` is wired to both initial load and `onvoiceschanged`, and filters to curated en-US/en-GB voices.
- **Cloudflare (premium)** — `playCloudflareChunk()` POSTs each chunk (~500 chars, `CF_CHUNK`, smaller for first-audio latency) to the Worker and plays the returned MP3 via an `<audio>` element. Has an in-memory audio cache with next-chunk prefetch, and supports live `playbackRate` changes.

**Stale-callback guards** — both engines replay/skip by cancelling and restarting, so every async callback validates it still owns playback before acting: browser callbacks check `utterance === currentUtterance`; Cloudflare callbacks capture and compare the incrementing `cfPlayToken`. `stopAll()` invalidates both. When touching playback, preserve this pattern or prev/next will double-advance chunks.

**Shared playback state** — module-level `chunks` / `chunkIndex` / `playbackState` (`idle | playing | paused`) drive everything: the clickable chunk reading view (`renderChunks()` / `highlightChunk()`), progress bar + ETA, prev/next/restart controls, keyboard shortcuts (Space/K, arrows), and the Media Session API (lock-screen controls).

**Persistence (localStorage)** — voice/speed/model prefs (`ar_prefs`), per-URL resume positions pruned after 7 days (`ar_positions`), and the premium access key (`cf_access_key`, stays client-side; sent only to the Worker).

**The Worker** (`worker/worker.js`, single file) — gates on `X-Access-Key` (timing-safe compare), allowlists models (MeloTTS, Aura-1, Aura-2) and voices, caps text at 2000 chars, pins CORS to the GitHub Pages origin + localhost, and calls Workers AI through the `AI` binding so no Cloudflare API token exists anywhere. The client's voice lists in `index.html` are a curated subset of the Worker's allowlists — keep them in sync when adding voices.
