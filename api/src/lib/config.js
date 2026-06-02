'use strict';

/*
 * Whitelist + coerce the config object before it is stored.
 * This prevents callers from stuffing arbitrary/huge fields into blob storage
 * and guarantees a predictable shape for the player.
 */

const MAX_STR = 2000; // generous cap for any single text field
const MAX_PROGRAM_ROWS = 50;

function str(v) {
  if (typeof v !== 'string') return '';
  return v.slice(0, MAX_STR);
}

function bool(v, dflt = true) {
  return typeof v === 'boolean' ? v : dflt;
}

function ms(v, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  // clamp 3s .. 1h
  return Math.min(Math.max(Math.round(n), 3000), 3600000);
}

/*
 * Reference to an internal asset path produced by /api/save, OR a relative
 * default shipped with the static site (e.g. "defaults/logo.png").
 * Anything else (external URLs, data: URLs, javascript:, etc.) is rejected.
 */
function safeAssetRef(v) {
  if (typeof v !== 'string') return '';
  if (v.length > 300) return '';
  if (/^\/api\/asset\/[A-Za-z0-9_-]{8,64}\/[A-Za-z0-9._-]{1,64}$/.test(v)) {
    return v;
  }
  if (/^defaults\/[A-Za-z0-9._/-]{1,80}$/.test(v) && !v.includes('..')) {
    return v;
  }
  return '';
}

function sanitizeConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};

  const program = Array.isArray(c.program)
    ? c.program
        .slice(0, MAX_PROGRAM_ROWS)
        .map(p => ({
          time: str(p && p.time).slice(0, 16),
          title: str(p && p.title).slice(0, 200)
        }))
        .filter(p => p.title)
    : [];

  const slides = Array.isArray(c.slides)
    ? c.slides.map(safeAssetRef).filter(Boolean).slice(0, 12)
    : [];

  return {
    logo: safeAssetRef(c.logo) || 'defaults/logo.png',
    title: str(c.title),
    ssid: str(c.ssid).slice(0, 200),
    pw: str(c.pw).slice(0, 200),
    program,
    rem1: str(c.rem1),
    rem2: str(c.rem2),
    slides,
    showLogo: bool(c.showLogo),
    showTitle: bool(c.showTitle),
    showWifi: bool(c.showWifi),
    showProgram: bool(c.showProgram),
    showRem1: bool(c.showRem1),
    showRem2: bool(c.showRem2),
    bgMs: ms(c.bgMs, 30000),
    cueMs: ms(c.cueMs, 16000)
  };
}

module.exports = { sanitizeConfig, safeAssetRef };
