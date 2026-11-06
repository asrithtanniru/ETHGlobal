// Kin service worker: caches the app shell and static assets so the app opens offline.
// It never touches /api/*, cross-origin requests (RPC, wallet, Arkiv, ENS) or anything but GET.
// shortcut: one fixed cache name, so old hashed chunks pile up until the version is bumped; bump it if the cache grows.
const CACHE = "kin-v1";
const OFFLINE = "/offline.html";
const PRECACHE = [OFFLINE, "/app", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // chain RPC, wallet and every third-party call go straight to the network
  if (url.pathname.startsWith("/api/")) return;
  // Next's client-side navigation payloads depend on request headers; caching them by URL alone would serve the wrong tree.
  if (req.headers.get("RSC") || url.searchParams.has("_rsc")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone(); // clone now: the page starts reading the body as soon as res is returned
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(req)) || caches.match(OFFLINE)),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    // Content-hashed and immutable: cache first.
    event.respondWith(caches.match(req).then((hit) => hit || fetchAndCache(req)));
    return;
  }

  // Other same-origin static files (art, icons, manifest, widget.js): serve cached, refresh in the background.
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetchAndCache(req).catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});

function fetchAndCache(req) {
  return fetch(req).then((res) => {
    if (res.ok && res.type === "basic") {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  });
}
