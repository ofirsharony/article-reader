# Background playback + smart prev button — design

Date: 2026-07-04
Target: `index.html` (no worker changes)

## Problem

1. On Android Chrome, playback stops shortly after the phone screen turns off.
   The two engines fail for different reasons:
   - **Browser voice (`speechSynthesis`)**: Android treats it as a page
     feature, not media. When the screen locks, Chrome throttles the tab and
     the speech engine suspends. No web API can keep `speechSynthesis`
     running with the screen off.
   - **Premium voice (Cloudflare)**: it is real audio, but the code creates a
     brand-new `Audio()` element per ~500-char chunk. Chrome blocks `.play()`
     on a fresh, never-user-activated element while the page is backgrounded,
     so playback dies at the first chunk boundary after the screen turns off.
2. The prev button always jumps to the previous section. Desired: first press
   restarts the current section; a quick second press (within 1 s) goes to
   the previous section (Spotify-style).

## Decisions (user-confirmed)

- Platform of record: Android Chrome. Engines: both are used.
- Browser voice gets an **automatic** screen wake lock while playing — no
  toggle UI. True screen-off playback remains premium-only, by platform
  constraint.
- Prev threshold: 1 second between presses.

## Design

### 1. Premium engine: persistent `<audio>` element

- Create one module-level `<audio>` element (replacing the per-chunk
  `new Audio(url)` in `playCloudflareChunk()`). The user's first tap on play
  activates it; after that, background `.play()` calls on the same element
  are allowed by Chrome.
- Chunk transition on `ended`: revoke the previous blob URL, set `src` to the
  next chunk's blob URL (usually already in the prefetch cache, so the swap
  is immediate), call `.play()`.
- `stopAll()` pauses and clears (`removeAttribute("src")` + `load()`) the
  element instead of discarding it, and still revokes any outstanding object
  URL.
- Unchanged: the `cfPlayToken` stale-async guard, the in-memory audio cache
  and `prefetchNext()`, `playbackRate` live updates, all status messages, and
  the Media Session integration (which now gets a continuous media element,
  making lock-screen controls reliable).

### 2. Browser engine: automatic screen wake lock

- While the browser engine is in state `playing`, hold a screen wake lock
  (`navigator.wakeLock.request("screen")`). Release it on pause, stop,
  finish, and error. Centralize acquire/release in the playback-state setter
  (`setControls`) keyed on `state === "playing" && activeEngine() === "browser"`.
- Wake locks auto-release when the tab is hidden; on `visibilitychange` back
  to visible, re-acquire if still playing.
- Best-effort: feature-detect `navigator.wakeLock`; swallow rejection
  (e.g. permission or battery-saver denial). No UI, no status messages.
- The premium engine does not hold a wake lock — it plays with the screen
  off.

### 3. Smart prev (all three input paths)

- One shared `handlePrev()` used by the prev button, the `ArrowLeft`
  shortcut, and the Media Session `previoustrack` / `seekbackward` handlers:
  - If the previous prev-press was **< 1000 ms** ago → `playFrom(chunkIndex - 1)`.
  - Otherwise → `playFrom(chunkIndex)` (restart current section).
  - Record the press timestamp in a module-level `lastPrevTime`.
- `updateNav()`: prev is enabled whenever playback is loaded (drop the
  `chunkIndex <= 0` condition — restarting the current section is valid on
  the first section). At section 0, the quick second press clamps to 0 via
  `playFrom`'s existing bounds clamp (restarts section 0; harmless).
- Next and restart buttons are unchanged.

## Error handling

- Wake lock failures are ignored (feature is best-effort).
- Premium fetch/play errors keep the existing `handleCfError` paths and
  messages.
- If the next chunk's blob is not yet prefetched when `ended` fires, the
  existing fetch-then-play flow runs; `.play()` still succeeds because the
  element is user-activated.

## Testing (manual — repo has no test infra)

On Android Chrome:
1. Premium voice: start an article, lock the screen, confirm playback
   continues across at least one chunk boundary and lock-screen controls
   work.
2. Browser voice: start an article, confirm the screen no longer auto-locks
   while playing, and that pausing lets it lock again.
3. Prev behavior: single press mid-section restarts the section; double
   press (< 1 s) goes back one section. Verify via button, ← key, and
   lock-screen previous.

Desktop smoke test: both engines still play, pause/resume, skip, and finish
normally.
