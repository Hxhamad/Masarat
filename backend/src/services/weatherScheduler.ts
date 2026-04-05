/**
 * Weather Scheduler
 *
 * Periodically fetches weather data from external sources and persists
 * results to SQLite. Runs on configurable intervals after FIR data loads.
 */

import { fetchMetarByBounds, fetchSigmets, fetchGAirmets, fetchPireps } from './weatherAviationService.js';
import { fetchFIRForecasts } from './weatherForecastService.js';
import { fetchRadarCatalog } from './weatherRadarService.js';
import {
  upsertMetarBatch,
  upsertAlertBatch,
  upsertForecast,
  upsertRadarCatalog,
  cleanupOldMetar,
  cleanupOldAlerts,
} from '../db/weatherStore.js';
import { getAllFIREntries } from './firLoader.js';
import * as turf from '@turf/turf';

const METAR_INTERVAL = 5 * 60_000;     // 5 min
const ALERT_INTERVAL = 5 * 60_000;     // 5 min
const FORECAST_INTERVAL = 15 * 60_000; // 15 min
const RADAR_INTERVAL = 10 * 60_000;    // 10 min
const CLEANUP_INTERVAL = 60 * 60_000;  // 1 hour
const MAX_FORECAST_FIRS = 10;          // Limit concurrent forecast presses

let metarTimer: ReturnType<typeof setInterval> | null = null;
let alertTimer: ReturnType<typeof setInterval> | null = null;
let forecastTimer: ReturnType<typeof setInterval> | null = null;
let radarTimer: ReturnType<typeof setInterval> | null = null;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// Sync timestamps for metrics
export let lastMetarSync: number | null = null;
export let lastAlertSync: number | null = null;
export let lastForecastSync: number | null = null;
export let lastRadarSync: number | null = null;

/**
 * Compute a global bounding box covering all tracked FIRs.
 */
function getGlobalBounds(): { s: number; w: number; n: number; e: number } | null {
  const entries = getAllFIREntries();
  if (entries.length === 0) return null;

  let s = 90, w = 180, n = -90, e = -180;
  for (const entry of entries) {
    const b = entry.bounds;
    if (b.minLat < s) s = b.minLat;
    if (b.minLng < w) w = b.minLng;
    if (b.maxLat > n) n = b.maxLat;
    if (b.maxLng > e) e = b.maxLng;
  }
  return { s, w, n, e };
}

async function syncMetar(): Promise<void> {
  const bounds = getGlobalBounds();
  if (!bounds) return;

  // Tag each METAR with FIR IDs using point-in-polygon
  const entries = getAllFIREntries();
  const observations = await fetchMetarByBounds(bounds.s, bounds.w, bounds.n, bounds.e);
  if (observations.length === 0) return;

  for (const obs of observations) {
    const pt = turf.point([obs.lon, obs.lat]);
    obs.firIds = entries
      .filter((e) => {
        try { return turf.booleanPointInPolygon(pt, e.feature); } catch { return false; }
      })
      .map((e) => e.feature.properties.id);
  }

  upsertMetarBatch(observations);
  lastMetarSync = Date.now();
  console.log(`[weather] Synced ${observations.length} METAR observations`);
}

async function syncAlerts(): Promise<void> {
  const [sigmets, gairmets, pireps] = await Promise.all([
    fetchSigmets(),
    fetchGAirmets(),
    (() => {
      const bounds = getGlobalBounds();
      return bounds ? fetchPireps(bounds.s, bounds.w, bounds.n, bounds.e) : Promise.resolve([]);
    })(),
  ]);

  const all = [...sigmets, ...gairmets, ...pireps];
  if (all.length > 0) {
    upsertAlertBatch(all);
    lastAlertSync = Date.now();
    console.log(`[weather] Synced ${all.length} alerts (${sigmets.length} SIGMET, ${gairmets.length} G-AIRMET, ${pireps.length} PIREP)`);
  }
}

async function syncForecasts(): Promise<void> {
  const entries = getAllFIREntries();
  const firIds = entries.slice(0, MAX_FORECAST_FIRS).map((e) => e.feature.properties.id);
  if (firIds.length === 0) return;

  const results = await fetchFIRForecasts(firIds, 24);
  for (const f of results) {
    upsertForecast(f);
  }
  lastForecastSync = Date.now();
  if (results.length > 0) {
    console.log(`[weather] Synced forecasts for ${results.length} FIRs`);
  }
}

async function syncRadar(): Promise<void> {
  const catalog = await fetchRadarCatalog();
  if (catalog) {
    upsertRadarCatalog(catalog);
    lastRadarSync = Date.now();
    console.log(`[weather] Synced radar catalog: ${catalog.frames.length} frames`);
  }
}

function cleanup(): void {
  const metarRemoved = cleanupOldMetar();
  const alertsRemoved = cleanupOldAlerts();
  if (metarRemoved + alertsRemoved > 0) {
    console.log(`[weather] Cleanup: ${metarRemoved} old METARs, ${alertsRemoved} old alerts`);
  }
}

export function startWeatherScheduler(): void {
  console.log('[weather] Starting weather scheduler');

  // Run once immediately
  void syncRadar();
  void syncMetar();
  void syncAlerts();
  void syncForecasts();

  radarTimer = setInterval(() => void syncRadar(), RADAR_INTERVAL);
  metarTimer = setInterval(() => void syncMetar(), METAR_INTERVAL);
  alertTimer = setInterval(() => void syncAlerts(), ALERT_INTERVAL);
  forecastTimer = setInterval(() => void syncForecasts(), FORECAST_INTERVAL);
  cleanupTimer = setInterval(cleanup, CLEANUP_INTERVAL);
}

export function stopWeatherScheduler(): void {
  if (radarTimer) { clearInterval(radarTimer); radarTimer = null; }
  if (metarTimer) { clearInterval(metarTimer); metarTimer = null; }
  if (alertTimer) { clearInterval(alertTimer); alertTimer = null; }
  if (forecastTimer) { clearInterval(forecastTimer); forecastTimer = null; }
  if (cleanupTimer) { clearInterval(cleanupTimer); cleanupTimer = null; }
  console.log('[weather] Scheduler stopped');
}
