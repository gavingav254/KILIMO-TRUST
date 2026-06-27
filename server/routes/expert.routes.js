/**
 * Expert Dashboard Routes — /api/v1/expert
 *
 * Server-side API for the Kilimo Trust Expert Dashboard.
 * Experts log in, view pending escalation cases, and submit verdicts.
 *
 * The "Expert Review" is a SIMULATION for the prototype:
 *   - No real auth provider is integrated yet
 *   - Verdicts update the in-memory queue and Neo4j simultaneously
 *   - Clients polling /api/v1/escalation/:case_id will see the resolution
 *
 * Routes:
 *   GET  /api/v1/expert/cases               → All pending cases (Expert view)
 *   GET  /api/v1/expert/cases/:case_id      → Full case detail (with image)
 *   POST /api/v1/expert/cases/:case_id/resolve → Submit verdict
 *   GET  /api/v1/expert/stats               → Dashboard summary stats
 *
 * @module routes/expert.routes
 */

"use strict";

const express = require("express");
const { param, body, validationResult } = require("express-validator");
const router = express.Router();

const masumi = require("../services/masumi.service");
const neo4j = require("../services/neo4j.service");
const logger = require("../middleware/logger");

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ── Simple prototype token guard ─────────────────────────────────────────────
// Replace with JWT middleware in production.
function expertGuard(req, res, next) {
  const token = req.headers["authorization"]?.replace("Bearer ", "");
  if (token !== process.env.EXPERT_DASHBOARD_TOKEN && process.env.NODE_ENV === "production") {
    return res.status(401).json({ error: "Unauthorized — Expert access required." });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/expert/cases
// Returns all pending/in-review cases for the expert dashboard.
// Strips large blobs from the list view for performance.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/cases", expertGuard, (req, res) => {
  const { status = "PENDING" } = req.query;
  const allCases = Array.from(masumi.outboxQueue.values());

  const filtered = allCases
    .filter((c) => (status === "ALL" ? true : c.status === status.toUpperCase()))
    .map(({ image_b64, voice_b64, ...rest }) => ({
      ...rest,
      has_image: !!image_b64,
      has_voice: !!voice_b64,
    }));

  res.json({
    success: true,
    count: filtered.length,
    cases: filtered,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/expert/cases/:case_id
// Full case detail including the label image (as base64) for expert review.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/cases/:case_id",
  expertGuard,
  [param("case_id").isUUID()],
  validate,
  (req, res) => {
    const packet = masumi.getPacket(req.params.case_id);

    if (!packet) {
      return res.status(404).json({ success: false, error: "Case not found" });
    }

    res.json({
      success: true,
      case: {
        ...packet,
        image_data_url: packet.image_b64
          ? `data:image/jpeg;base64,${packet.image_b64}`
          : null,
        voice_data_url: packet.voice_b64
          ? `data:audio/webm;base64,${packet.voice_b64}`
          : null,
      },
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/expert/cases/:case_id/resolve
//
// An expert submits their verdict on an escalated case.
// This:
//   1. Updates the in-memory outbox (for client polling)
//   2. Writes the resolution to Neo4j
//   3. Returns the updated case for UI confirmation
//
// Body:
//   - verdict: "SAFE" | "UNSAFE" | "NEEDS_MORE_INFO"
//   - notes: string — expert reasoning (shown to farmer in plain language)
//   - safe_alternative_id: string (optional — recommend an alternative)
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/cases/:case_id/resolve",
  expertGuard,
  [
    param("case_id").isUUID(),
    body("verdict")
      .isIn(["SAFE", "UNSAFE", "NEEDS_MORE_INFO"])
      .withMessage("verdict must be SAFE, UNSAFE, or NEEDS_MORE_INFO"),
    body("notes").notEmpty().withMessage("Expert notes are required").isLength({ max: 1000 }),
    body("safe_alternative_id").optional().isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { case_id } = req.params;
      const { verdict, notes, safe_alternative_id } = req.body;

      const packet = masumi.getPacket(case_id);
      if (!packet) {
        return res.status(404).json({ success: false, error: "Case not found" });
      }

      if (packet.status === "RESOLVED") {
        return res.status(409).json({
          success: false,
          error: "Case already resolved.",
          resolved_at: packet.resolved_at,
          verdict: packet.expert_verdict,
        });
      }

      // 1. Update in-memory outbox
      masumi.resolveInOutbox(case_id, verdict, notes);

      // 2. Persist resolution to Neo4j
      try {
        await neo4j.resolveEscalationCase(case_id, verdict, notes);
      } catch (neo4jErr) {
        logger.warn(`[EXPERT] Neo4j write failed for case ${case_id}: ${neo4jErr.message}`);
        // Non-fatal — in-memory resolution is enough for the prototype
      }

      const resolvedPacket = masumi.getPacket(case_id);
      const ui_state = verdict === "SAFE" ? "GREEN" : verdict === "UNSAFE" ? "RED" : "AMBER";

      logger.info(`[EXPERT] Case ${case_id} resolved as ${verdict}`);

      res.json({
        success: true,
        case_id,
        verdict,
        ui_state,
        notes,
        safe_alternative_id: safe_alternative_id || null,
        resolved_at: resolvedPacket.resolved_at,
        // This payload is sent to the farmer's device via polling or push notification
        farmer_notification: {
          ui_state,
          message_en: verdict === "SAFE"
            ? `Your fertilizer has been verified as SAFE by a Kilimo Trust agronomist.`
            : verdict === "UNSAFE"
            ? `ALERT: Your fertilizer has been flagged as UNSAFE for EU export crops. ${notes}`
            : `More information needed. A Kilimo Trust expert will contact you.`,
          message_sw: verdict === "SAFE"
            ? `Mbolea yako imethibitishwa kuwa SALAMA na mtaalamu wa Kilimo Trust.`
            : verdict === "UNSAFE"
            ? `TAHADHARI: Mbolea yako ina hatari kwa mazao ya EU. ${notes}`
            : `Tunahitaji maelezo zaidi. Mtaalamu atawasiliana nawe.`,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/expert/stats
// Summary statistics for the Expert Dashboard header.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/stats", expertGuard, (req, res) => {
  const all = Array.from(masumi.outboxQueue.values());

  const stats = {
    total: all.length,
    pending: all.filter((c) => c.status === "PENDING").length,
    resolved: all.filter((c) => c.status === "RESOLVED").length,
    safe_verdicts: all.filter((c) => c.expert_verdict === "SAFE").length,
    unsafe_verdicts: all.filter((c) => c.expert_verdict === "UNSAFE").length,
    needs_more_info: all.filter((c) => c.expert_verdict === "NEEDS_MORE_INFO").length,
    oldest_pending: all
      .filter((c) => c.status === "PENDING")
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0]?.created_at || null,
  };

  res.json({ success: true, stats });
});

module.exports = router;
