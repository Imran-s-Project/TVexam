// ==========================================================================
// sw.js — TV Exam Service Worker
// Cache: shell + static assets (CSS/JS/fonts)
// Network-first for Firebase API calls
// ==========================================================================

const CACHE  = "tv-exam-v1";
const STATIC = [
  "/",
  "/index.html",
  "/css/base.css",
  "/css/auth.css",
  "/css/exam.css",
  "/js/theme.js",
  "/assets/logo.png",
  "/assets/google.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Always network-first for Firebase + CDN
  if (
    url.hostname.includes("firebase") ||
    url.hostname.includes("googleapis") ||
    url.hostname.includes("gstatic") ||
    url.hostname.includes("cdnjs") ||
    url.hostname.includes("fonts.googleapis")
  ) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // Cache-first for same-origin static assets
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});
