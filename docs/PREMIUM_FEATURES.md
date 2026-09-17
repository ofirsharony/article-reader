# Premium features

The reader has two text-to-speech engines, selected by the "Use premium voice" checkbox. The free engine is the
browser's built-in `speechSynthesis`; the premium engine streams MP3 audio from the Cloudflare Worker and plays it
through `<audio>` elements. Some features are only possible on the premium path, because they depend on having real
audio rather than an utterance the platform controls. This file lists them, with the reason each one cannot be offered
on the free voice.

## Playback keeps going when the screen is off

Pressing the power button locks the screen without stopping premium playback. `<audio>` playback is a media session
in the eyes of Android and iOS, the same as a music app, so the OS keeps the tab alive. The next chunk is pre-fetched
into a second `<audio>` element while the current one plays, and the handoff runs synchronously from `onended`, so
there is no silent gap in which the platform could suspend the page.

The free voice cannot do this. `speechSynthesis` is not media playback, so when the screen locks the browser freezes
the tab and the chunk-to-chunk chaining in JavaScript never runs. The app holds a screen wake lock while the free
voice is playing, which only prevents the idle timeout, not a deliberate lock.

## Lock-screen and notification controls

Play/pause and previous/next on the lock screen come from the Media Session API, which platforms surface reliably
only when a real media element is playing. With the free voice there is no media session to attach them to.

## Instant speed changes

Dragging the speed slider or tapping the ± buttons takes effect immediately, because `playbackRate` on an `<audio>`
element can change mid-playback. The free voice cannot change rate mid-utterance, so a speed change there means
cancelling and re-speaking the current chunk from the listening spot.

## Press-and-hold 2× boost

Pressing and holding on the reading view temporarily doubles the speed and releases back to normal. This is applied
through `playbackRate` and is premium only: on the free voice a hold would mean re-speaking the sentence twice, once
faster and once again at normal speed.

## Higher quality voices and a random narrator

Premium offers Deepgram Aura-2 and Aura-1 voices plus MeloTTS, with a curated list of narrators. The default voice is
"Random", which picks one narrator per article so an article keeps a single voice throughout. The free voice is
limited to whatever en-US/en-GB voices the device ships with.

## Automatic quota fallback

When the Worker reports that a tier's daily quota or capacity is exhausted, playback degrades automatically
(Aura-2 → Aura-1 → MeloTTS → free browser voice) and re-chunks by character position so the listening spot survives
the switch. Every new article starts again at the preferred tier since the quota resets daily.

## Gapless chunk transitions and prefetch

Chunks are cached in memory and the next one is fetched and loaded while the current one plays, so the transition is
gapless. The free voice hands each chunk to the system synthesizer one at a time and pauses briefly between them.

## What the free voice still does

Everything else is engine independent: article extraction and boilerplate trimming, the reading view with chunk and
sentence highlighting, sentence-level navigation, tap-to-seek, keyboard shortcuts, resume positions, recents, and
offline replay of saved text. The free voice also highlights individual words on voices that report word boundaries,
which the premium path cannot do because MP3 audio carries no word timings.

## Requirements

Premium needs the Cloudflare Worker deployed (see `worker/README.md`), a network connection, and the shared access
key entered once in the page. The key stays in the browser's localStorage and is sent only to the Worker.
