/**
 * Kilimo Trust — Server Entry Point
 *
 * Responsibilities:
 *  - Boot the Express application
 *  - Connect to Neo4j on startup (with retry)
 *  - Register all route groups
 *  - Start the Offline Sync background job (cron)
 *  - Serve static audio files for offline playback
 *
 * @module index
 */

"use strict";

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
const cron = require("node-cron");

const logger = require("./middleware/logger");
const errorHandler = require("./middleware/errorHandler");
const { connectNeo4j } = require("./services/neo4j.service");
const { runOutboxSync } = require("./services/sync.service");

// ── Route Handlers ──────────────────────────────────────────────────────────
const fertilizerRoutes = require("./routes/fertilizers.routes");
const escalationRoutes = require("./routes/escalation.routes");
const expertRoutes = require("./routes/expert.routes");
const syncRoutes = require("./routes/sync.routes");
const audioRoutes = require("./routes/audio.routes");
const cacheRoutes = require("./routes/cache.routes");

// ── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ─────────────────────────────────────────────────────
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }, // Allow audio files to be loaded cross-origin
  })
);

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow server-to-server requests (no origin) and whitelisted origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Device-Id"],
  })
);

// ── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" })); // 10MB to allow base64 label images
app.use(express.urlencoded({ extended: true }));

// ── HTTP Request Logging ─────────────────────────────────────────────────────
app.use(morgan("dev", { stream: { write: (msg) => logger.http(msg.trim()) } }));

// ── Static Files — Pre-rendered Audio for Offline Playback ──────────────────
// The client service worker will cache these during the install phase.
app.use(
  "/audio",
  express.static(path.join(__dirname, "public/audio"), {
    maxAge: "7d",
    etag: true,
  })
);

// ── Health Check ─────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "kilimo-trust-server",
    version: require("./package.json").version,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────────────────────
const API = "/api/v1";

app.use(`${API}/fertilizers`, fertilizerRoutes);  // Fertilizer profile lookup & search
app.use(`${API}/escalation`, escalationRoutes);   // Masumi escalation & outbox queue
app.use(`${API}/expert`, expertRoutes);            // Expert Dashboard (review & resolve)
app.use(`${API}/sync`, syncRoutes);                // Offline outbox sync trigger
app.use(`${API}/audio`, audioRoutes);              // Audio manifest for cache prefetch
app.use(`${API}/cache`, cacheRoutes);              // Top-20 cache payload bundle

// ── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
  });
});

// ── Global Error Handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ── Startup ──────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    logger.info("Connecting to Neo4j...");
    await connectNeo4j();
    logger.info("Neo4j connected ✓");

    app.listen(PORT, () => {
      logger.info(`Kilimo Trust Server running on http://localhost:${PORT}`);
      logger.info(`API base: http://localhost:${PORT}/api/v1`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
    });

    // ── Offline Outbox Sync Cron Job ─────────────────────────────────────────
    // Every 30 seconds, attempt to process any pending escalations that were
    // captured offline and are now waiting to be synced to the cloud.
    const SYNC_INTERVAL = process.env.SYNC_INTERVAL_MS
      ? Math.round(Number(process.env.SYNC_INTERVAL_MS) / 1000)
      : 30;

    cron.schedule(`*/${SYNC_INTERVAL} * * * * *`, async () => {
      logger.info("[SYNC] Running outbox sync job...");
      await runOutboxSync();
    });

    logger.info(
      `[SYNC] Outbox sync job scheduled every ${SYNC_INTERVAL}s ✓`
    );
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();

module.exports = app; // Export for Jest integration tests
