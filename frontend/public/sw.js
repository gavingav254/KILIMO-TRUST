/**
 * Kilimo Trust — Service Worker (sw.js)
 *
 * Strategy overview:
 *   INSTALL  → Pre-cache Top-20 profiles + all audio files + app shell
 *   ACTIVATE → Delete old caches (rolling update)
 *   FETCH    → Route-based caching strategy:
 *               • Audio files     → Cache-First (always serve locally)
 *               • API /top20      → Stale-While-Revalidate
 *               • API /scan       → Network-First (falls back to cache)
 *               • App shell       → Cache-First
 *   SYNC     → Background Sync: drain local IndexedDB outbox to server
 *   MESSAGE  → Handle "SIMULATE_OFFLINE" toggle from the UI
 */

const CACHE_VERSION = "kilimo-trust-v1.0.0";
const CACHE_APP_SHELL = `${CACHE_VERSION}-shell`;
const CACHE_AUDIO = `${CACHE_VERSION}-audio`;
const CACHE_API = `${CACHE_VERSION}-api`;

// Local dev server API base
const API_BASE = "http://localhost:3001/api/v1";

let SIMULATE_OFFLINE = false;

const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  console.log("[SW] Install event — building offline cache...");

  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(CACHE_APP_SHELL);
      await shellCache.addAll(APP_SHELL_URLS);
      console.log("[SW] App shell cached ✓");

      try {
        const [bundleRes, audioManifestRes] = await Promise.all([
          fetch(`${API_BASE}/cache/bundle`),
          fetch(`${API_BASE}/audio/manifest`),
        ]);

        const bundle = await bundleRes.json();
        const audioManifest = await audioManifestRes.json();

        const apiCache = await caches.open(CACHE_API);
        const top20Response = new Response(
          JSON.stringify({ success: true, profiles: bundle.profiles }),
          { headers: { "Content-Type": "application/json" } }
        );
        await apiCache.put(`${API_BASE}/fertilizers/top20`, top20Response);

        const bundleResponse = new Response(JSON.stringify(bundle), {
          headers: { "Content-Type": "application/json" },
        });
        await apiCache.put(`${API_BASE}/cache/bundle`, bundleResponse);
        console.log(`[SW] Top-20 profiles cached ✓ (${bundle.profiles.length} profiles)`);

        const audioCache = await caches.open(CACHE_AUDIO);
        const audioUrls = audioManifest.generic_files
          .map((f) => f.path)
          .concat(
            Object.values(audioManifest.per_language).flatMap((lang) =>
              lang.files.map((f) => f.path)
            )
          );

        let audioSuccess = 0;
        let audioFail = 0;
        for (const audioPath of audioUrls) {
          try {
            const res = await fetch(audioPath);
            if (res.ok) {
              await audioCache.put(audioPath, res);
              audioSuccess++;
            }
          } catch {
            audioFail++;
          }
        }
        console.log(`[SW] Audio files cached: ${audioSuccess} success, ${audioFail} failed ✓`);
      } catch (err) {
        console.warn("[SW] Failed to prefetch Top-20 bundle (will retry on next visit):", err.message);
      }

      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activate event — cleaning up old caches...");

  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys();
      const currentCaches = [CACHE_APP_SHELL, CACHE_AUDIO, CACHE_API];

      for (const key of cacheKeys) {
        if (!currentCaches.includes(key)) {
          await caches.delete(key);
          console.log(`[SW] Deleted old cache: ${key}`);
        }
      }

      try {
        const versionRes = await fetch(`${API_BASE}/cache/version`);
        const { cache_version } = await versionRes.json();
        if (cache_version && cache_version !== CACHE_VERSION) {
          const clients = await self.clients.matchAll();
          clients.forEach((client) =>
            client.postMessage({ type: "CACHE_UPDATE_AVAILABLE", new_version: cache_version })
          );
        }
      } catch {
        // Offline
      }

      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (SIMULATE_OFFLINE) {
    event.respondWith(serveFromCacheOnly(request));
    return;
  }

  if (url.pathname.startsWith("/audio/")) {
    event.respondWith(cacheFirst(request, CACHE_AUDIO));
    return;
  }

  if (url.pathname.includes("/fertilizers/top20") || url.pathname.includes("/cache/bundle")) {
    event.respondWith(staleWhileRevalidate(request, CACHE_API));
    return;
  }

  if (
    url.pathname.includes("/fertilizers/scan") ||
    url.pathname.includes("/escalation") ||
    url.pathname.includes("/sync")
  ) {
    event.respondWith(networkFirst(request, CACHE_API));
    return;
  }

  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(cacheFirst(request, CACHE_APP_SHELL));
    return;
  }

  event.respondWith(networkFirst(request, CACHE_APP_SHELL));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "kilimo-outbox-sync") {
    console.log("[SW] Background Sync triggered — draining outbox...");
    event.waitUntil(drainOutbox());
  }
});

async function drainOutbox() {
  try {
    const pendingItems = await getOutboxFromIDB();

    if (!pendingItems.length) return;

    const device_id = await getDeviceId();

    const res = await fetch(`${API_BASE}/sync/outbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: pendingItems, device_id }),
    });

    if (res.ok) {
      const result = await res.json();
      await clearSyncedItemsFromIDB(pendingItems.map((i) => i.case_id));

      const clients = await self.clients.matchAll();
      clients.forEach((client) =>
        client.postMessage({ type: "OUTBOX_SYNCED", result })
      );
    }
  } catch (err) {
    console.warn("[SW] Outbox sync failed:", err.message);
    throw err;
  }
}

self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case "SIMULATE_OFFLINE":
      SIMULATE_OFFLINE = payload.enabled;
      event.source?.postMessage({ type: "SIMULATE_OFFLINE_ACK", enabled: SIMULATE_OFFLINE });
      break;

    case "REFRESH_CACHE":
      refreshTop20Cache().then(() => {
        event.source?.postMessage({ type: "CACHE_REFRESHED" });
      });
      break;

    case "QUEUE_ESCALATION":
      saveToOutboxIDB(payload).then(() => {
        self.registration.sync?.register("kilimo-outbox-sync");
        event.source?.postMessage({ type: "ESCALATION_QUEUED", case_id: payload.case_id });
      });
      break;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request.clone());
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return (
      cached ||
      new Response(
        JSON.stringify({ error: "Offline — cached data not available." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      )
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise;
}

async function serveFromCacheOnly(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return new Response(
    JSON.stringify({
      offline: true,
      error: "You are in offline mode. This resource is not cached.",
      message_sw: "Huna intaneti. Tafadhali rudia ukiwa na mtandao.",
    }),
    { status: 503, headers: { "Content-Type": "application/json" } }
  );
}

async function refreshTop20Cache() {
  try {
    const res = await fetch(`${API_BASE}/cache/bundle`);
    if (!res.ok) return;
    const cache = await caches.open(CACHE_API);
    await cache.put(`${API_BASE}/fertilizers/top20`, res);
  } catch (err) {
    console.warn("[SW] Cache refresh failed:", err.message);
  }
}

const IDB_NAME = "kilimo-trust-db";
const IDB_VERSION = 1;
const OUTBOX_STORE = "outbox";

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e: any) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "case_id" });
      }
    };
    req.onsuccess = (e: any) => resolve(e.target.result);
    req.onerror = (e: any) => reject(e.target.error);
  });
}

async function saveToOutboxIDB(packet: any) {
  const db: any = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(packet);
    tx.oncomplete = resolve;
    tx.onerror = (e: any) => reject(e.target.error);
  });
}

async function getOutboxFromIDB(): Promise<any[]> {
  const db: any = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = (e: any) => resolve(e.target.result || []);
    req.onerror = (e: any) => reject(e.target.error);
  });
}

async function clearSyncedItemsFromIDB(caseIds: string[]) {
  const db: any = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    caseIds.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = (e: any) => reject(e.target.error);
  });
}

async function getDeviceId(): Promise<string> {
  const db: any = await openIDB();
  return new Promise((resolve) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const req = tx.objectStore(OUTBOX_STORE).get("__device_id");
    req.onsuccess = (e: any) => resolve(e.target.result?.value || "unknown-device");
  });
}
