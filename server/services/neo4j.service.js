/**
 * Neo4j Service — Knowledge Graph Connection & Query Helpers
 *
 * This service manages the Neo4j driver lifecycle and exposes
 * typed query helpers used by the fertilizer and escalation routes.
 *
 * Fallback: If Neo4j cannot be reached, the service enters MOCK DATABASE mode
 * using the top20_fertilizers.json configuration and a local in-memory array.
 *
 * @module services/neo4j.service
 */

"use strict";

const neo4j = require("neo4j-driver");
const logger = require("../middleware/logger");

let driver;
let useMock = false;
let mockEscalations = [];

/**
 * Initialise the Neo4j driver and verify the connection.
 * Called once at server startup.
 */
async function connectNeo4j() {
  const uri = process.env.NEO4J_URI || "";
  
  if (!uri || uri.includes("your-instance")) {
    logger.warn("⚠️ Neo4j URI is empty or default placeholder. Running in Mock Database Mode.");
    useMock = true;
    return null;
  }

  try {
    driver = neo4j.driver(
      uri,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
      {
        maxConnectionPoolSize: 50,
        connectionAcquisitionTimeout: 5000, // 5s connection acquisition timeout
        logging: neo4j.logging.console("warn"),
      }
    );

    await driver.verifyConnectivity();
    logger.info("Neo4j database connected successfully ✓");
    return driver;
  } catch (err) {
    logger.error(`⚠️ Failed to connect to Neo4j (${err.message}). Falling back to Mock Database Mode.`);
    useMock = true;
    return null;
  }
}

/**
 * Return the shared driver instance.
 * @throws {Error} if called before connectNeo4j()
 */
function getDriver() {
  if (useMock) return null;
  if (!driver) throw new Error("Neo4j driver not initialised. Call connectNeo4j() first.");
  return driver;
}

/**
 * Run a read-only Cypher query.
 */
async function readQuery(cypher, params = {}) {
  if (useMock) {
    logger.warn(`[MOCK DB] Intercepted read query: ${cypher.split("\n")[0]}...`);
    return [];
  }
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

/**
 * Run a write Cypher query.
 */
async function writeQuery(cypher, params = {}) {
  if (useMock) {
    logger.warn(`[MOCK DB] Intercepted write query: ${cypher.split("\n")[0]}...`);
    return [];
  }
  const session = getDriver().session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Domain-Specific Helpers (with Mock Fallbacks)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a fertilizer profile by its unique ID.
 */
async function getFertilizerById(id) {
  if (useMock) {
    const TOP_20 = require("../data/top20_fertilizers.json");
    const item = TOP_20.find((f) => f.id === id);
    if (!item) return null;
    return {
      ...item,
      safe_alternatives: item.safe_alternative_ids || [],
    };
  }

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
 */
async function searchFertilizers(term) {
  if (useMock) {
    const TOP_20 = require("../data/top20_fertilizers.json");
    const cleanTerm = (term || "").toLowerCase();
    
    const matches = TOP_20.filter((f) => 
      f.brand_name.toLowerCase().includes(cleanTerm) ||
      f.batch_prefix_keywords.some((kw) => kw.toLowerCase().includes(cleanTerm))
    );

    // Sort matches by RED first, then AMBER, then GREEN to replicate Cypher ordering
    return matches.sort((a, b) => {
      const order = { RED: 0, AMBER: 1, GREEN: 2 };
      return order[a.risk_status] - order[b.risk_status];
    }).slice(0, 10);
  }

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
 */
async function getOfflineCacheProfiles() {
  if (useMock) {
    const TOP_20 = require("../data/top20_fertilizers.json");
    return TOP_20.map((f) => ({
      ...f,
      safe_alternatives: f.safe_alternative_ids || [],
    }));
  }

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
 */
async function createEscalationCase(caseData) {
  if (useMock) {
    const newCase = {
      ...caseData,
      created_at: new Date().toISOString(),
      resolved_at: null,
      expert_verdict: null,
      expert_notes: null,
    };
    // Avoid duplicates in memory array
    const exists = mockEscalations.some(c => c.case_id === caseData.case_id);
    if (!exists) {
      mockEscalations.push(newCase);
    }
    logger.info(`[MOCK DB] Created escalation case in memory: ${caseData.case_id}`);
    return;
  }

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
 */
async function resolveEscalationCase(caseId, verdict, notes) {
  if (useMock) {
    const c = mockEscalations.find((x) => x.case_id === caseId);
    if (c) {
      c.status = "RESOLVED";
      c.expert_verdict = verdict;
      c.expert_notes = notes;
      c.resolved_at = new Date().toISOString();
      logger.info(`[MOCK DB] Resolved escalation case: ${caseId} as ${verdict}`);
    }
    return;
  }

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
 */
async function getEscalationCases(status = null) {
  if (useMock) {
    const items = [...mockEscalations];
    // Sort descending by created_at date
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (status && status !== "ALL") {
      return items.filter((x) => x.status === status);
    }
    return items;
  }

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
