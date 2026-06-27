# Kilimo Trust — Client Integration Guide

> **Audience:** Frontend Team (Lovable / Wendy & Brian)  
> **Written by:** Prototype Builder (Brian Chacha)  
> **Last updated:** 2024-06-01

This document tells the Lovable frontend team **exactly** how to integrate with the Kilimo Trust server. Every API call, every offline behavior, every edge case is documented here so there is no ambiguity.

---

## 1. Quick Start

### Register the Service Worker

In your app entry point (e.g. `main.jsx` or `index.html`):

```javascript
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      console.log('SW registered:', reg.scope);

      // Register Background Sync for offline outbox
      if ('SyncManager' in window) {
        await reg.sync.register('kilimo-outbox-sync');
      }
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  });
}
```

### Set the API Base URL

```javascript
// config.js
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';
```

---

## 2. The Three Core Flows

### Flow 1 — Camera Scan (Happy Path)

```
Farmer taps "Scan Label"
  → Camera captures photo
  → POST /api/v1/fertilizers/scan (multipart with image)
  → Server returns: profile + advisory_text + audio_path
  → Show GREEN / AMBER / RED card
  → Play audio from audio_path (served from cache if offline)
```

#### Example Code:

```javascript
async function scanLabel(imageFile, lang = 'sw') {
  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('lang', lang);
  formData.append('device_id', getDeviceId());
  formData.append('gps_lat', await getGPSLat());
  formData.append('gps_lng', await getGPSLng());
  formData.append('is_offline', !navigator.onLine);

  const res = await fetch(`${API_BASE}/fertilizers/scan`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();

  if (!data.ocr_success || data.fallback_required) {
    // OCR failed → show manual entry UI
    showManualEntryForm(data.case_id);
    playAudio(`/audio/${lang}/ocr_failed_${lang}.mp3`);
    return;
  }

  if (data.triage === 'ESCALATE') {
    // Unknown fertilizer → show AMBER state
    showAmberState(data);
    startPollingForResolution(data.case_id);
    playAudio(`/audio/${lang}/escalation_sent_${lang}.mp3`);
    return;
  }

  // Direct result
  showRiskCard(data.profile, data.advisory_text, data.export_score_impact);
  playAudio(data.audio_path);
}
```

---

### Flow 2 — Manual Entry (OCR Failed Fallback)

When OCR fails (`fallback_required: true`), show the 3-step visual selector:

```
Step 1: Bag Color Grid    → farmer taps color square
Step 2: Brand Logo Grid   → farmer taps recognizable logo  
Step 3: Numeric Keypad    → farmer/assistant types batch number
  → POST /api/v1/fertilizers/manual
  → Handle response same as scan result
```

#### Step Data to Collect:
```javascript
const manualSelection = {
  bag_color: 'white',       // from color grid
  brand_id: 'YARA',         // from logo grid (logo identifier)
  batch_number: '151810859', // from numeric keypad
  lang: 'sw',
  device_id: getDeviceId(),
};
```

#### Bag Color Options (use these exact strings):
`white`, `blue`, `yellow`, `green`, `brown`, `grey`, `pink`, `red`, `black`, `gold`

#### Brand IDs (from `/api/v1/cache/bundle` → `profiles[].batch_prefix_keywords[0]`):
Pre-populate your logo grid from the cache bundle. The `logo_image_path` field gives you the image to display.

```javascript
// Load from cache bundle (downloaded during SW install)
const bundle = await fetch(`${API_BASE}/cache/bundle`).then(r => r.json());
const bagColorIndex = bundle.bag_color_index; // e.g. { "white": ["yaramila_chukua_01", ...] }
const profiles = bundle.profiles;             // Full array of FertilizerProfile objects
```

---

### Flow 3 — Masumi Escalation (AMBER State)

When the server returns `ui_state: "AMBER"`:

```
Show AMBER card with message_sw / message_ki / message_luo / message_kal
  → Store case_id locally
  → Poll GET /api/v1/escalation/:case_id every 60 seconds
  → When status === "RESOLVED" → update UI to GREEN or RED
  → Play corresponding audio
```

#### Polling Logic:

```javascript
async function startPollingForResolution(caseId, lang = 'sw') {
  const POLL_INTERVAL = 60_000; // 60 seconds

  const poll = async () => {
    try {
      const res = await fetch(`${API_BASE}/escalation/${caseId}`);
      const data = await res.json();

      if (data.status === 'RESOLVED') {
        // Update UI
        showResolutionCard(data);
        playAudio(
          data.ui_state === 'GREEN'
            ? `/audio/${lang}/generic_safe_${lang}.mp3`
            : `/audio/${lang}/generic_danger_${lang}.mp3`
        );
        return; // Stop polling
      }
    } catch {
      // Offline — continue polling
    }

    setTimeout(poll, POLL_INTERVAL);
  };

  poll();
}
```

#### If Device Goes Offline During Escalation:

The Background Sync API handles this automatically (see Service Worker). But you should also:

```javascript
// Queue the packet to IndexedDB so the SW can sync it
navigator.serviceWorker.controller?.postMessage({
  type: 'QUEUE_ESCALATION',
  payload: {
    case_id: data.case_id,
    device_id: getDeviceId(),
    ocr_tokens: [],
    created_at: new Date().toISOString(),
  },
});
```

---

## 3. Offline Mode

### Check if Truly Offline

```javascript
// Ping the server — faster and more reliable than navigator.onLine
async function isOnline() {
  try {
    const res = await fetch(`${API_BASE}/sync/ping`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}
```

### The Demo "Simulate Offline" Toggle

For the presentation, add a toggle button labeled **"Simulate Flight Mode / Deep Rural Zone"**.

When toggled ON:
1. Set your app's `isOffline` state to `true`
2. Send a message to the service worker to block all network fetches:

```javascript
function toggleSimulateOffline(enabled) {
  navigator.serviceWorker.controller?.postMessage({
    type: 'SIMULATE_OFFLINE',
    payload: { enabled },
  });

  // Listen for the ACK
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data.type === 'SIMULATE_OFFLINE_ACK') {
      console.log('Offline simulation:', event.data.enabled);
      updateOfflineBanner(event.data.enabled);
    }
  });
}
```

Show a persistent banner: **"⚡ Deep Rural Mode — Serving from local cache"**

When toggled OFF, the app seamlessly returns to live API calls.

---

## 4. Audio Playback

### Offline Audio Strategy

Audio files are pre-cached by the service worker during install. Always construct paths using the `audio_path` field from the API response — these paths are served by the Express static file server and cached by the SW.

```javascript
function playAudio(path) {
  const audio = new Audio(path);
  audio.play().catch((err) => {
    // Autoplay blocked by browser — show a play button instead
    showPlayButton(path);
  });
}
```

### Audio File Path Convention

```
/audio/{lang}/{status}_{fertilizer_id}_{lang}.mp3

Examples:
  /audio/sw/warn_yara_cadmium_sw.mp3     → Swahili warning for YaraMila
  /audio/en/safe_mavuno_planting_en.mp3  → English safe advisory for Mavuno
  /audio/sw/generic_safe_sw.mp3          → Generic Swahili safe message
  /audio/sw/ocr_failed_sw.mp3            → "Can't read label" message
  /audio/sw/escalation_sent_sw.mp3       → "Expert notified" message
```

### Pre-load Audio for a Language

When the farmer selects their language on first launch:

```javascript
async function preloadLanguageAudio(lang) {
  const manifestRes = await fetch(`${API_BASE}/audio/manifest/${lang}`);
  const manifest = await manifestRes.json();

  // The service worker will cache these automatically on next fetch
  // But we can also trigger them manually:
  const allFiles = [
    ...manifest.fertilizer_files.map(f => f.path),
    ...manifest.generic_files.map(f => f.path),
  ];

  for (const path of allFiles) {
    fetch(path); // Fire-and-forget — SW caches it
  }
}
```

---

## 5. Export Ready Score

The `export_score_impact` field on scan results tells you how to update the farmer's score:

| Value  | Risk Status | Meaning                                          |
|--------|-------------|--------------------------------------------------|
| `+5`   | GREEN       | Farmer used a safe fertilizer — reward them      |
| `0`    | AMBER       | Neutral — borderline fertilizer                  |
| `-10`  | RED         | Farmer used a dangerous fertilizer — penalize    |

Store the running score in `localStorage` or your app's state:

```javascript
function updateExportScore(impact) {
  const current = parseInt(localStorage.getItem('export_score') || '50', 10);
  const newScore = Math.max(0, Math.min(100, current + impact));
  localStorage.setItem('export_score', String(newScore));
  renderScoreBar(newScore);
}
```

Display the score as a progress bar labeled **"Export Ready Score"**. Scores above 80 can be shared with SACCOs.

---

## 6. Device ID

Generate a persistent device fingerprint on first launch:

```javascript
function getDeviceId() {
  let id = localStorage.getItem('kilimo_device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('kilimo_device_id', id);
  }
  return id;
}
```

---

## 7. Language Selection

Supported language codes:

| Code  | Language  | Direction |
|-------|-----------|-----------|
| `sw`  | Swahili   | Default   |
| `en`  | English   |           |
| `ki`  | Kikuyu    |           |
| `luo` | Dholuo    |           |
| `kal` | Kalenjin  |           |

Store the farmer's language preference:

```javascript
function setLanguage(lang) {
  localStorage.setItem('kilimo_lang', lang);
  preloadLanguageAudio(lang); // Start downloading audio for this language
}

function getLang() {
  return localStorage.getItem('kilimo_lang') || 'sw';
}
```

---

## 8. Web App Manifest (PWA)

Add to your `manifest.json`:

```json
{
  "name": "Kilimo Trust",
  "short_name": "Kilimo",
  "description": "Know your fertilizer risk before you apply",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#16a34a",
  "background_color": "#000000",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

---

## 9. Listening for SW Messages

The service worker sends these messages back to the app:

```javascript
navigator.serviceWorker.addEventListener('message', (event) => {
  const { type, ...payload } = event.data;

  switch (type) {
    case 'CACHE_UPDATE_AVAILABLE':
      // A new version of the fertilizer database is available
      showUpdateBanner(payload.new_version);
      break;

    case 'OUTBOX_SYNCED':
      // Offline queue was successfully synced
      showSyncSuccessBanner(payload.result);
      break;

    case 'CACHE_REFRESHED':
      // Cache was manually refreshed
      console.log('Cache refreshed ✓');
      break;

    case 'ESCALATION_QUEUED':
      // An offline escalation was saved to IDB
      console.log('Escalation queued offline:', payload.case_id);
      break;
  }
});
```

---

## 10. Error Handling

Always handle these error scenarios in your UI:

| Scenario                     | UI Action                                         | Audio                          |
|------------------------------|---------------------------------------------------|-------------------------------|
| OCR failed                   | Show manual entry form                            | Play `ocr_failed_{lang}.mp3`  |
| Unknown fertilizer → AMBER   | Show AMBER card + start polling                   | Play `escalation_sent.mp3`    |
| Offline + no cache match     | Show offline AMBER card + queue in IDB            | Play `escalation_sent.mp3`    |
| Network error on any call    | Retry from cache, show offline banner             | No audio change               |
| Expert resolved → GREEN      | Animate card to GREEN, show expert notes          | Play `generic_safe.mp3`       |
| Expert resolved → RED        | Animate card to RED, show warning + alternatives  | Play `generic_danger.mp3`     |

---

## 11. Folder Structure for Frontend

```
public/
├── sw.js                     ← Service worker (provided by us)
├── manifest.json
├── audio/
│   ├── sw/                   ← Swahili audio files (.mp3)
│   ├── en/                   ← English audio files
│   ├── ki/                   ← Kikuyu audio files
│   ├── luo/                  ← Dholuo audio files
│   └── kal/                  ← Kalenjin audio files
└── logos/                    ← Fertilizer brand logo images
    ├── yaramila.png
    ├── mavuno.png
    └── ...
```

The audio files must be generated by **Ephey's Featherless TTS pipeline** and placed in these folders before the first deployment. Once cached by the SW, they never need internet again.
