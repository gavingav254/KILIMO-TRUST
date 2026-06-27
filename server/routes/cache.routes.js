/**
 * Cache Routes — /api/v1/cache
 *
 * Provides the service worker with everything it needs during its
 * INSTALL phase to build the offline cache pool.
 *
 * Routes:
 *   GET  /api/v1/cache/manifest          → Full list of URLs to pre-cache
 *   GET  /api/v1/cache/bundle            → Full Top-20 + audio manifest in one call
 *   GET  /api/v1/cache/version           → Cache version string for update detection
 *
 * @module routes/cache.routes
 */

"use strict";

const express = require("express");
const router = express.Router();
const TOP_20 = require("../data/top20_fertilizers.json");

// ── Derive audio URL list from the Top-20 dataset ────────────────────────────
const LANGUAGES = ["sw", "en", "ki", "luo", "kal"];

function buildAudioManifest() {
  const urls = new Set();
  for (const profile of TOP_20) {
    for (const lang of LANGUAGES) {
      const audioPath = profile.audio_files?.[lang];
      if (audioPath) urls.add(audioPath);
    }
  }
  return Array.from(urls);
}

const CACHE_VERSION = "v1.0.0-2024-06-01";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/cache/version
// The service worker checks this on the "activate" event to know whether
// to purge old caches and download a fresh bundle.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/version", (req, res) => {
  res.json({
    cache_version: CACHE_VERSION,
    fertilizer_count: TOP_20.length,
    audio_file_count: buildAudioManifest().length,
    updated_at: "2024-06-01T00:00:00.000Z",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/cache/manifest
//
// Returns the full list of URLs the service worker should pre-cache.
// Includes:
//   - All audio files (per language)
//   - API endpoints that should be cached with a stale-while-revalidate strategy
//   - Logo image paths
//
// The service worker calls this during the INSTALL event.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/manifest", (req, res) => {
  const audioFiles = buildAudioManifest();

  // Logo paths
  const logoFiles = [...new Set(TOP_20.map((f) => f.logo_image_path))];

  // API endpoints to cache with network-first strategy
  const apiEndpoints = [
    "/api/v1/fertilizers/top20",
    "/api/v1/cache/version",
    "/api/v1/audio/manifest",
  ];

  res.json({
    cache_version: CACHE_VERSION,
    precache: {
      audio_files: audioFiles,
      logo_images: logoFiles,
      api_endpoints: apiEndpoints,
    },
    runtime_cache_strategies: {
      // Stale-while-revalidate: serve cache instantly, refresh in background
      stale_while_revalidate: ["/api/v1/fertilizers/search", "/api/v1/fertilizers/top20"],
      // Network-first: try network, fall back to cache
      network_first: ["/api/v1/fertilizers/scan", "/api/v1/escalation"],
      // Cache-first: always serve from cache (static assets)
      cache_first: audioFiles.concat(logoFiles),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/cache/bundle
//
// One-shot bundle: returns the Top-20 profiles + audio manifest in a single
// payload. Designed for the client to call once on first app launch (or
// when a cache update is detected) to minimise round trips.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/bundle", (req, res) => {
  res.json({
    success: true,
    cache_version: CACHE_VERSION,
    profiles: TOP_20,
    audio_manifest: buildAudioManifest(),
    logo_manifest: [...new Set(TOP_20.map((f) => f.logo_image_path))],
    // Bag color → profile ID index for the manual selection UI
    bag_color_index: buildBagColorIndex(),
    // Summary counts for the client to display
    summary: {
      total: TOP_20.length,
      red: TOP_20.filter((f) => f.risk_status === "RED").length,
      amber: TOP_20.filter((f) => f.risk_status === "AMBER").length,
      green: TOP_20.filter((f) => f.risk_status === "GREEN").length,
    },
  });
});

/**
 * Build an index: bag_color → [fertilizer_id, ...] for manual selection UI.
 */
function buildBagColorIndex() {
  const index = {};
  for (const profile of TOP_20) {
    for (const color of profile.bag_colors || []) {
      if (!index[color]) index[color] = [];
      index[color].push(profile.id);
    }
  }
  return index;
}

module.exports = router;
