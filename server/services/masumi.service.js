/**
 * Masumi Agent Service — Escalation Orchestration
 *
 * Masumi acts as the orchestrator for uncertain fertilizer scans.
 * This service encapsulates:
 *
 *  1. Confidence scoring — decides whether the local Neo4j result is
 *     conclusive enough to return directly, or needs human review.
 *  2. Escalation packet building — assembles the structured payload
 *     (image, voice, GPS, batch keywords) to be saved to the queue.
 *  3. Masumi API forwarding — when online, sends the packet to the
 *     Masumi network agent for routing to a human expert.
 *  4. Notification — sends the resolution back to the farmer device.
 *
 * Confidence Thresholds (configurable):
 *   >= 0.80 → HIGH confidence  → return result directly (GREEN or RED)
 *   0.50–0.79 → MEDIUM         → return result but flag for monitoring
 *   < 0.50  → LOW confidence   → escalate to human expert
 *
 * @module services/masumi.service
 */

"use strict";

const logger = require("../middleware/logger");
const TOP_20 = require("../data/top20_fertilizers.json");

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.80,
  MEDIUM: 0.50,
};

// ── In-memory Outbox Queue (persisted to disk in production) ─────────────────
// In a production system, replace this with a Redis queue or SQLite-backed store.
// The outbox stores cases captured while the device/server is offline.
const outboxQueue = new Map(); // case_id → EscalationPacket

/**
 * Score the confidence of a fertilizer match against extracted OCR tokens.
 *
 * Algorithm:
 *  - Each keyword match between OCR tokens and known batch_prefix_keywords
 *    contributes to the score.
 *  - Exact brand name match gives full weight.
 *  - Partial / substring match gives half weight.
 *
 * @param {string[]} ocrTokens     - Tokens extracted by Featherless OCR
 * @param {object}   profile       - FertilizerProfile from Neo4j or Top-20 cache
 * @returns {number}               - Confidence score 0.0 → 1.0
 */
function scoreConfidence(ocrTokens, profile) {
  if (!ocrTokens || !ocrTokens.length || !profile) return 0;

  const upperTokens = ocrTokens.map((t) => t.toUpperCase());
  const keywords = (profile.batch_prefix_keywords || []).map((k) => k.toUpperCase());
  const brandWords = (profile.brand_name || "").toUpperCase().split(/\s+/);

  let hits = 0;
  let possible = keywords.length + brandWords.length;

  keywords.forEach((kw) => {
    if (upperTokens.some((t) => t === kw)) hits += 1;           // exact
    else if (upperTokens.some((t) => t.includes(kw))) hits += 0.5; // partial
  });

  brandWords.forEach((bw) => {
    if (upperTokens.some((t) => t === bw)) hits += 1;
    else if (upperTokens.some((t) => t.includes(bw))) hits += 0.5;
  });

  return possible > 0 ? Math.min(hits / possible, 1.0) : 0;
}

/**
 * Determine the triage outcome for a given match result.
 *
 * @param {number} confidence  - 0.0 → 1.0
 * @returns {"HIGH"|"MEDIUM"|"LOW"}
 */
function triageConfidence(confidence) {
  if (confidence >= CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

/**
 * Run the full Masumi triage decision for a scan request.
 *
 * @param {object} scanData
 * @param {string[]} scanData.ocr_tokens    - Raw OCR tokens from Featherless
 * @param {object|null} scanData.neo4j_match - Best Neo4j match (or null)
 * @param {boolean} scanData.is_offline     - Whether the device is offline
 *
 * @returns {object} Triage result:
 *   { decision: "DIRECT"|"MONITOR"|"ESCALATE", confidence, match, triage_level }
 */
function triage(scanData) {
  const { ocr_tokens = [], neo4j_match = null, is_offline = false } = scanData;

  // If Neo4j (or cache) gave us a match, score it
  if (neo4j_match) {
    const confidence = scoreConfidence(ocr_tokens, neo4j_match);
    const triage_level = triageConfidence(confidence);

    if (triage_level === "HIGH") {
      return { decision: "DIRECT", confidence, match: neo4j_match, triage_level };
    }
    if (triage_level === "MEDIUM") {
      return { decision: "MONITOR", confidence, match: neo4j_match, triage_level };
    }
  }

  // No match or low confidence → escalate
  return {
    decision: "ESCALATE",
    confidence: neo4j_match ? scoreConfidence(ocr_tokens, neo4j_match) : 0,
    match: null,
    triage_level: "LOW",
    is_offline,
  };
}

/**
 * Build an escalation packet from raw scan inputs.
 * This packet is stored locally (outbox) until connectivity is restored.
 *
 * @param {object} input
 * @param {string}   input.case_id         - UUID
 * @param {string}   input.device_id       - Farmer device fingerprint
 * @param {string[]} input.ocr_tokens      - OCR tokens extracted
 * @param {string}   [input.image_b64]     - Base64 label photo
 * @param {string}   [input.voice_b64]     - Base64 voice recording
 * @param {object}   [input.gps]           - { lat, lng }
 * @param {string}   [input.manual_batch]  - Manually typed batch number
 * @returns {object} EscalationPacket
 */
function buildEscalationPacket(input) {
  return {
    case_id: input.case_id,
    device_id: input.device_id,
    ocr_tokens: input.ocr_tokens || [],
    manual_batch: input.manual_batch || null,
    image_b64: input.image_b64 || null,
    voice_b64: input.voice_b64 || null,
    gps: input.gps || { lat: null, lng: null },
    status: "PENDING",
    created_at: new Date().toISOString(),
    resolved_at: null,
    expert_verdict: null,
    expert_notes: null,
    synced: false,
  };
}

/**
 * Add an escalation packet to the in-memory outbox queue.
 * @param {object} packet - Built by buildEscalationPacket()
 */
function enqueueOutbox(packet) {
  outboxQueue.set(packet.case_id, packet);
  logger.info(`[MASUMI] Enqueued case ${packet.case_id} to outbox (total: ${outboxQueue.size})`);
}

/**
 * Retrieve all pending (un-synced) packets from the outbox.
 * @returns {object[]}
 */
function getPendingOutbox() {
  return Array.from(outboxQueue.values()).filter((p) => !p.synced);
}

/**
 * Mark a packet as synced (removes it from the pending queue).
 * @param {string} caseId
 */
function markSynced(caseId) {
  const packet = outboxQueue.get(caseId);
  if (packet) {
    packet.synced = true;
    packet.synced_at = new Date().toISOString();
    outboxQueue.set(caseId, packet);
  }
}

/**
 * Apply an expert resolution to a queued packet.
 * @param {string} caseId
 * @param {"SAFE"|"UNSAFE"|"NEEDS_MORE_INFO"} verdict
 * @param {string} notes
 */
function resolveInOutbox(caseId, verdict, notes) {
  const packet = outboxQueue.get(caseId);
  if (packet) {
    packet.status = "RESOLVED";
    packet.expert_verdict = verdict;
    packet.expert_notes = notes;
    packet.resolved_at = new Date().toISOString();
    outboxQueue.set(caseId, packet);
  }
}

/**
 * Get a single packet by case_id.
 * @param {string} caseId
 * @returns {object|undefined}
 */
function getPacket(caseId) {
  return outboxQueue.get(caseId);
}

/**
 * Forward a packet to the live Masumi agent network.
 * Falls back gracefully if the Masumi API is unreachable.
 *
 * @param {object} packet
 * @returns {Promise<boolean>} true if forwarded successfully
 */
async function forwardToMasumiNetwork(packet) {
  const endpoint = process.env.MASUMI_ENDPOINT;
  const apiKey = process.env.MASUMI_API_KEY;

  if (!endpoint || !apiKey) {
    logger.warn("[MASUMI] No Masumi credentials — skipping network forward.");
    return false;
  }

  try {
    const res = await fetch(`${endpoint}/escalations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        case_id: packet.case_id,
        device_id: packet.device_id,
        ocr_tokens: packet.ocr_tokens,
        manual_batch: packet.manual_batch,
        gps: packet.gps,
        image_available: !!packet.image_b64,
        voice_available: !!packet.voice_b64,
        created_at: packet.created_at,
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (res.ok) {
      logger.info(`[MASUMI] Case ${packet.case_id} forwarded to Masumi network ✓`);
      return true;
    }

    logger.warn(`[MASUMI] Masumi network returned ${res.status} for case ${packet.case_id}`);
    return false;
  } catch (err) {
    logger.warn(`[MASUMI] Network forward failed for case ${packet.case_id}: ${err.message}`);
    return false;
  }
}

/**
 * Try to find a match for OCR tokens within the local Top-20 cache.
 * Used as a fallback when Neo4j is unreachable (offline server scenario).
 *
 * @param {string[]} ocrTokens
 * @returns {object|null} Matched Top-20 profile or null
 */
function matchFromLocalCache(ocrTokens) {
  const upperTokens = ocrTokens.map((t) => t.toUpperCase());
  let bestMatch = null;
  let bestScore = 0;

  for (const profile of TOP_20) {
    const score = scoreConfidence(upperTokens, profile);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = profile;
    }
  }

  return bestScore >= CONFIDENCE_THRESHOLDS.MEDIUM ? bestMatch : null;
}

module.exports = {
  triage,
  scoreConfidence,
  triageConfidence,
  buildEscalationPacket,
  enqueueOutbox,
  getPendingOutbox,
  markSynced,
  resolveInOutbox,
  getPacket,
  forwardToMasumiNetwork,
  matchFromLocalCache,
  outboxQueue,
  CONFIDENCE_THRESHOLDS,
};
