const CACHE_NAME = "gods-git-control-v2";
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/manifest.json",
  "/js/app.js",
  "/js/api.js",
  "/js/github.js",
  "/js/toast.js",
  "/js/splash.js",
  "/js/dashboard.js",
  "/js/scan.js",
  "/js/location.js",
  "/js/status.js",
  "/js/diff.js",
  "/js/commit.js",
  "/js/hardware.js",
  "/icons/icon.svg"
];

// Install Event
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log("Pre-caching offline assets");
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("Removing legacy cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event (Cache First, Network Fallback for assets, bypass for API)
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  
  // Do not cache API endpoints
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        // Cache new static requests on the fly
        if (networkResponse.status === 200 && event.request.method === "GET") {
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Fallback offline responses (serve index.html)
      if (event.request.headers.get("accept").includes("text/html")) {
        return caches.match("/index.html");
      }
    })
  );
});
