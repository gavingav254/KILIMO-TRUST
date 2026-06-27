/**
 * Sync Routes — /api/v1/sync
 *
 * Used by the client's Background Sync API to drain the local outbox
 * when connectivity is restored. Also provides a connectivity check endpoint.
 *
 * Routes:
 *   GET  /api/v1/sync/ping          → Connectivity check (client uses this to detect online)
 *   POST /api/v1/sync/outbox        → Client pushes its local outbox for server-side processing
 *   GET  /api/v1/sync/status        → Current outbox queue summary
 *
 * @module routes/sync.routes
 */

"use strict";

const express = require("express");
const { body, validationResult } = require("express-validator");
const router = express.Router();

const masumi = require("../services/masumi.service");
const syncService = require("../services/sync.service");
const { v4: uuidv4 } = require("uuid");

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sync/ping
//
// Ultra-lightweight endpoint. The client calls this to confirm it has
// internet access before attempting a real API call.
// The service worker uses this URL as its "online check" in the Background Sync.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/ping", (req, res) => {
  res.status(200).json({ online: true, ts: Date.now() });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/sync/outbox
//
// The client's service worker pushes all locally-queued outbox items here
// when the Background Sync event fires (connectivity restored).
//
// Body:
//   - items: Array of EscalationPacket objects (same structure as masumi.buildEscalationPacket)
//   - device_id: string
//
// Server merges each item into the server outbox, avoiding duplicates,
// then immediately attempts to forward them to the Masumi network.
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/outbox",
  [
    body("items").isArray({ min: 1 }).withMessage("items must be a non-empty array"),
    body("device_id").notEmpty().withMessage("device_id is required"),
  ],
  validate,
  async (req, res, next) => {
    try {
      const { items, device_id } = req.body;
      const results = { accepted: 0, duplicate: 0, failed: 0, details: [] };

      for (const item of items) {
        const case_id = item.case_id || uuidv4();

        // Idempotency — skip if already queued
        if (masumi.getPacket(case_id)) {
          results.duplicate++;
          results.details.push({ case_id, status: "duplicate" });
          continue;
        }

        try {
          const packet = masumi.buildEscalationPacket({ ...item, case_id, device_id });
          masumi.enqueueOutbox(packet);
          results.accepted++;
          results.details.push({ case_id, status: "accepted" });
        } catch (e) {
          results.failed++;
          results.details.push({ case_id, status: "failed", error: e.message });
        }
      }

      // Trigger sync job immediately
      const syncResult = await syncService.runOutboxSync();

      res.json({
        success: true,
        sync_result: syncResult,
        ...results,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/sync/status
// Returns a summary of the current server-side outbox queue state.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/status", (req, res) => {
  const all = Array.from(masumi.outboxQueue.values());

  res.json({
    success: true,
    queue: {
      total: all.length,
      pending: all.filter((c) => !c.synced && c.status === "PENDING").length,
      synced: all.filter((c) => c.synced).length,
      resolved: all.filter((c) => c.status === "RESOLVED").length,
    },
  });
});

module.exports = router;
