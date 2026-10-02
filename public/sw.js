/* Wyndos offline support.
 *
 * Pages: network first (6s), then the last copy saved on this phone, then a simple offline page.
 * Next.js app files (/_next/static): saved once, used from the phone after that.
 * Server actions, API calls and Next's in-page data requests always go to the network:
 * when there's no signal Next falls back to a full page load, which is served from here.
 */

const VERSION = "v5";
const PAGES = `wyndos-pages-${VERSION}`;
const STATIC = `wyndos-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];
const NETWORK_TIMEOUT = 6000;
const MAX_PAGES = 100;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      // Drops our older caches and the ones the old next-pwa worker made.
      .then((keys) => Promise.all(keys.filter((key) => key !== PAGES && key !== STATIC).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || request.headers.has("Next-Router-State-Tree") || url.searchParams.has("_rsc");
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

async function trimPages() {
  const cache = await caches.open(PAGES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_PAGES; i++) await cache.delete(keys[i]);
}

/** Cache a page only when it's a real signed-in page (not a redirect to sign in, not an error). */
function cacheablePage(response) {
  if (!response || !response.ok || response.redirected || response.type !== "basic") return false;
  const type = response.headers.get("Content-Type") || "";
  return type.includes("text/html");
}

async function handleNavigation(request) {
  const cache = await caches.open(PAGES);
  try {
    const response = await withTimeout(fetch(request), NETWORK_TIMEOUT);
    if (cacheablePage(response)) {
      cache.put(request, response.clone()).then(trimPages).catch(() => {});
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}

async function handleStatic(request) {
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function handleAsset(request) {
  // Images, fonts, icons: use the saved copy straight away and refresh it in the background.
  const cache = await caches.open(STATIC);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => { if (response.ok) cache.put(request, response.clone()).catch(() => {}); return response; })
    .catch(() => cached);
  return cached || network;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  if (url.pathname.startsWith("/payments/import")) return; // bank statement matching: never saved on the phone

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStatic(request));
    return;
  }
  if (isRscRequest(request, url)) return; // in-page data: always live
  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/icons/") || /\.(png|jpg|jpeg|svg|webp|woff2?|ico)$/.test(url.pathname)) {
    event.respondWith(handleAsset(request));
  }
});

/** Save pages (and the app files they need) so they open with no signal. */
async function warm(urls) {
  const pages = await caches.open(PAGES);
  const assets = await caches.open(STATIC);
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "include", headers: { Accept: "text/html" } });
      if (!cacheablePage(response)) continue;
      const html = await response.clone().text();
      await pages.put(new Request(url), response);
      const files = new Set();
      const pattern = /\/_next\/static\/[^"'\s)\\]+/g;
      let match;
      while ((match = pattern.exec(html))) files.add(match[0]);
      for (const file of files) {
        if (await assets.match(file)) continue;
        try {
          const asset = await fetch(file);
          if (asset.ok) await assets.put(file, asset);
        } catch {}
      }
    } catch {}
  }
  await trimPages();
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "warm" && Array.isArray(data.urls)) {
    event.waitUntil(warm(data.urls));
  } else if (data.type === "clear") {
    // Signed out: don't leave anyone's pages on the phone.
    event.waitUntil(caches.delete(PAGES));
  }
});
