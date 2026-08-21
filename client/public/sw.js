const APP_CACHE = "coinplus-app-shell-v2";
const APP_SHELL = ["./", "./index.html", "./manifest.webmanifest", "./coinplus-map-icon.svg"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(APP_CACHE).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches
      .keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(
              cacheName =>
                cacheName.startsWith("coinplus-app-shell-") &&
                cacheName !== APP_CACHE
            )
            .map(cacheName => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          void caches.open(APP_CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
    );
    return;
  }

  if (url.pathname.includes("/data/") || url.pathname.endsWith("store-data-manifest.json")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(
      cached =>
        cached ||
        fetch(event.request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(APP_CACHE).then(cache => cache.put(event.request, copy));
          }
          return response;
        })
    )
  );
});
