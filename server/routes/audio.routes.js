/**
 * Audio Routes — /api/v1/audio
 *
 * Serves metadata about pre-rendered audio files.
 * The actual .mp3 files are served as static assets from /audio/*
 * (see index.js express.static middleware).
 *
 * Routes:
 *   GET /api/v1/audio/manifest           → Full list of available audio files
 *   GET /api/v1/audio/manifest/:lang     → Audio files for a specific language
 *
 * The service worker downloads all files in this manifest during the INSTALL
 * phase to enable fully offline voice advisory playback.
 *
 * @module routes/audio.routes
 */

"use strict";

const express = require("express");
const router = express.Router();
const TOP_20 = require("../data/top20_fertilizers.json");

const LANGUAGES = ["sw", "en", "ki", "luo", "kal"];
const LANGUAGE_NAMES = {
  sw: "Swahili",
  en: "English",
  ki: "Kikuyu",
  luo: "Dholuo",
  kal: "Kalenjin",
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/audio/manifest
// Complete audio file manifest across all languages and risk levels.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/manifest", (req, res) => {
  const manifest = {};

  for (const lang of LANGUAGES) {
    manifest[lang] = {
      language: LANGUAGE_NAMES[lang],
      files: [],
    };

    for (const profile of TOP_20) {
      const path = profile.audio_files?.[lang];
      if (path) {
        manifest[lang].files.push({
          fertilizer_id: profile.id,
          brand_name: profile.brand_name,
          risk_status: profile.risk_status,
          path,
          // Client constructs full URL: window.location.origin + path
        });
      }
    }
  }

  // Generic fallback audio files (when no specific match is found offline)
  const genericFiles = LANGUAGES.flatMap((lang) => [
    { purpose: "generic_safe", lang, path: `/audio/${lang}/generic_safe_${lang}.mp3` },
    { purpose: "generic_danger", lang, path: `/audio/${lang}/generic_danger_${lang}.mp3` },
    { purpose: "generic_caution", lang, path: `/audio/${lang}/generic_caution_${lang}.mp3` },
    { purpose: "escalation_sent", lang, path: `/audio/${lang}/escalation_sent_${lang}.mp3` },
    { purpose: "ocr_failed", lang, path: `/audio/${lang}/ocr_failed_${lang}.mp3` },
  ]);

  res.json({
    success: true,
    total_files:
      Object.values(manifest).reduce((sum, l) => sum + l.files.length, 0) + genericFiles.length,
    per_language: manifest,
    generic_files: genericFiles,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/audio/manifest/:lang
// Audio file manifest for a single language.
// Useful for a farmer who selects their language on first launch —
// the app only downloads audio for their language to save bandwidth.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/manifest/:lang", (req, res) => {
  const { lang } = req.params;

  if (!LANGUAGES.includes(lang)) {
    return res.status(400).json({
      error: `Unsupported language '${lang}'. Supported: ${LANGUAGES.join(", ")}`,
    });
  }

  const files = TOP_20.filter((p) => p.audio_files?.[lang]).map((p) => ({
    fertilizer_id: p.id,
    brand_name: p.brand_name,
    risk_status: p.risk_status,
    path: p.audio_files[lang],
  }));

  const genericFiles = [
    { purpose: "generic_safe", path: `/audio/${lang}/generic_safe_${lang}.mp3` },
    { purpose: "generic_danger", path: `/audio/${lang}/generic_danger_${lang}.mp3` },
    { purpose: "generic_caution", path: `/audio/${lang}/generic_caution_${lang}.mp3` },
    { purpose: "escalation_sent", path: `/audio/${lang}/escalation_sent_${lang}.mp3` },
    { purpose: "ocr_failed", path: `/audio/${lang}/ocr_failed_${lang}.mp3` },
  ];

  res.json({
    success: true,
    lang,
    language_name: LANGUAGE_NAMES[lang],
    fertilizer_audio_count: files.length,
    generic_audio_count: genericFiles.length,
    fertilizer_files: files,
    generic_files: genericFiles,
  });
});

module.exports = router;
