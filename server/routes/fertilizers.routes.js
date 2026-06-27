/**
 * Fertilizer Routes — /api/v1/fertilizers
 *
 * Endpoints for looking up fertilizer compliance profiles.
 * Integrates with Neo4j for live graph queries and falls back
 * to the local Top-20 JSON cache when offline.
 *
 * Routes:
 *   GET  /api/v1/fertilizers/top20        → Full offline cache payload
 *   GET  /api/v1/fertilizers/:id          → Single profile by ID
 *   POST /api/v1/fertilizers/scan         → OCR + NLP full scan pipeline
 *   POST /api/v1/fertilizers/manual       → Manual visual-selection lookup
 *   GET  /api/v1/fertilizers/search?q=    → Keyword search
 *
 * @module routes/fertilizers.routes
 */

"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { body, query, param, validationResult } = require("express-validator");

const router = express.Router();
const neo4j = require("../services/neo4j.service");
const masumi = require("../services/masumi.service");
const featherless = require("../services/featherless.service");
const TOP_20 = require("../data/top20_fertilizers.json");
const logger = require("../middleware/logger");

// ── Multer — handle image uploads for OCR ────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB max
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// ── Validation helper ────────────────────────────────────────────────────────
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/fertilizers/top20
// Returns the full Top-20 offline cache bundle.
// The client service worker downloads this during the install phase.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/top20", async (req, res, next) => {
  try {
    // Attempt live query from Neo4j first
    let profiles;
    try {
      profiles = await neo4j.getOfflineCacheProfiles();
      if (!profiles.length) throw new Error("Empty result — fall back to JSON");
    } catch {
      logger.warn("[FERTILIZERS] Neo4j unavailable — serving Top-20 from JSON cache");
      profiles = TOP_20;
    }

    res.json({
      success: true,
      count: profiles.length,
      cache_version: "2024-06-01", // Bump this whenever the dataset changes
      profiles,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/fertilizers/search?q=<term>
// Searches by brand name or batch keyword.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/search",
  [query("q").notEmpty().withMessage("Search term is required").isLength({ max: 100 })],
  validate,
  async (req, res, next) => {
    const { q } = req.query;
    try {
      let results;
      try {
        results = await neo4j.searchFertilizers(q);
      } catch {
        // Offline fallback: filter Top-20 in memory
        const upperQ = q.toUpperCase();
        results = TOP_20.filter(
          (f) =>
            f.brand_name.toUpperCase().includes(upperQ) ||
            f.batch_prefix_keywords.some((kw) => kw.includes(upperQ))
        );
      }

      res.json({ success: true, count: results.length, results });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/fertilizers/:id
// Fetch a single fertilizer profile by its unique ID.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:id",
  [param("id").notEmpty().isLength({ max: 60 })],
  validate,
  async (req, res, next) => {
    const { id } = req.params;
    try {
      let profile;
      try {
        profile = await neo4j.getFertilizerById(id);
      } catch {
        profile = TOP_20.find((f) => f.id === id) || null;
      }

      if (!profile) {
        return res.status(404).json({ success: false, error: "Fertilizer profile not found" });
      }

      res.json({ success: true, profile });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/fertilizers/scan
// Full scan pipeline:
//   1. Receive label image (multipart) or base64 (JSON)
//   2. Run Featherless OCR to extract tokens
//   3. Query Neo4j / cache for a match
//   4. Run Masumi triage on confidence
//   5. If DIRECT → return result + generate advisory
//   6. If ESCALATE → queue outbox packet, return AMBER state
//
// Body (multipart):
//   - image: File (label photo)
//   - lang: string (sw|en|ki|luo|kal)
//   - device_id: string
//   - gps_lat: float
//   - gps_lng: float
//   - is_offline: boolean
//
// OR Body (application/json):
//   - image_base64: string
//   - lang, device_id, gps_lat, gps_lng, is_offline
// ─────────────────────────────────────────────────────────────────────────────
router.post("/scan", upload.single("image"), async (req, res, next) => {
  try {
    const lang = req.body.lang || "sw";
    const device_id = req.body.device_id || "unknown";
    const gps = {
      lat: parseFloat(req.body.gps_lat) || null,
      lng: parseFloat(req.body.gps_lng) || null,
    };
    const is_offline = req.body.is_offline === "true" || req.body.is_offline === true;

    // ── Step 1: Extract image as base64 ─────────────────────────────────────
    let imageBase64 = null;
    let mimeType = "image/jpeg";

    if (req.file) {
      imageBase64 = req.file.buffer.toString("base64");
      mimeType = req.file.mimetype;
    } else if (req.body.image_base64) {
      imageBase64 = req.body.image_base64;
    }

    if (!imageBase64) {
      return res.status(400).json({ success: false, error: "No image provided (use multipart 'image' or JSON 'image_base64')" });
    }

    // ── Step 2: Featherless OCR ──────────────────────────────────────────────
    const ocr = await featherless.extractLabelText(imageBase64, mimeType);

    if (!ocr.success || ocr.tokens.length === 0) {
      // OCR failed entirely — trigger manual fallback signal
      return res.status(200).json({
        success: false,
        ocr_success: false,
        ocr_confidence: ocr.confidence,
        fallback_required: true,
        fallback_reason: "OCR_FAILED",
        message: "Could not read the label. Please use voice input or manual entry.",
        message_sw: "Haiwezekani kusoma lebo. Tafadhali sema jina au ingiza kwa mkono.",
        case_id: uuidv4(),
      });
    }

    // ── Step 3: Neo4j / Cache Lookup ─────────────────────────────────────────
    let neo4j_match = null;
    try {
      // Try each token as a search term and pick the best-scoring result
      for (const token of ocr.tokens) {
        const results = await neo4j.searchFertilizers(token);
        if (results.length > 0) {
          neo4j_match = results[0];
          break;
        }
      }
    } catch {
      logger.warn("[SCAN] Neo4j unavailable — checking local cache...");
      neo4j_match = masumi.matchFromLocalCache(ocr.tokens);
    }

    // ── Step 4: Masumi Triage ────────────────────────────────────────────────
    const triageResult = masumi.triage({ ocr_tokens: ocr.tokens, neo4j_match, is_offline });

    // ── Step 5A: HIGH/MEDIUM confidence → return direct result ───────────────
    if (triageResult.decision !== "ESCALATE") {
      const profile = triageResult.match;

      // Generate plain-language advisory
      const advisory = await featherless.generateAdvisory({
        risk_status: profile.risk_status,
        reason_en: profile.reason_en,
        brand_name: profile.brand_name,
        lang,
        safe_alternative: profile.safe_alternative_ids?.[0] || null,
      });

      // Point to pre-cached audio file (offline) or TTS URL (online)
      const audio_path = profile.audio_files?.[lang] || profile.audio_file_path;

      return res.json({
        success: true,
        ocr_success: true,
        ocr_confidence: ocr.confidence,
        triage: triageResult.decision,
        confidence: triageResult.confidence,
        profile,
        advisory_text: advisory.advisory_text,
        advisory_lang: lang,
        audio_path,
        safe_alternatives: profile.safe_alternative_ids || [],
        export_score_impact: profile.risk_status === "GREEN" ? +5 : profile.risk_status === "AMBER" ? 0 : -10,
      });
    }

    // ── Step 5B: LOW confidence → Masumi Escalation ──────────────────────────
    const case_id = uuidv4();
    const packet = masumi.buildEscalationPacket({
      case_id,
      device_id,
      ocr_tokens: ocr.tokens,
      image_b64: imageBase64,
      gps,
    });

    masumi.enqueueOutbox(packet);

    // Attempt immediate forward if online
    if (!is_offline) {
      masumi.forwardToMasumiNetwork(packet); // fire-and-forget
    }

    return res.status(202).json({
      success: true,
      ocr_success: true,
      ocr_confidence: ocr.confidence,
      triage: "ESCALATE",
      confidence: triageResult.confidence,
      case_id,
      status: "PENDING",
      ui_state: "AMBER",
      message: "We are verifying. Photo sent to experts.",
      message_sw: "Bado tunahakikisha. Picha imetumwa kwa wataalamu.",
      message_ki: "Tũratetheria. Picha nĩyatumwo kũrĩa ataalamu.",
      message_luo: "Wabatimba. Picha oherwa ni jowuon neno.",
      message_kal: "Komiten. Picha nyalunet yametwa ne mwalimu.",
      estimated_response_minutes: 30,
      queue_position: masumi.getPendingOutbox().length,
    });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/fertilizers/manual
// Manual visual-selection lookup for low-literacy farmers.
// The client presents a step-by-step visual selector (color → logo → batch)
// and sends the selections here for matching.
//
// Body (JSON):
//   - bag_color: string  (e.g. "white", "blue", "yellow")
//   - brand_id: string   (logo identifier selected by farmer)
//   - batch_number: string (optional — numbers typed on numeric keypad)
//   - lang: string
//   - device_id: string
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/manual",
  [
    body("bag_color").optional().isString(),
    body("brand_id").optional().isString(),
    body("batch_number").optional().isString(),
    body("lang").optional().isIn(Object.keys(featherless.SUPPORTED_LANGUAGES)),
    body("device_id").optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { bag_color, brand_id, batch_number, lang = "sw", device_id } = req.body;

      if (!bag_color && !brand_id && !batch_number) {
        return res.status(400).json({
          success: false,
          error: "At least one of bag_color, brand_id, or batch_number must be provided.",
        });
      }

      // Build a search term from available selections
      const searchTerms = [brand_id, batch_number].filter(Boolean);
      let candidates = [];

      // Filter by bag_color first (cheap in-memory filter)
      let pool = bag_color
        ? TOP_20.filter((f) => f.bag_colors.includes(bag_color.toLowerCase()))
        : TOP_20;

      // Then score by brand/batch terms
      for (const term of searchTerms) {
        const upperTerm = term.toUpperCase();
        const matches = pool.filter(
          (f) =>
            f.brand_name.toUpperCase().includes(upperTerm) ||
            f.batch_prefix_keywords.some((kw) => kw.includes(upperTerm))
        );
        candidates.push(...matches);
      }

      // Deduplicate
      const seen = new Set();
      candidates = candidates.filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

      // If no matches → trigger escalation
      if (!candidates.length) {
        const case_id = uuidv4();
        const packet = masumi.buildEscalationPacket({
          case_id,
          device_id: device_id || "unknown",
          ocr_tokens: searchTerms,
          manual_batch: batch_number || null,
        });
        masumi.enqueueOutbox(packet);

        return res.status(202).json({
          success: false,
          triage: "ESCALATE",
          case_id,
          status: "PENDING",
          ui_state: "AMBER",
          message: "We could not identify this fertilizer. A Kilimo Trust expert will review it.",
          message_sw: "Hatujapata mbolea hii. Mtaalamu wa Kilimo Trust ataangalia.",
        });
      }

      // Return best match (first candidate)
      const profile = candidates[0];
      const advisory = await featherless.generateAdvisory({
        risk_status: profile.risk_status,
        reason_en: profile.reason_en,
        brand_name: profile.brand_name,
        lang,
      });

      res.json({
        success: true,
        match_count: candidates.length,
        profile,
        other_candidates: candidates.slice(1, 4),
        advisory_text: advisory.advisory_text,
        audio_path: profile.audio_files?.[lang] || profile.audio_file_path,
        export_score_impact: profile.risk_status === "GREEN" ? +5 : profile.risk_status === "AMBER" ? 0 : -10,
      });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
