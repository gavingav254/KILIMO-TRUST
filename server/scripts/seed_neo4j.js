// ─────────────────────────────────────────────────────────────────────────────
// Kilimo Trust — Neo4j Graph Seed Script
//
// Run: node scripts/seed_neo4j.js
//
// Creates:
//  1. EU Regulation nodes (2019/1009 and 2023/915)
//  2. FertilizerProfile nodes from top20_fertilizers.json
//  3. EscalationCase constraints
//  4. Relationships: REGULATED_BY, HAS_SAFE_ALTERNATIVE
//  5. Full-text search index on brand_name and batch_prefix_keywords
//
// WARNING: This script is idempotent (uses MERGE) — safe to re-run.
// ─────────────────────────────────────────────────────────────────────────────

"use strict";

require("dotenv").config({ path: "../.env" });
const neo4j = require("neo4j-driver");
const TOP_20 = require("../data/top20_fertilizers.json");

const driver = neo4j.driver(
  process.env.NEO4J_URI,
  neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

async function run() {
  const session = driver.session();

  try {
    console.log("🌱 Starting Neo4j seed...\n");

    // ── 1. Constraints & Indexes ─────────────────────────────────────────────
    console.log("Creating constraints and indexes...");
    await session.run(`CREATE CONSTRAINT unique_fertilizer_id IF NOT EXISTS
      FOR (f:FertilizerProfile) REQUIRE f.id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT unique_case_id IF NOT EXISTS
      FOR (c:EscalationCase) REQUIRE c.case_id IS UNIQUE`);
    await session.run(`CREATE CONSTRAINT unique_regulation_code IF NOT EXISTS
      FOR (r:EU_Regulation) REQUIRE r.code IS UNIQUE`);
    console.log("  ✓ Constraints created\n");

    // ── 2. EU Regulation Nodes ────────────────────────────────────────────────
    console.log("Creating EU Regulation nodes...");
    await session.run(`
      MERGE (r:EU_Regulation {code: 'EU_2019_1009'})
      SET r.name              = 'EU Fertilising Products Regulation 2019/1009',
          r.cadmium_limit_ppm = 60,
          r.effective_date    = '2022-07-16',
          r.summary           = 'Sets maximum Cadmium levels for phosphate fertilizers at 60 mg Cd/kg P2O5. Phase-down to 40 ppm by 2026.'
    `);
    await session.run(`
      MERGE (r:EU_Regulation {code: 'EU_2023_915'})
      SET r.name              = 'EU Regulation 2023/915 — Heavy Metal Contaminants',
          r.cadmium_limit_ppm = 60,
          r.effective_date    = '2023-05-25',
          r.summary           = 'Stricter maximum limits for Cadmium in food. Covers leafy vegetables, cereals, and legumes.'
    `);
    await session.run(`
      MERGE (r:EU_Regulation {code: 'EU_ORGANIC_2018_848'})
      SET r.name           = 'EU Organic Regulation 2018/848',
          r.effective_date = '2022-01-01',
          r.summary        = 'Governs organic farming inputs. Prohibits synthetic pesticides, phosphonates, and heavy-metal-bearing fertilizers.'
    `);
    console.log("  ✓ EU Regulations created\n");

    // ── 3. FertilizerProfile Nodes ────────────────────────────────────────────
    console.log(`Creating ${TOP_20.length} FertilizerProfile nodes...`);
    for (const f of TOP_20) {
      await session.run(
        `MERGE (p:FertilizerProfile {id: $id})
         SET p.brand_name             = $brand_name,
             p.npk                    = $npk,
             p.risk_status            = $risk_status,
             p.cadmium_ppm            = $cadmium_ppm,
             p.eu_cadmium_limit_ppm   = $eu_cadmium_limit_ppm,
             p.phosphonate            = $phosphonate,
             p.heavy_metals           = $heavy_metals,
             p.reason_en              = $reason_en,
             p.reason_sw              = $reason_sw,
             p.batch_prefix_keywords  = $batch_prefix_keywords,
             p.audio_file_path        = $audio_file_path,
             p.is_offline_cached      = $is_offline_cached,
             p.common_crops           = $common_crops,
             p.bag_colors             = $bag_colors,
             p.logo_image_path        = $logo_image_path,
             p.regulation_ref         = $regulation_ref`,
        {
          id: f.id,
          brand_name: f.brand_name,
          npk: f.npk,
          risk_status: f.risk_status,
          cadmium_ppm: f.cadmium_ppm,
          eu_cadmium_limit_ppm: f.eu_cadmium_limit_ppm,
          phosphonate: f.phosphonate,
          heavy_metals: f.heavy_metals,
          reason_en: f.reason_en,
          reason_sw: f.reason_sw,
          batch_prefix_keywords: f.batch_prefix_keywords,
          audio_file_path: f.audio_file_path,
          is_offline_cached: f.is_offline_cached,
          common_crops: f.common_crops,
          bag_colors: f.bag_colors,
          logo_image_path: f.logo_image_path,
          regulation_ref: f.regulation_ref,
        }
      );
      console.log(`  ✓ ${f.brand_name} [${f.risk_status}]`);
    }

    // ── 4. REGULATED_BY Relationships ─────────────────────────────────────────
    console.log("\nCreating REGULATED_BY relationships...");
    await session.run(`
      MATCH (f:FertilizerProfile), (r:EU_Regulation {code: 'EU_2019_1009'})
      MERGE (f)-[:REGULATED_BY]->(r)
    `);
    await session.run(`
      MATCH (f:FertilizerProfile {risk_status: 'RED'}), (r:EU_Regulation {code: 'EU_2023_915'})
      MERGE (f)-[:VIOLATES]->(r)
    `);
    console.log("  ✓ Regulation relationships created\n");

    // ── 5. HAS_SAFE_ALTERNATIVE Relationships ─────────────────────────────────
    console.log("Creating HAS_SAFE_ALTERNATIVE relationships...");
    for (const f of TOP_20) {
      for (const altId of f.safe_alternative_ids || []) {
        await session.run(
          `MATCH (a:FertilizerProfile {id: $id}), (b:FertilizerProfile {id: $altId})
           MERGE (a)-[:HAS_SAFE_ALTERNATIVE]->(b)`,
          { id: f.id, altId }
        );
      }
    }
    console.log("  ✓ Safe alternative relationships created\n");

    // ── 6. Full-text Search Index ─────────────────────────────────────────────
    console.log("Creating full-text search index...");
    await session.run(`
      CREATE FULLTEXT INDEX fertilizer_search IF NOT EXISTS
      FOR (f:FertilizerProfile) ON EACH [f.brand_name, f.reason_en]
    `);
    console.log("  ✓ Full-text index created\n");

    console.log("✅ Neo4j seed complete!\n");
    console.log(`  Fertilizer profiles: ${TOP_20.length}`);
    console.log(`  EU Regulations:      3`);
    console.log(`  RED profiles:        ${TOP_20.filter((f) => f.risk_status === "RED").length}`);
    console.log(`  AMBER profiles:      ${TOP_20.filter((f) => f.risk_status === "AMBER").length}`);
    console.log(`  GREEN profiles:      ${TOP_20.filter((f) => f.risk_status === "GREEN").length}`);
  } finally {
    await session.close();
    await driver.close();
  }
}

run().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
