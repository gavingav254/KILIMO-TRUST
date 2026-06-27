# Kilimo Trust — Server Setup Guide

## Prerequisites

- Node.js >= 18.x
- npm >= 9.x
- Neo4j AuraDB account (free tier works): https://console.neo4j.io
- Featherless AI API key: https://featherless.ai
- (Optional) Masumi API key: https://masumi.network

---

## 1. Clone & Install

```bash
git clone https://github.com/gavingav254/kilimo-trust.git
cd kilimo-trust/server
npm install
```

---

## 2. Environment Setup

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
PORT=3001
NEO4J_URI=bolt://your-instance.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
FEATHERLESS_API_KEY=your-key
ALLOWED_ORIGINS=http://localhost:5173
```

---

## 3. Seed the Neo4j Database

```bash
npm run seed
```

This creates all 20 fertilizer profiles, EU regulation nodes, and relationships in your Neo4j graph. Safe to re-run — uses `MERGE` (idempotent).

---

## 4. Run the Server

```bash
# Development (with auto-restart)
npm run dev

# Production
npm start
```

Server starts at: http://localhost:3001  
API base: http://localhost:3001/api/v1  
Health check: http://localhost:3001/health

---

## 5. Test Key Endpoints

```bash
# Health check
curl http://localhost:3001/health

# Get Top-20 profiles (offline cache bundle)
curl http://localhost:3001/api/v1/fertilizers/top20

# Search for a fertilizer
curl "http://localhost:3001/api/v1/fertilizers/search?q=DAP"

# Get cache bundle (what the SW downloads on install)
curl http://localhost:3001/api/v1/cache/bundle

# Check outbox status
curl http://localhost:3001/api/v1/sync/status

# Expert dashboard stats
curl http://localhost:3001/api/v1/expert/stats

# Audio manifest for Swahili
curl http://localhost:3001/api/v1/audio/manifest/sw
```

---

## 6. File Structure

```
server/
├── index.js                      ← Express app entry point
├── package.json
├── .env.example                  ← Copy to .env
├── .gitignore
│
├── routes/
│   ├── fertilizers.routes.js     ← /api/v1/fertilizers/*
│   ├── escalation.routes.js      ← /api/v1/escalation/*
│   ├── expert.routes.js          ← /api/v1/expert/*
│   ├── sync.routes.js            ← /api/v1/sync/*
│   ├── cache.routes.js           ← /api/v1/cache/*
│   └── audio.routes.js           ← /api/v1/audio/*
│
├── services/
│   ├── neo4j.service.js          ← Graph DB connection & queries
│   ├── masumi.service.js         ← Triage, confidence scoring, outbox
│   ├── featherless.service.js    ← OCR, NLP, TTS integrations
│   └── sync.service.js           ← Outbox background sync processor
│
├── middleware/
│   ├── logger.js                 ← Winston structured logger
│   └── errorHandler.js           ← Global Express error handler
│
├── data/
│   └── top20_fertilizers.json    ← The 20 most common Kenyan fertilizers
│
├── scripts/
│   └── seed_neo4j.js             ← Run once to populate Neo4j
│
├── public/
│   └── audio/                    ← Pre-rendered .mp3 files go here
│       └── README.md
│
└── logs/                         ← Created automatically on first run
```

---

## 7. For the Frontend Team

See **`docs/CLIENT_INTEGRATION.md`** for:
- How to register the service worker
- The three core scan flows (camera, manual, voice)
- How to handle AMBER escalation state and poll for resolution
- The demo "Simulate Offline" toggle
- Audio file paths and playback
- Export Ready Score updates

The service worker file is at: **`docs/client/sw.js`** — copy it to `public/sw.js` in the Lovable project.

---

## 8. Key Design Decisions

| Decision | Rationale |
|---|---|
| In-memory outbox queue (Map) | Fast for prototype; replace with Redis in production |
| Top-20 JSON fallback | Neo4j may be unavailable on the demo machine — local data ensures the demo always works |
| Idempotent MERGE in Neo4j | Seeding is safe to re-run multiple times |
| `multipart/form-data` for scan | Allows the Lovable PWA to send camera captures directly without base64 encoding |
| 202 Accepted for escalations | HTTP semantics: the request was accepted but processing is async |
| Per-language audio manifests | Farmers only download audio for their language → saves 80% of bandwidth |
