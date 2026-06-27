/**
 * Sync Service — Offline Outbox Queue Processor
 *
 * This service runs as a background cron job.
 * It drains the Masumi outbox queue: for each pending escalation
 * packet, it attempts to:
 *  1. Forward the case to the Masumi agent network
 *  2. Write a confirmed record to Neo4j
 *  3. Mark the packet as synced
 *
 * Called from index.js on a timer (default 30 s).
 *
 * @module services/sync.service
 */

"use strict";

const logger = require("../middleware/logger");
const masumi = require("./masumi.service");
const neo4jService = require("./neo4j.service");

/**
 * Process all pending packets in the outbox queue.
 * @returns {Promise<{ processed: number, failed: number }>}
 */
async function runOutboxSync() {
  const pending = masumi.getPendingOutbox();

  if (!pending.length) {
    logger.debug("[SYNC] Outbox is empty — nothing to sync.");
    return { processed: 0, failed: 0 };
  }

  logger.info(`[SYNC] Processing ${pending.length} pending escalation(s)...`);

  let processed = 0;
  let failed = 0;

  for (const packet of pending) {
    try {
      // 1. Forward to Masumi network
      const forwarded = await masumi.forwardToMasumiNetwork(packet);

      if (forwarded) {
        // 2. Persist to Neo4j
        await neo4jService.createEscalationCase({
          case_id: packet.case_id,
          device_id: packet.device_id,
          batch_keywords: packet.ocr_tokens,
          gps_lat: packet.gps?.lat ?? null,
          gps_lng: packet.gps?.lng ?? null,
          image_b64: packet.image_b64 ? "[stored]" : null, // Don't persist full image to graph
          voice_b64: packet.voice_b64 ? "[stored]" : null,
          status: "PENDING",
        });

        // 3. Mark synced
        masumi.markSynced(packet.case_id);
        processed++;
        logger.info(`[SYNC] Case ${packet.case_id} synced ✓`);
      } else {
        failed++;
        logger.warn(`[SYNC] Case ${packet.case_id} could not be forwarded — will retry.`);
      }
    } catch (err) {
      failed++;
      logger.error(`[SYNC] Error processing case ${packet.case_id}: ${err.message}`);
    }
  }

  logger.info(`[SYNC] Complete — processed: ${processed}, failed: ${failed}`);
  return { processed, failed };
}

module.exports = { runOutboxSync };
