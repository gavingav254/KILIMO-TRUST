/**
 * Kilimo Trust — Service Worker (sw.js)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HAND THIS FILE TO THE FRONTEND TEAM (Lovable / Wendy & Brian)
 * Place this file at the ROOT of the public directory: /public/sw.js
 * Register it in index.html with: navigator.serviceWorker.register('/sw.js')
 * ═══════════════════════════════════════════════════════════════════════════
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
 *
 * @file sw.js
 */

// ── Cache Names ──────────────────────────────────────────────────────────────
const CACHE_VERSION = "kilimo-trust-v1.0.0";
const CACHE_APP_SHELL = `${CACHE_VERSION}-shell`;
const CACHE_AUDIO = `${CACHE_VERSION}-audio`;
const CACHE_API = `${CACHE_VERSION}-api`;

// ── API Base URL — UPDATE THIS to your deployed server URL ──────────────────
const API_BASE = "https://your-server.com/api/v1";
// For local development: const API_BASE = "http://localhost:3001/api/v1";

// ── Simulate Offline Flag ────────────────────────────────────────────────────
// The UI sends a message to toggle this flag for the demo presentation.
let SIMULATE_OFFLINE = false;

// ── App Shell Files to Pre-cache ─────────────────────────────────────────────
const APP_SHELL_URLS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  // Add your CSS/JS bundles here after building:
  // "/assets/index-xxxxx.js",
  // "/assets/index-xxxxx.css",
];

// ═══════════════════════════════════════════════════════════════════════════
// INSTALL EVENT — Cache app shell + prefetch Top-20 + audio files
// ═══════════════════════════════════════════════════════════════════════════
self.addEventListener("install", (event) => {
  console.log("[SW] Install event — building offline cache...");

  event.waitUntil(
    (async () => {
      // 1. Cache app shell
      const shellCache = await caches.open(CACHE_APP_SHELL);
      await shellCache.addAll(APP_SHELL_URLS);
      console.log("[SW] App shell cached ✓");

      // 2. Fetch Top-20 profiles and audio manifest from server
      try {
        const [bundleRes, audioManifestRes] = await Promise.all([
          fetch(`${API_BASE}/cache/bundle`),
          fetch(`${API_BASE}/audio/manifest`),
        ]);

        const bundle = await bundleRes.json();
        const audioManifest = await audioManifestRes.json();

        // 3. Store Top-20 JSON in API cache for offline fertilizer lookups
        const apiCache = await caches.open(CACHE_API);
        const top20Response = new Response(
          JSON.stringify({ success: true, profiles: bundle.profiles }),
          { headers: { "Content-Type": "application/json" } }
        );
        await apiCache.put(`${API_BASE}/fertilizers/top20`, top20Response);

        // Also store the full bundle for offline manual selection
        const bundleResponse = new Response(JSON.stringify(bundle), {
          headers: { "Content-Type": "application/json" },
        });
        await apiCache.put(`${API_BASE}/cache/bundle`, bundleResponse);
        console.log(`[SW] Top-20 profiles cached ✓ (${bundle.profiles.length} profiles)`);

        // 4. Download and cache all audio files
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
        console.log(
          `[SW] Audio files cached: ${audioSuccess} success, ${audioFail} failed ✓`
        );
      } catch (err) {
        console.warn("[SW] Failed to prefetch Top-20 bundle (will retry on next visit):", err.message);
      }

      // Force immediate activation (skip waiting)
      self.skipWaiting();
    })()
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVATE EVENT — Clean up stale caches
// ═══════════════════════════════════════════════════════════════════════════
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

      // Check for a new cache version from the server
      try {
        const versionRes = await fetch(`${API_BASE}/cache/version`);
        const { cache_version } = await versionRes.json();
        if (cache_version && cache_version !== CACHE_VERSION) {
          console.log(`[SW] New cache version available: ${cache_version} — notifying app...`);
          const clients = await self.clients.matchAll();
          clients.forEach((client) =>
            client.postMessage({ type: "CACHE_UPDATE_AVAILABLE", new_version: cache_version })
          );
        }
      } catch {
        // Offline — no version check
      }

      await self.clients.claim();
    })()
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// FETCH EVENT — Route-based caching strategy
// ═══════════════════════════════════════════════════════════════════════════
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // ── Simulate offline: block all non-cache fetches ──────────────────────────
  if (SIMULATE_OFFLINE) {
    event.respondWith(serveFromCacheOnly(request));
    return;
  }

  // ── Audio files → Cache-First ──────────────────────────────────────────────
  if (url.pathname.startsWith("/audio/")) {
    event.respondWith(cacheFirst(request, CACHE_AUDIO));
    return;
  }

  // ── Top-20 profiles → Stale-While-Revalidate ──────────────────────────────
  if (url.pathname.includes("/fertilizers/top20") || url.pathname.includes("/cache/bundle")) {
    event.respondWith(staleWhileRevalidate(request, CACHE_API));
    return;
  }

  // ── Scan / Escalation → Network-First, fall back to local cache ───────────
  if (
    url.pathname.includes("/fertilizers/scan") ||
    url.pathname.includes("/escalation") ||
    url.pathname.includes("/sync")
  ) {
    event.respondWith(networkFirst(request, CACHE_API));
    return;
  }

  // ── App Shell → Cache-First ────────────────────────────────────────────────
  if (request.mode === "navigate" || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(cacheFirst(request, CACHE_APP_SHELL));
    return;
  }

  // ── Everything else → Network with cache fallback ─────────────────────────
  event.respondWith(networkFirst(request, CACHE_APP_SHELL));
});

// ═══════════════════════════════════════════════════════════════════════════
// BACKGROUND SYNC — Drain outbox when connectivity is restored
// ═══════════════════════════════════════════════════════════════════════════
self.addEventListener("sync", (event) => {
  if (event.tag === "kilimo-outbox-sync") {
    console.log("[SW] Background Sync triggered — draining outbox...");
    event.waitUntil(drainOutbox());
  }
});

/**
 * Read all pending items from IndexedDB and POST them to /api/v1/sync/outbox.
 */
async function drainOutbox() {
  try {
    const pendingItems = await getOutboxFromIDB();

    if (!pendingItems.length) {
      console.log("[SW] Outbox is empty — nothing to sync.");
      return;
    }

    const device_id = await getDeviceId();

    const res = await fetch(`${API_BASE}/sync/outbox`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: pendingItems, device_id }),
    });

    if (res.ok) {
      const result = await res.json();
      console.log(`[SW] Outbox synced — accepted: ${result.accepted}, duplicate: ${result.duplicate}`);

      // Clear synced items from IndexedDB
      await clearSyncedItemsFromIDB(pendingItems.map((i) => i.case_id));

      // Notify the app
      const clients = await self.clients.matchAll();
      clients.forEach((client) =>
        client.postMessage({ type: "OUTBOX_SYNCED", result })
      );
    }
  } catch (err) {
    console.warn("[SW] Outbox sync failed — will retry on next connection:", err.message);
    throw err; // Re-throw so the browser retries
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HANDLER — Commands from the main app
// ═══════════════════════════════════════════════════════════════════════════
self.addEventListener("message", (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    // ── Demo "Flight Mode" toggle ──────────────────────────────────────────
    case "SIMULATE_OFFLINE":
      SIMULATE_OFFLINE = payload.enabled;
      console.log(`[SW] Simulate offline: ${SIMULATE_OFFLINE}`);
      event.source?.postMessage({ type: "SIMULATE_OFFLINE_ACK", enabled: SIMULATE_OFFLINE });
      break;

    // ── Force cache refresh ────────────────────────────────────────────────
    case "REFRESH_CACHE":
      refreshTop20Cache().then(() => {
        event.source?.postMessage({ type: "CACHE_REFRESHED" });
      });
      break;

    // ── Queue an offline escalation ────────────────────────────────────────
    case "QUEUE_ESCALATION":
      saveToOutboxIDB(payload).then(() => {
        // Register background sync so the outbox drains when online
        self.registration.sync?.register("kilimo-outbox-sync");
        event.source?.postMessage({ type: "ESCALATION_QUEUED", case_id: payload.case_id });
      });
      break;

    default:
      console.log("[SW] Unknown message type:", type);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Cache Strategy Helpers
// ═══════════════════════════════════════════════════════════════════════════

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
        JSON.stringify({ error: "Offline — cached data not available for this request." }),
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

// ═══════════════════════════════════════════════════════════════════════════
// Cache Refresh Helper
// ═══════════════════════════════════════════════════════════════════════════
async function refreshTop20Cache() {
  try {
    const res = await fetch(`${API_BASE}/cache/bundle`);
    if (!res.ok) return;
    const cache = await caches.open(CACHE_API);
    await cache.put(`${API_BASE}/fertilizers/top20`, res);
    console.log("[SW] Top-20 cache refreshed ✓");
  } catch (err) {
    console.warn("[SW] Cache refresh failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// IndexedDB Helpers for Outbox Queue
// ═══════════════════════════════════════════════════════════════════════════
const IDB_NAME = "kilimo-trust-db";
const IDB_VERSION = 1;
const OUTBOX_STORE = "outbox";

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "case_id" });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveToOutboxIDB(packet) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).put(packet);
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getOutboxFromIDB() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const req = tx.objectStore(OUTBOX_STORE).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function clearSyncedItemsFromIDB(caseIds) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    caseIds.forEach((id) => store.delete(id));
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
}

async function getDeviceId() {
  const db = await openIDB();
  // Stored as a special entry in the outbox store with key "__device_id"
  return new Promise((resolve) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const req = tx.objectStore(OUTBOX_STORE).get("__device_id");
    req.onsuccess = (e) => resolve(e.target.result?.value || "unknown-device");
  });
}
