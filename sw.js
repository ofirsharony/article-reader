// Minimal service worker: makes the app installable (required for the PWA
// share target) and serves the last-fetched shell if the network is down.
// Network-first so GitHub Pages deploys show up on the next load.
const CACHE = "article-reader-v1";
const SHELL = "./index.html";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(SHELL, copy));
        return res;
      })
      .catch(() => caches.match(SHELL))
  );
});
