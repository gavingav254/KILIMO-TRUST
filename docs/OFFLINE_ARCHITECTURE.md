# Kilimo Trust — Offline Architecture & Resilience Design

> **Author:** Brian Chacha (Prototype Builder)  
> **Purpose:** Explain the offline resilience architecture to judges, team, and future developers.

---

## The Core Problem We Are Solving

Smallholder farmers in remote Kenya often have **zero bars of mobile data** when they are:
- Inside a corrugated-iron agro-dealer shop
- Standing at the edge of a farm in a valley
- In a market town with congested networks

If the app freezes on a loading spinner in front of the judge, the product fails. This architecture ensures it **never does**.

---

## The Three-Layer Offline Defense

```
┌────────────────────────────────────────────────────────────────┐
│                        LAYER 1 — App Shell Cache               │
│  The UI itself (HTML, CSS, JS) is always served from cache.    │
│  The app loads in < 1 second regardless of connectivity.       │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 2 — Top-20 Data Cache                 │
│  The 20 most common Kenyan fertilizer profiles + their risk    │
│  assessments are stored as JSON in the Cache API.              │
│  Covers ~85% of agro-dealer inventory in Kilimo Trust regions. │
└────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────┐
│                    LAYER 3 — Audio Cache                       │
│  Pre-rendered .mp3 files for all risk advisories in all 5      │
│  languages are stored locally. Zero TTS calls needed offline.  │
└────────────────────────────────────────────────────────────────┘
```

---

## Service Worker Fetch Strategies

| Request Type              | Strategy                 | Why                                                |
|---------------------------|--------------------------|----------------------------------------------------|
| App Shell (HTML/CSS/JS)   | Cache-First              | UI must always load                                |
| Top-20 JSON (`/top20`)    | Stale-While-Revalidate   | Serve instantly, refresh in background when online |
| Audio files (`/audio/*`)  | Cache-First              | Never request audio from network if cached         |
| Scan / Escalation         | Network-First            | Prefer fresh result; fall back to cached version   |
| Sync / Ping               | Network-Only             | These are connectivity tools, not data endpoints   |

---

## The Offline Outbox Queue

When a farmer scans an **unknown fertilizer** while offline:

```
┌────────────────────────────────────────────────────────────────┐
│  Farmer scans unknown bag → Masumi: LOW confidence             │
│                                                                │
│  ONLINE?  → POST to /api/v1/escalation/submit immediately      │
│                                                                │
│  OFFLINE? → Save packet to IndexedDB (outbox store)           │
│             Register 'kilimo-outbox-sync' Background Sync tag  │
│                                                                │
│  Later, when connectivity restored:                            │
│    Background Sync fires → SW reads IDB → POST to server       │
│    Server forwards to Masumi network → Neo4j record created    │
│    Client polls /escalation/:case_id → GREEN or RED update     │
└────────────────────────────────────────────────────────────────┘
```

The farmer **never loses their scan**. The photo, voice recording, and GPS coordinates are stored locally until they can be synced.

---

## The Manual Entry Fallback Flow

```
STEP 1: Camera scan attempted
    ↓
STEP 2: OCR confidence < threshold OR extraction fails
    ↓
STEP 3: App shows friendly fallback UI (never an error screen)
    ↓
┌─────────────────────────────────────────────────────────────┐
│  THREE FALLBACK OPTIONS (progressive — farmer picks one):   │
│                                                             │
│  A) "Sema jina" (Speak the name)                           │
│     → Voice-to-text → match against Top-20 brand names     │
│                                                             │
│  B) Visual Selection                                        │
│     Screen 1: Bag Color Grid (9 color squares)             │
│     Screen 2: Brand Logo Grid (recognizable logo tiles)    │
│     Screen 3: Numeric Keypad for batch number              │
│                                                             │
│  C) Call/WhatsApp Kilimo Trust (if truly unknown)          │
└─────────────────────────────────────────────────────────────┘
    ↓
STEP 4: POST /api/v1/fertilizers/manual with selections
    ↓
STEP 5: Same result flow as camera scan
```

---

## Masumi Confidence Scoring

```javascript
// Pseudocode for the confidence algorithm
confidenceScore = 0

for each OCR token:
  if token EXACTLY matches a batch_prefix_keyword:
    confidenceScore += 1.0 / totalPossibleKeywords
  else if token CONTAINS a batch_prefix_keyword:
    confidenceScore += 0.5 / totalPossibleKeywords

if confidenceScore >= 0.80:
  → DIRECT (return result immediately)
  
if confidenceScore >= 0.50:
  → MONITOR (return result but flag for follow-up)
  
if confidenceScore < 0.50:
  → ESCALATE (queue for human expert)
```

---

## The Expert Escalation Simulation

### Two-Screen Demo Setup

For the presentation, you need **two browser windows**:

**Window 1 — Farmer Phone (Lovable PWA):**
1. Scan an unlabeled/unknown bag
2. App turns AMBER: *"Bado tunahakikisha. Picha imetumwa kwa wataalamu."*
3. Case ID is shown (e.g. `#KT-2024-0042`)

**Window 2 — Expert Dashboard:**
1. Navigate to `/expert-dashboard` (served by the Lovable frontend)
2. New case appears with the label photo and OCR tokens
3. Expert clicks **"Mark as SAFE"** and types notes
4. POST to `POST /api/v1/expert/cases/:case_id/resolve`

**Back on Window 1:**
- App is polling every 60 seconds
- Next poll returns `status: "RESOLVED"`, `ui_state: "GREEN"`
- Card animates from AMBER → GREEN
- Swahili voice plays: *"Mbolea yako imethibitishwa kuwa SALAMA"*

This is the **"loop closure"** — the complete Masumi escalation flow, visible to judges in under 2 minutes.

---

## Demo "Flight Mode" Toggle

For the offline demonstration:

1. Toggle the **"Simulate Deep Rural Zone"** switch in the UI
2. The app sends `{ type: 'SIMULATE_OFFLINE', payload: { enabled: true } }` to the SW
3. The SW sets `SIMULATE_OFFLINE = true` — ALL network fetches are blocked
4. Every fertilizer scan now resolves from the local cache only
5. A banner shows: **"⚡ Deep Rural Mode — Serving from local cache (no internet)"**
6. Scan YaraMila CHUKUA → RED card appears instantly from cached data → Swahili audio plays

**This is your "Aha!" moment for the judges.**

---

## Data Flow Diagram

```
FARMER PHONE                    KILIMO TRUST SERVER              NEO4J
─────────────                   ────────────────────             ──────
Camera Photo
    │
    ▼
Service Worker
(intercepts fetch)
    │
    ├── ONLINE? ──────────────► POST /fertilizers/scan
    │                                │
    │                                ▼
    │                           Featherless OCR
    │                                │
    │                                ▼
    │                           Neo4j query ──────────────► Graph DB
    │                                │                       (Substances,
    │                                ▼                        Regulations,
    │                           Masumi Triage                 Risk Levels)
    │                                │
    │             ┌──────────────────┼────────────────────┐
    │             │                  │                    │
    │          DIRECT            MONITOR             ESCALATE
    │             │                  │                    │
    │          Return             Return              Queue outbox
    │          Result             Result              → POST Masumi
    │             │                  │                    │
    │◄────────────┴──────────────────┘                    │
    │                                                      │
    ├── OFFLINE?                                           │
    │       │                                              │
    │       ▼                                              │
    │  Check Cache                                         │
    │  (Top-20 JSON)                                       │
    │       │                                              │
    │       ├── Match found → Return cached result         │
    │       │                                              │
    │       └── No match → Save to IndexedDB outbox        │
    │                       Register Background Sync        │
    │                       Show AMBER state               │
    │                       Later when online:             │
    │                         SW drains IDB ─────────────► │
    │                                                      │
Farmer sees                              Expert reviews
GREEN/RED/AMBER                         on dashboard
    │                                        │
    ▼                                        │
Plays audio                          Submits verdict
(from cache)                              │
                                           ▼
                          POST /expert/cases/:id/resolve
                                           │
                          Farmer polls → GREEN / RED update
```

---

## Why This Architecture is Unshakeable

| Failure Mode                        | System Response                                  |
|-------------------------------------|--------------------------------------------------|
| No internet at agro-dealer          | Serve from Layer 2 + Layer 3 cache               |
| Label is torn / muddy               | OCR fails gracefully → Manual entry form          |
| Unknown fertilizer batch            | Escalate to human expert via outbox queue         |
| Phone offline when escalating       | Save to IndexedDB → sync when back in town        |
| Neo4j unreachable                   | Masumi falls back to local Top-20 JSON match      |
| Featherless TTS unavailable         | Play pre-cached local .mp3 file                  |
| Masumi network down                 | Queue locally, retry every 30 seconds             |
| App updated (new cache version)     | SW activates → purges old cache → downloads new   |

**The only way the app fully fails is if the device has no storage — which is practically impossible on any modern smartphone.**
