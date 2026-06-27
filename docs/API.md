# Kilimo Trust — Server API Reference

> **Base URL:** `http://localhost:3001/api/v1` (development)  
> **Production URL:** Set after deployment  
> **Content-Type:** `application/json` (unless noted)  
> **Version:** 1.0.0

---

## Table of Contents

1. [Health Check](#1-health-check)
2. [Fertilizers](#2-fertilizers)
3. [Escalation (Masumi Agent)](#3-escalation-masumi-agent)
4. [Expert Dashboard](#4-expert-dashboard)
5. [Offline Sync](#5-offline-sync)
6. [Cache Bundle](#6-cache-bundle)
7. [Audio Manifest](#7-audio-manifest)
8. [Data Structures](#8-data-structures)
9. [Error Format](#9-error-format)

---

## 1. Health Check

### `GET /health`

Verify the server is running and connected to Neo4j.

**Response:**
```json
{
  "status": "ok",
  "service": "kilimo-trust-server",
  "version": "1.0.0",
  "timestamp": "2024-06-01T08:00:00.000Z"
}
```

---

## 2. Fertilizers

### `GET /api/v1/fertilizers/top20`

Returns the full offline cache bundle (Top-20 fertilizer profiles).  
The service worker calls this during the **INSTALL** event to build the offline cache.

**Response:**
```json
{
  "success": true,
  "count": 20,
  "cache_version": "2024-06-01",
  "profiles": [ /* See FertilizerProfile object */ ]
}
```

---

### `GET /api/v1/fertilizers/search?q=<term>`

Search for fertilizers by brand name or batch keyword.

| Parameter | Type   | Required | Description                        |
|-----------|--------|----------|------------------------------------|
| `q`       | string | ✓        | Search term (e.g. "YARA", "DAP")   |

**Response:**
```json
{
  "success": true,
  "count": 2,
  "results": [ /* FertilizerProfile objects */ ]
}
```

---

### `GET /api/v1/fertilizers/:id`

Fetch a single fertilizer profile by its unique ID.

| Parameter | Type   | Description              |
|-----------|--------|--------------------------|
| `id`      | string | e.g. `yaramila_chukua_01`|

**Response:**
```json
{
  "success": true,
  "profile": { /* FertilizerProfile */ }
}
```

**404 Response:**
```json
{ "success": false, "error": "Fertilizer profile not found" }
```

---

### `POST /api/v1/fertilizers/scan`

**The main scan pipeline.** Accepts a label photo, runs OCR via Featherless AI, queries Neo4j, and runs Masumi triage to produce a risk result or escalation.

**Content-Type:** `multipart/form-data` OR `application/json`

#### Option A — Multipart (recommended for camera captures):
| Field        | Type    | Required | Description                              |
|--------------|---------|----------|------------------------------------------|
| `image`      | File    | ✓        | Label photo (JPEG/PNG, max 8MB)          |
| `lang`       | string  |          | `sw`\|`en`\|`ki`\|`luo`\|`kal` (default: `sw`) |
| `device_id`  | string  |          | Farmer device fingerprint               |
| `gps_lat`    | float   |          | GPS latitude                             |
| `gps_lng`    | float   |          | GPS longitude                            |
| `is_offline` | boolean |          | `true` if device is offline              |

#### Option B — JSON (base64 image):
```json
{
  "image_base64": "<base64 string>",
  "lang": "sw",
  "device_id": "device-abc-123",
  "gps_lat": -0.4127,
  "gps_lng": 36.9508,
  "is_offline": false
}
```

#### Response A — HIGH/MEDIUM confidence (direct result):
```json
{
  "success": true,
  "ocr_success": true,
  "ocr_confidence": 0.92,
  "triage": "DIRECT",
  "confidence": 0.88,
  "profile": { /* FertilizerProfile */ },
  "advisory_text": "HATARI! YaraMila ina Cadmium nyingi...",
  "advisory_lang": "sw",
  "audio_path": "/audio/sw/warn_yara_cadmium_sw.mp3",
  "safe_alternatives": ["mavuno_planting_04"],
  "export_score_impact": -10
}
```

#### Response B — OCR failed (trigger manual entry):
```json
{
  "success": false,
  "ocr_success": false,
  "ocr_confidence": 0.12,
  "fallback_required": true,
  "fallback_reason": "OCR_FAILED",
  "message": "Could not read the label. Please use voice input or manual entry.",
  "message_sw": "Haiwezekani kusoma lebo. Tafadhali sema jina au ingiza kwa mkono.",
  "case_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### Response C — LOW confidence (Masumi escalation):
```json
{
  "success": true,
  "ocr_success": true,
  "triage": "ESCALATE",
  "confidence": 0.31,
  "case_id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "PENDING",
  "ui_state": "AMBER",
  "message": "We are verifying. Photo sent to experts.",
  "message_sw": "Bado tunahakikisha. Picha imetumwa kwa wataalamu.",
  "message_ki": "Tũratetheria. Picha nĩyatumwo kũrĩa ataalamu.",
  "message_luo": "Wabatimba. Picha oherwa ni jowuon neno.",
  "message_kal": "Komiten. Picha nyalunet yametwa ne mwalimu.",
  "estimated_response_minutes": 30,
  "queue_position": 2
}
```

> **HTTP Status:** `200` for direct results, `202 Accepted` for escalations.

---

### `POST /api/v1/fertilizers/manual`

Manual visual-selection lookup for low-literacy farmers. The client presents a step-by-step selector (bag color → brand logo → batch number) and sends the result here.

**Body:**
```json
{
  "bag_color": "white",
  "brand_id": "YARA",
  "batch_number": "151810859",
  "lang": "sw",
  "device_id": "device-abc-123"
}
```

> At least one of `bag_color`, `brand_id`, or `batch_number` is required.

**Response (match found):**
```json
{
  "success": true,
  "match_count": 2,
  "profile": { /* Best matching FertilizerProfile */ },
  "other_candidates": [ /* Up to 3 other possible matches */ ],
  "advisory_text": "...",
  "audio_path": "/audio/sw/...",
  "export_score_impact": 5
}
```

**Response (no match → escalation):**
```json
{
  "success": false,
  "triage": "ESCALATE",
  "case_id": "...",
  "status": "PENDING",
  "ui_state": "AMBER",
  "message": "We could not identify this fertilizer. A Kilimo Trust expert will review it.",
  "message_sw": "Hatujapata mbolea hii. Mtaalamu wa Kilimo Trust ataangalia."
}
```

---

## 3. Escalation (Masumi Agent)

### `POST /api/v1/escalation/submit`

Explicitly submit an escalation packet. Called when:
- Masumi triage returns `"ESCALATE"` (usually handled automatically by `/scan`)
- The device was offline and is now syncing stored cases

**Content-Type:** `multipart/form-data` (preferred) or JSON

| Field          | Type   | Required | Description                      |
|----------------|--------|----------|----------------------------------|
| `device_id`    | string | ✓        | Farmer device fingerprint        |
| `case_id`      | string |          | UUID (generated if omitted)      |
| `ocr_tokens`   | JSON   |          | Array of extracted tokens        |
| `manual_batch` | string |          | Manually typed batch number      |
| `image`        | File   |          | Label photo                      |
| `voice`        | File   |          | Voice recording (.webm)          |
| `gps_lat`      | float  |          | GPS latitude                     |
| `gps_lng`      | float  |          | GPS longitude                    |

**Response (202 Accepted):**
```json
{
  "success": true,
  "case_id": "550e8400-...",
  "status": "PENDING",
  "ui_state": "AMBER",
  "synced_to_cloud": true,
  "message": "Case submitted. A Kilimo Trust expert will review and respond.",
  "message_sw": "Ombi limepokelewa. Mtaalamu atakiangalia hivi karibuni.",
  "estimated_response_minutes": 30
}
```

---

### `GET /api/v1/escalation/:case_id`

Poll the status of a specific escalation case.  
**Client should poll every 60 seconds until `status === "RESOLVED"`.**

**Response (pending):**
```json
{
  "success": true,
  "ui_state": "AMBER",
  "case_id": "550e8400-...",
  "status": "PENDING",
  "created_at": "2024-06-01T08:00:00.000Z",
  "device_id": "device-abc-123"
}
```

**Response (resolved):**
```json
{
  "success": true,
  "ui_state": "GREEN",
  "case_id": "550e8400-...",
  "status": "RESOLVED",
  "expert_verdict": "SAFE",
  "expert_notes": "Verified as Organics Plus. Cadmium 2 ppm. EU compliant.",
  "resolved_at": "2024-06-01T08:32:00.000Z"
}
```

---

### `GET /api/v1/escalation?status=PENDING`

List all escalation cases. Optional `status` filter: `PENDING`, `RESOLVED`, `ALL`.

---

### `POST /api/v1/escalation/sync`

Manually trigger the outbox sync job. Useful for a "Retry" button in the UI.

**Response:**
```json
{ "success": true, "processed": 3, "failed": 0 }
```

---

## 4. Expert Dashboard

> **Note:** In production, these endpoints require a Bearer token (`Authorization: Bearer <token>`).  
> For the prototype, set `EXPERT_DASHBOARD_TOKEN=your-secret` in `.env`.

### `GET /api/v1/expert/cases?status=PENDING`

List cases for the Expert Dashboard.  
`status` options: `PENDING`, `RESOLVED`, `ALL` (default: `PENDING`)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "cases": [
    {
      "case_id": "...",
      "device_id": "...",
      "ocr_tokens": ["YARA", "CHUKUA"],
      "status": "PENDING",
      "has_image": true,
      "has_voice": false,
      "gps": { "lat": -0.41, "lng": 36.95 },
      "created_at": "2024-06-01T08:00:00.000Z"
    }
  ]
}
```

---

### `GET /api/v1/expert/cases/:case_id`

Full case detail including the label image for expert review.

**Response:**
```json
{
  "success": true,
  "case": {
    "case_id": "...",
    "image_data_url": "data:image/jpeg;base64,...",
    "voice_data_url": "data:audio/webm;base64,...",
    "ocr_tokens": ["YARA", "CHUKUA", "151810859"],
    "manual_batch": null,
    "gps": { "lat": -0.41, "lng": 36.95 },
    "status": "PENDING"
  }
}
```

---

### `POST /api/v1/expert/cases/:case_id/resolve`

Submit an expert verdict. This closes the case and triggers a notification to the farmer's device.

**Body:**
```json
{
  "verdict": "SAFE",
  "notes": "Verified as Mavuno Planting. Cadmium 18 ppm. EU compliant.",
  "safe_alternative_id": null
}
```

| Field                 | Type   | Required | Values                                    |
|-----------------------|--------|----------|-------------------------------------------|
| `verdict`             | string | ✓        | `SAFE` \| `UNSAFE` \| `NEEDS_MORE_INFO`   |
| `notes`               | string | ✓        | Expert explanation (max 1000 chars)        |
| `safe_alternative_id` | string |          | ID of a recommended alternative fertilizer |

**Response:**
```json
{
  "success": true,
  "case_id": "...",
  "verdict": "SAFE",
  "ui_state": "GREEN",
  "notes": "...",
  "resolved_at": "2024-06-01T08:32:00.000Z",
  "farmer_notification": {
    "ui_state": "GREEN",
    "message_en": "Your fertilizer has been verified as SAFE by a Kilimo Trust agronomist.",
    "message_sw": "Mbolea yako imethibitishwa kuwa SALAMA na mtaalamu wa Kilimo Trust."
  }
}
```

---

### `GET /api/v1/expert/stats`

Dashboard summary statistics.

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 12,
    "pending": 3,
    "resolved": 9,
    "safe_verdicts": 6,
    "unsafe_verdicts": 2,
    "needs_more_info": 1,
    "oldest_pending": "2024-06-01T07:00:00.000Z"
  }
}
```

---

## 5. Offline Sync

### `GET /api/v1/sync/ping`

Connectivity check endpoint. The service worker polls this to detect when internet is restored.

**Response:** `200 OK`
```json
{ "online": true, "ts": 1717228800000 }
```

---

### `POST /api/v1/sync/outbox`

Client Background Sync pushes locally-queued outbox items here when connectivity is restored.

**Body:**
```json
{
  "device_id": "device-abc-123",
  "items": [
    { "case_id": "...", "ocr_tokens": ["SIGMA"], "created_at": "..." }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "accepted": 2,
  "duplicate": 1,
  "failed": 0,
  "sync_result": { "processed": 2, "failed": 0 }
}
```

---

### `GET /api/v1/sync/status`

Current server-side outbox queue summary.

---

## 6. Cache Bundle

### `GET /api/v1/cache/version`

Check if a new cache version is available. The service worker calls this on activation.

**Response:**
```json
{
  "cache_version": "v1.0.0-2024-06-01",
  "fertilizer_count": 20,
  "audio_file_count": 125,
  "updated_at": "2024-06-01T00:00:00.000Z"
}
```

---

### `GET /api/v1/cache/bundle`

One-shot bundle: Top-20 profiles + audio manifest + bag color index.  
Called once on first launch or after a cache update.

---

### `GET /api/v1/cache/manifest`

Full list of URLs for the service worker to pre-cache, grouped by caching strategy.

---

## 7. Audio Manifest

### `GET /api/v1/audio/manifest`

Complete audio file list across all 5 languages.

### `GET /api/v1/audio/manifest/:lang`

Audio files for a specific language (`sw`, `en`, `ki`, `luo`, `kal`).  
Use this to download only the farmer's chosen language and save bandwidth.

---

## 8. Data Structures

### FertilizerProfile

```json
{
  "id": "yaramila_chukua_01",
  "brand_name": "YaraMila CHUKUA",
  "batch_prefix_keywords": ["YARA", "MILA", "CHUKUA", "YMC"],
  "npk": "17-17-17",
  "risk_status": "RED",
  "cadmium_ppm": 87,
  "eu_cadmium_limit_ppm": 60,
  "phosphonate": false,
  "heavy_metals": ["Cadmium"],
  "reason_en": "Cadmium concentration (87 ppm) exceeds EU limit of 60 ppm...",
  "reason_sw": "Kemikali ya Cadmium iko juu ya kiwango cha EU...",
  "safe_alternative_ids": ["mavuno_planting_04"],
  "audio_files": {
    "sw": "/audio/sw/warn_yara_cadmium_sw.mp3",
    "en": "/audio/en/warn_yara_cadmium_en.mp3",
    "ki": "/audio/ki/warn_yara_cadmium_ki.mp3",
    "luo": "/audio/luo/warn_yara_cadmium_luo.mp3",
    "kal": "/audio/kal/warn_yara_cadmium_kal.mp3"
  },
  "is_offline_cached": true,
  "common_crops": ["beans", "french_beans"],
  "bag_colors": ["white", "blue"],
  "logo_image_path": "/logos/yaramila.png",
  "regulation_ref": "EU Reg 2019/1009 Annex I"
}
```

### Risk Status Values

| Value   | Meaning                                    | UI Color  | Export Score Impact |
|---------|--------------------------------------------|-----------|---------------------|
| `GREEN` | EU compliant — safe to use                 | 🟢 Green  | +5                  |
| `AMBER` | Marginal — use with caution                | 🟡 Amber  | 0                   |
| `RED`   | EU violation — do not use on export crops  | 🔴 Red    | -10                 |

### Triage Decision Values

| Value      | Meaning                                  |
|------------|------------------------------------------|
| `DIRECT`   | High confidence — return result instantly |
| `MONITOR`  | Medium confidence — flag for monitoring  |
| `ESCALATE` | Low confidence — send to human expert    |

### Expert Verdict Values

| Value              | UI State | Farmer Message                   |
|--------------------|----------|----------------------------------|
| `SAFE`             | GREEN    | Fertilizer is EU compliant       |
| `UNSAFE`           | RED      | Fertilizer violates EU rules     |
| `NEEDS_MORE_INFO`  | AMBER    | Expert needs more information    |

---

## 9. Error Format

All errors return a consistent JSON structure:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "errors": [ /* Validation errors (array), if applicable */ ]
}
```

| HTTP Status | Meaning                              |
|-------------|--------------------------------------|
| 400         | Bad request / validation failure     |
| 401         | Unauthorized (Expert Dashboard)      |
| 404         | Resource not found                   |
| 409         | Conflict (e.g. case already resolved)|
| 500         | Internal server error                |
| 503         | Offline — cached data served         |
