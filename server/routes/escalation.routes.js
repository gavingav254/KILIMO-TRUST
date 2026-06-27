/**
 * Escalation Routes — /api/v1/escalation
 *
 * Manages the Masumi agent escalation protocol for unknown fertilizer batches.
 * Handles farmer-submitted packets (offline queue), status polling,
 * and resolution notification delivery.
 *
 * Routes:
 *   POST /api/v1/escalation/submit      → Submit an escalation packet (online/offline)
 *   GET  /api/v1/escalation/:case_id    → Poll status of a specific case
 *   GET  /api/v1/escalation/            → List all cases (for demo/debug)
 *   POST /api/v1/escalation/sync        → Trigger outbox sync manually
 *
 * @module routes/escalation.routes
 */

"use strict";

const express = require("express");
const multer = require("multer");
const { v4: uuidv4 } = require("uuid");
const { body, param, validationResult } = require("express-validator");

const router = express.Router();
const masumi = require("../services/masumi.service");
const syncService = require("../services/sync.service");
const logger = require("../middleware/logger");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escalation/submit
//
// Called by the client when:
//  a) Masumi triage returns "ESCALATE"
//  b) The device was offline and is now syncing the outbox
//
// Accepts multipart (with image/voice files) or JSON (base64 encoded).
//
// The endpoint is idempotent: submitting the same case_id twice is safe.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/submit",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "voice", maxCount: 1 },
  ]),
  [
    body("device_id").notEmpty().withMessage("device_id is required"),
    body("ocr_tokens").optional(),
    body("manual_batch").optional().isString(),
    body("gps_lat").optional().isFloat({ min: -90, max: 90 }),
    body("gps_lng").optional().isFloat({ min: -180, max: 180 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const case_id = req.body.case_id || uuidv4();

      // Idempotency check
      if (masumi.getPacket(case_id)) {
        const existing = masumi.getPacket(case_id);
        return res.status(200).json({
          success: true,
          case_id,
          status: existing.status,
          message: "Case already queued — no duplicate created.",
        });
      }

      // Parse tokens
      let ocr_tokens = [];
      if (req.body.ocr_tokens) {
        try {
          ocr_tokens = typeof req.body.ocr_tokens === "string"
            ? JSON.parse(req.body.ocr_tokens)
            : req.body.ocr_tokens;
        } catch {
          ocr_tokens = req.body.ocr_tokens ? [req.body.ocr_tokens] : [];
        }
      }

      // Handle image
      let image_b64 = req.body.image_base64 || null;
      if (req.files?.image?.[0]) {
        image_b64 = req.files.image[0].buffer.toString("base64");
      }

      // Handle voice
      let voice_b64 = req.body.voice_base64 || null;
      if (req.files?.voice?.[0]) {
        voice_b64 = req.files.voice[0].buffer.toString("base64");
      }

      const packet = masumi.buildEscalationPacket({
        case_id,
        device_id: req.body.device_id,
        ocr_tokens,
        manual_batch: req.body.manual_batch || null,
        image_b64,
        voice_b64,
        gps: {
          lat: parseFloat(req.body.gps_lat) || null,
          lng: parseFloat(req.body.gps_lng) || null,
        },
      });

      masumi.enqueueOutbox(packet);
      logger.info(`[ESCALATION] New case queued: ${case_id}`);

      // Attempt immediate forward
      const forwarded = await masumi.forwardToMasumiNetwork(packet);
      if (forwarded) masumi.markSynced(case_id);

      res.status(202).json({
        success: true,
        case_id,
        status: "PENDING",
        ui_state: "AMBER",
        synced_to_cloud: forwarded,
        message: "Case submitted. A Kilimo Trust expert will review and respond.",
        message_sw: "Ombi limepokelewa. Mtaalamu atakiangalia hivi karibuni.",
        estimated_response_minutes: 30,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/escalation/:case_id
//
// Used by the client to poll for a resolution after submitting an escalation.
// The client should poll every 60 seconds until status is "RESOLVED".
//
// Returns the full packet including expert_verdict and expert_notes once resolved.
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/:case_id",
  [param("case_id").isUUID().withMessage("case_id must be a valid UUID")],
  validate,
  (req, res) => {
    const { case_id } = req.params;
    const packet = masumi.getPacket(case_id);

    if (!packet) {
      return res.status(404).json({ success: false, error: "Case not found" });
    }

    // Strip large payloads before returning to client
    const { image_b64, voice_b64, ...safePacket } = packet;

    const ui_state =
      packet.status === "RESOLVED"
        ? packet.expert_verdict === "SAFE" ? "GREEN" : "RED"
        : "AMBER";

    res.json({
      success: true,
      ui_state,
      ...safePacket,
    });
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/escalation
// List all cases in the outbox queue (useful for demo / expert dashboard).
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const { status } = req.query;
  let cases = Array.from(masumi.outboxQueue.values());

  if (status) {
    cases = cases.filter((c) => c.status === status.toUpperCase());
  }

  // Strip blobs for the list view
  const safeCases = cases.map(({ image_b64, voice_b64, ...rest }) => rest);

  res.json({ success: true, count: safeCases.length, cases: safeCases });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/escalation/sync
// Manually trigger the outbox sync job (useful for testing or client "retry" button).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/sync", async (req, res, next) => {
  try {
    const result = await syncService.runOutboxSync();
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
