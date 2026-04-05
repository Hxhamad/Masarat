/**
 * Open-Meteo Forecast Service
 *
 * Fetches hourly forecasts at a FIR centroid using the free Open-Meteo API.
 * One request per FIR; results are cached in weatherStore.
 */

import type { FIRForecastSummary } from '../types/weather.js';
import { getAllFIREntries, getFIREntry } from './firLoader.js';
import * as turf from '@turf/turf';

const BASE = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 10_000;

/**
 * Compute centroid lat/lon for a FIR polygon.
 */
function getFIRCentroid(firId: string): { lat: number; lon: number } | null {
  const entry = getFIREntry(firId);
  if (!entry) return null;
  const centroid = turf.centroid(entry.feature);
  const [lon, lat] = centroid.geometry.coordinates;
  return { lat, lon };
}

/**
 * Fetch hourly forecast for a single FIR centroid.
 */
export async function fetchFIRForecast(firId: string, hours = 24): Promise<FIRForecastSummary | null> {
  const center = getFIRCentroid(firId);
  if (!center) return null;

  const params = new URLSearchParams({
    latitude: center.lat.toFixed(4),
    longitude: center.lon.toFixed(4),
    hourly: 'precipitation,visibility,cloudcover,cape,freezinglevel_height,windspeed_925hPa',
    forecast_hours: String(Math.min(hours, 168)),
    timezone: 'UTC',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}?${params}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as {
      hourly?: {
        time?: string[];
        precipitation?: number[];
        visibility?: number[];
        cloudcover?: number[];
        cape?: number[];
        freezinglevel_height?: number[];
        windspeed_925hPa?: number[];
      };
    };

    const h = data.hourly;
    if (!h || !h.time) return null;

    const timeEpochs = h.time.map((t) => new Date(t).getTime());

    return {
      firId,
      generatedAt: Date.now(),
      hours: timeEpochs.length,
      hourly: {
        time: timeEpochs,
        precipitationMm: h.precipitation ?? [],
        visibilityM: h.visibility ?? [],
        cloudCoverPct: h.cloudcover ?? [],
        capeJkg: h.cape,
        freezingLevelM: h.freezinglevel_height,
        windSpeed925hPaKt: h.windspeed_925hPa?.map((v) => Math.round(v * 1.94384)),
      },
    };
  } catch (err) {
    console.warn(`[weather-forecast] Failed for ${firId}:`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Batch-fetch forecasts for a list of FIR IDs. Serialized to respect
 * Open-Meteo fair-use rate limits.
 */
export async function fetchFIRForecasts(firIds: string[], hours = 24): Promise<FIRForecastSummary[]> {
  const results: FIRForecastSummary[] = [];
  for (const id of firIds) {
    const f = await fetchFIRForecast(id, hours);
    if (f) results.push(f);
  }
  return results;
}

/**
 * Return all loaded FIR IDs for default polling scope.
 */
export function getAllFIRIds(): string[] {
  return getAllFIREntries().map((e) => e.feature.properties.id);
}
