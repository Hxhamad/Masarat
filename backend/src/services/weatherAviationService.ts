/**
 * AviationWeather.gov Service
 *
 * Fetches METAR observations, SIGMETs, G-AIRMETs, CWAs, and PIREPs
 * from the AviationWeather.gov Data API.
 */

import type { METARObservation, WeatherAlertSummary } from '../types/weather.js';
import { mapMetar, mapAlert } from './weatherMapper.js';

const BASE = 'https://aviationweather.gov/api/data';
const TIMEOUT_MS = 10_000;

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[weather-aviation] fetch failed: ${url} —`, (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch METAR observations around a bounding box.
 * API docs: https://aviationweather.gov/data/api
 */
export async function fetchMetarByBounds(
  south: number, west: number, north: number, east: number,
  firIds: string[] = [],
): Promise<METARObservation[]> {
  // bbox format: minLon,minLat,maxLon,maxLat
  const bbox = `${west},${south},${east},${north}`;
  const url = `${BASE}/metar?bbox=${bbox}&format=json`;
  const raw = await fetchJson<Record<string, unknown>[]>(url);
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => mapMetar(r as never, firIds))
    .filter((m): m is METARObservation => m !== null);
}

/**
 * Fetch current SIGMETs.
 */
export async function fetchSigmets(): Promise<WeatherAlertSummary[]> {
  const url = `${BASE}/airsigmet?format=json&type=sigmet`;
  const raw = await fetchJson<Record<string, unknown>[]>(url);
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => mapAlert(r as never, 'sigmet'))
    .filter((a): a is WeatherAlertSummary => a !== null);
}

/**
 * Fetch current G-AIRMETs.
 */
export async function fetchGAirmets(): Promise<WeatherAlertSummary[]> {
  const url = `${BASE}/airsigmet?format=json&type=airmet`;
  const raw = await fetchJson<Record<string, unknown>[]>(url);
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => mapAlert(r as never, 'g-airmet'))
    .filter((a): a is WeatherAlertSummary => a !== null);
}

/**
 * Fetch recent PIREPs within bounds.
 */
export async function fetchPireps(
  south: number, west: number, north: number, east: number,
): Promise<WeatherAlertSummary[]> {
  const bbox = `${west},${south},${east},${north}`;
  const url = `${BASE}/pirep?bbox=${bbox}&format=json`;
  const raw = await fetchJson<Record<string, unknown>[]>(url);
  if (!raw || !Array.isArray(raw)) return [];
  return raw
    .map((r) => mapAlert(r as never, 'pirep'))
    .filter((a): a is WeatherAlertSummary => a !== null);
}
