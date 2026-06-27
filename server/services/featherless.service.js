/**
 * Featherless AI Service — OCR, NLP, and TTS Integration
 *
 * Wraps the Featherless AI API for three tasks:
 *
 *  1. OCR  — Extract text tokens from a base64 fertilizer label image.
 *  2. NLP  — Translate extracted chemical jargon into plain-language advice
 *            in the farmer's chosen language.
 *  3. TTS  — Generate a voice advisory audio clip (returns a URL or base64).
 *
 * All methods degrade gracefully: if the API is unreachable, they return
 * structured error objects that the caller can use to trigger the offline
 * fallback path.
 *
 * @module services/featherless.service
 */

"use strict";

const logger = require("../middleware/logger");

const BASE_URL = process.env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1";
const API_KEY = process.env.FEATHERLESS_API_KEY;

// Supported language codes → human-readable labels
const SUPPORTED_LANGUAGES = {
  sw: "Swahili",
  en: "English",
  ki: "Kikuyu",
  luo: "Dholuo",
  kal: "Kalenjin",
};

/**
 * Shared fetch wrapper with timeout and auth headers.
 * @private
 */
async function featherlessFetch(path, body) {
  if (!API_KEY) throw new Error("FEATHERLESS_API_KEY is not set.");

  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000), // 15 s — generous for OCR on a phone upload
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Featherless API error ${response.status}: ${errText}`);
  }

  return response.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. OCR — Label Image → Token Array
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract text tokens from a fertilizer label image.
 *
 * @param {string} imageBase64 - Base64-encoded image (JPEG/PNG)
 * @param {string} [mimeType="image/jpeg"]
 *
 * @returns {Promise<{
 *   success: boolean,
 *   tokens: string[],
 *   raw_text: string,
 *   confidence: number,
 *   error?: string
 * }>}
 */
async function extractLabelText(imageBase64, mimeType = "image/jpeg") {
  try {
    const data = await featherlessFetch("/ocr/extract", {
      image: imageBase64,
      mime_type: mimeType,
      mode: "fertilizer_label", // Featherless OCR mode optimised for bag labels
      language_hints: ["en", "sw"],
    });

    return {
      success: true,
      tokens: data.tokens || [],
      raw_text: data.raw_text || "",
      confidence: data.confidence || 0,
    };
  } catch (err) {
    logger.warn(`[FEATHERLESS OCR] Failed: ${err.message}`);
    return {
      success: false,
      tokens: [],
      raw_text: "",
      confidence: 0,
      error: err.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. NLP — Risk Reason → Plain-Language Advisory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a technical risk reason string into farmer-friendly language.
 *
 * @param {object} params
 * @param {string} params.risk_status      - "RED" | "AMBER" | "GREEN"
 * @param {string} params.reason_en        - English technical reason
 * @param {string} params.brand_name       - Fertilizer brand name
 * @param {string} [params.lang="sw"]      - Target language code
 * @param {string} [params.safe_alternative] - Alternative brand if available
 *
 * @returns {Promise<{
 *   success: boolean,
 *   advisory_text: string,
 *   lang: string,
 *   error?: string
 * }>}
 */
async function generateAdvisory(params) {
  const { risk_status, reason_en, brand_name, lang = "sw", safe_alternative } = params;

  try {
    const data = await featherlessFetch("/nlp/advisory", {
      risk_status,
      reason_en,
      brand_name,
      safe_alternative: safe_alternative || null,
      target_language: lang,
      language_name: SUPPORTED_LANGUAGES[lang] || "Swahili",
      persona: "village_agronomist", // Simple, friendly, non-technical tone
    });

    return {
      success: true,
      advisory_text: data.advisory_text || "",
      lang,
    };
  } catch (err) {
    logger.warn(`[FEATHERLESS NLP] Failed: ${err.message}`);

    // Graceful degradation: return a templated advisory in English
    const fallback = buildFallbackAdvisory(risk_status, brand_name, lang);
    return {
      success: false,
      advisory_text: fallback,
      lang,
      error: err.message,
      is_fallback: true,
    };
  }
}

/**
 * Build a hardcoded fallback advisory when NLP is unavailable.
 * @private
 */
function buildFallbackAdvisory(risk_status, brand_name, lang) {
  const messages = {
    RED: {
      sw: `HATARI! ${brand_name} ina kemikali hatari kwa masharti ya EU. Usitumie kwenye mazao ya kuuza nje.`,
      en: `DANGER! ${brand_name} contains substances that violate EU export regulations. Do NOT use on export crops.`,
      ki: `THUNGU! ${brand_name} ĩrĩ na kemikali ĩnooga thungu cia EU. Tigana nayo.`,
      luo: `CHANDRUOK! ${brand_name} nigi kemikali marachwich kod EU. Kik itiend e ndalo ma ichiwo.`,
      kal: `CHEBO! ${brand_name} alak imbarenik EU ngetunotet. Mang'olchi.`,
    },
    AMBER: {
      sw: `TAHADHARI. ${brand_name} ina hatari ya wastani. Angalia kiasi unachotumia.`,
      en: `CAUTION. ${brand_name} has medium risk. Monitor quantities carefully.`,
      ki: `THIIRA. ${brand_name} ĩrĩ na thungu ya kati.`,
      luo: `NG'WADH. ${brand_name} nigi chandruok makadho.`,
      kal: `NGETUNOTET. ${brand_name} alak imbarenik makwe.`,
    },
    GREEN: {
      sw: `SALAMA. ${brand_name} inakidhi masharti ya EU. Unaweza kutumia bila wasiwasi.`,
      en: `SAFE. ${brand_name} meets EU export requirements. You may use it freely.`,
      ki: `ATHIKIO. ${brand_name} ĩgĩĩkia EU.`,
      luo: `KARE. ${brand_name} biro EU.`,
      kal: `NGETUNOTET. ${brand_name} boisiet EU.`,
    },
  };
  return (messages[risk_status] && messages[risk_status][lang]) || messages[risk_status]?.en || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. TTS — Advisory Text → Audio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a plain-language advisory into a voice audio clip.
 *
 * Returns a URL to the generated audio file. For offline caching, the
 * client should download and store this URL response during the install phase.
 *
 * @param {object} params
 * @param {string} params.text   - Text to convert to speech
 * @param {string} params.lang   - Language code ("sw", "en", "ki", "luo", "kal")
 * @param {string} params.voice  - Optional voice ID for the TTS model
 *
 * @returns {Promise<{
 *   success: boolean,
 *   audio_url?: string,
 *   audio_base64?: string,
 *   duration_ms?: number,
 *   error?: string
 * }>}
 */
async function generateVoiceNote(params) {
  const { text, lang = "sw", voice } = params;

  try {
    const data = await featherlessFetch("/tts/generate", {
      text,
      language: lang,
      voice: voice || getDefaultVoice(lang),
      format: "mp3",
      speed: 0.9, // Slightly slower for clarity in noisy environments
    });

    return {
      success: true,
      audio_url: data.audio_url || null,
      audio_base64: data.audio_base64 || null,
      duration_ms: data.duration_ms || null,
    };
  } catch (err) {
    logger.warn(`[FEATHERLESS TTS] Failed: ${err.message}`);
    return {
      success: false,
      error: err.message,
      // Client should fall back to local pre-cached audio file
      fallback_audio_path: `/audio/${lang}/generic_advisory_${lang}.mp3`,
    };
  }
}

/**
 * Default voice IDs per language (Featherless model identifiers).
 * @private
 */
function getDefaultVoice(lang) {
  const voices = {
    sw: "swahili-female-01",
    en: "english-east-africa-male-01",
    ki: "kikuyu-female-01",
    luo: "luo-male-01",
    kal: "kalenjin-female-01",
  };
  return voices[lang] || voices.sw;
}

module.exports = {
  extractLabelText,
  generateAdvisory,
  generateVoiceNote,
  buildFallbackAdvisory,
  SUPPORTED_LANGUAGES,
};
