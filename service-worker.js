const APP_CACHE = "pwa-local-chat-app-v1";
const RUNTIME_CACHE = "pwa-local-chat-runtime-v1";
const CORE_ASSETS = ["./", "./index.html", "./app.js", "./manifest.json", "./docs/negocio.txt"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => ![APP_CACHE, RUNTIME_CACHE].includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);

    if (networkResponse && (networkResponse.ok || networkResponse.type === "opaque")) {
      const runtimeCache = await caches.open(RUNTIME_CACHE);
      runtimeCache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    const fallbackResponse = await caches.match("./index.html");
    if (request.mode === "navigate" && fallbackResponse) {
      return fallbackResponse;
    }
    throw error;
  }
}