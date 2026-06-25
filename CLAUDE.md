# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-file static web app (`index.html`) that extracts article text from a URL and reads it aloud. Deployed as-is to GitHub Pages — there is no build step, no dependencies, no package manager, and no tests. Everything (HTML, CSS, JS) lives inline in `index.html`.

## Running and testing

Open `index.html` directly in a browser, or serve the directory (e.g. `python3 -m http.server`) and visit it. Changes are reflected on reload. Deployment is just uploading `index.html` (and `README.md`) to a repo root with GitHub Pages serving from the `main` branch root.

## Architecture

Two external pieces drive the app, both browser-native or keyless by design (GitHub Pages has no backend to hold an API key):

- **Article extraction** — `loadArticle()` fetches `https://r.jina.ai/<article-url>` (Jina Reader), which returns the article as markdown-ish text. `cleanArticle()` strips Jina's `Title:`/`URL Source:`/`Markdown Content:` headers and markdown syntax down to plain prose. Extraction can fail or be rate-limited; the UI falls back to a manual paste textarea.
- **Text-to-speech** — uses the browser `speechSynthesis` API. `splitText()` chunks prose into ~1400-char segments on sentence boundaries because long utterances are unreliable across browsers. `speakChunks()` plays them sequentially via `utterance.onend` chaining, tracked by the module-level `chunks` / `chunkIndex` state. Voices populate asynchronously, so `loadVoices()` is wired to both initial load and `speechSynthesis.onvoiceschanged`.

When changing playback behavior, keep the chunking + sequential-`onend` model in mind: pause/resume/stop operate on the global `speechSynthesis` queue, not on individual chunks.
