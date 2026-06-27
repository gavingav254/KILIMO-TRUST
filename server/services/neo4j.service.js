/**
 * Neo4j Service — Knowledge Graph Connection & Query Helpers
 *
 * This service manages the Neo4j driver lifecycle and exposes
 * typed query helpers used by the fertilizer and escalation routes.
 *
 * Graph Schema (relevant nodes & relationships):
 *
 *   (:Substance {name, cadmium_ppm, phosphonate, heavy_metals})
 *       -[:FOUND_IN]->
 *   (:FertilizerProfile {id, brand_name, risk_status, batch_prefix_keywords[]})
 *       -[:REGULATED_BY]->
 *   (:EU_Regulation {code, name, cadmium_limit_ppm, effective_date})
 *       -[:PRESCRIBES]->
 *   (:RiskLevel {level: GREEN|AMBER|RED, reason_en, reason_sw})
 *
 *   (:FertilizerProfile)-[:HAS_SAFE_ALTERNATIVE]->(:FertilizerProfile)
 *
 * @module services/neo4j.service
 */

"use strict";

const neo4j = require("neo4j-driver");
const logger = require("../middleware/logger");

let driver;

/**
 * Initialise the Neo4j driver and verify the connection.
 * Called once at server startup.
 */
async function connectNeo4j() {
  driver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
    {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 10_000, // 10 s
      logging: neo4j.logging.console("warn"),
    }
  );

  await driver.verifyConnectivity();
  return driver;
}

/**
 * Return the shared driver instance.
 * @throws {Error} if called before connectNeo4j()
 */
function getDriver() {
  if (!driver) throw new Error("Neo4j driver not initialised. Call connectNeo4j() first.");
  return driver;
}

/**
 * Run a read-only Cypher query.
 * @param {string} cypher - Cypher query string
 * @param {object} params  - Named parameters for the query
 * @returns {Promise<import('neo4j-driver').Record[]>}
 */
async function readQuery(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Run a write Cypher query (CREATE / MERGE / SET).
 * @param {string} cypher
 * @param {object} params
 * @returns {Promise<import('neo4j-driver').Record[]>}
 */
async function writeQuery(cypher, params = {}) {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-Specific Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a fertilizer profile by its unique ID.
 * @param {string} id - e.g. "yaramila_chukua_01"
 * @returns {Promise<object|null>} FertilizerProfile node properties or null
 */
async function getFertilizerById(id) {
  const records = await readQuery(
    `MATCH (f:FertilizerProfile {id: $id})
     OPTIONAL MATCH (f)-[:HAS_SAFE_ALTERNATIVE]->(alt:FertilizerProfile)
     RETURN f, collect(alt.id) AS alternatives`,
    { id }
  );
  if (!records.length) return null;
  return {
    ...records[0].get("f").properties,
    safe_alternatives: records[0].get("alternatives"),
  };
}

/**
 * Fuzzy-search fertilizer profiles by brand name or batch keyword.
 * Uses Neo4j full-text index if available, otherwise falls back to CONTAINS.
 * @param {string} term - Free-text search term from OCR or voice
 * @returns {Promise<object[]>}
 */
async function searchFertilizers(term) {
  const records = await readQuery(
    `MATCH (f:FertilizerProfile)
     WHERE toLower(f.brand_name) CONTAINS toLower($term)
        OR ANY(kw IN f.batch_prefix_keywords WHERE toLower(kw) CONTAINS toLower($term))
     RETURN f
     ORDER BY
       CASE f.risk_status WHEN 'RED' THEN 0 WHEN 'AMBER' THEN 1 ELSE 2 END
     LIMIT 10`,
    { term }
  );
  return records.map((r) => r.get("f").properties);
}

/**
 * Retrieve all 20 profiles in the offline cache set.
 * These are pre-tagged with is_offline_cached: true in the graph.
 * @returns {Promise<object[]>}
 */
async function getOfflineCacheProfiles() {
  const records = await readQuery(
    `MATCH (f:FertilizerProfile {is_offline_cached: true})
     OPTIONAL MATCH (f)-[:HAS_SAFE_ALTERNATIVE]->(alt:FertilizerProfile)
     RETURN f, collect(alt.id) AS alternatives
     ORDER BY f.brand_name`
  );
  return records.map((r) => ({
    ...r.get("f").properties,
    safe_alternatives: r.get("alternatives"),
  }));
}

/**
 * Persist a new escalation case node in the graph.
 * @param {object} caseData - { case_id, device_id, batch_keywords, gps, image_b64, voice_b64, status }
 */
async function createEscalationCase(caseData) {
  await writeQuery(
    `CREATE (c:EscalationCase {
       case_id:          $case_id,
       device_id:        $device_id,
       batch_keywords:   $batch_keywords,
       gps_lat:          $gps_lat,
       gps_lng:          $gps_lng,
       image_b64:        $image_b64,
       voice_b64:        $voice_b64,
       status:           $status,
       created_at:       datetime(),
       resolved_at:      null,
       expert_verdict:   null,
       expert_notes:     null
     })`,
    caseData
  );
}

/**
 * Update an escalation case with an expert verdict.
 * @param {string} caseId
 * @param {"SAFE"|"UNSAFE"|"NEEDS_MORE_INFO"} verdict
 * @param {string} notes
 */
async function resolveEscalationCase(caseId, verdict, notes) {
  await writeQuery(
    `MATCH (c:EscalationCase {case_id: $caseId})
     SET c.status       = 'RESOLVED',
         c.expert_verdict = $verdict,
         c.expert_notes   = $notes,
         c.resolved_at    = datetime()`,
    { caseId, verdict, notes }
  );
}

/**
 * Get all escalation cases, optionally filtered by status.
 * @param {"PENDING"|"IN_REVIEW"|"RESOLVED"|null} status
 * @returns {Promise<object[]>}
 */
async function getEscalationCases(status = null) {
  const cypher = status
    ? `MATCH (c:EscalationCase {status: $status}) RETURN c ORDER BY c.created_at DESC`
    : `MATCH (c:EscalationCase) RETURN c ORDER BY c.created_at DESC`;
  const records = await readQuery(cypher, { status });
  return records.map((r) => r.get("c").properties);
}

/**
 * Gracefully close the driver (call on SIGTERM).
 */
async function closeNeo4j() {
  if (driver) {
    await driver.close();
    logger.info("Neo4j driver closed.");
  }
}

process.on("SIGTERM", closeNeo4j);
process.on("SIGINT", closeNeo4j);

module.exports = {
  connectNeo4j,
  getDriver,
  readQuery,
  writeQuery,
  getFertilizerById,
  searchFertilizers,
  getOfflineCacheProfiles,
  createEscalationCase,
  resolveEscalationCase,
  getEscalationCases,
};
