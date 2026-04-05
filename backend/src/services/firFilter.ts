/**
 * FIR Filter Service
 *
 * Two-stage spatial filtering: fast bbox pre-filter, then exact point-in-polygon.
 * Mirrors the frontend approach but runs server-side for API consumers.
 */

import * as turf from '@turf/turf';
import type { ADSBFlight } from '../types.js';
import type { FIREntry } from '../types/fir.js';
import { getFIREntry, getAllFIREntries } from './firLoader.js';
import { flightCache } from './cache.js';

/** Check if a point is inside the coarse bounding box of a FIR. */
function inBounds(lat: number, lon: number, entry: FIREntry): boolean {
  const { minLat, maxLat, minLng, maxLng } = entry.bounds;
  return lat >= minLat && lat <= maxLat && lon >= minLng && lon <= maxLng;
}

/** Exact point-in-polygon test using Turf. */
function inPolygon(lat: number, lon: number, entry: FIREntry): boolean {
  const pt = turf.point([lon, lat]);
  return turf.booleanPointInPolygon(pt, entry.feature);
}

/** Return all cached flights inside a given set of FIR IDs. */
export function getFlightsInFIRs(firIds: string[]): ADSBFlight[] {
  const entries: FIREntry[] = [];
  for (const id of firIds) {
    const entry = getFIREntry(id);
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return [];

  const allFlights = flightCache.getAll();
  const result: ADSBFlight[] = [];

  for (const f of allFlights) {
    if (!f.latitude || !f.longitude) continue;
    for (const entry of entries) {
      if (inBounds(f.latitude, f.longitude, entry) &&
          inPolygon(f.latitude, f.longitude, entry)) {
        result.push(f);
        break; // No need to check remaining FIRs for this flight
      }
    }
  }

  return result;
}

/** Return flights inside a single FIR. */
export function getFlightsInFIR(firId: string): ADSBFlight[] {
  return getFlightsInFIRs([firId]);
}

/**
 * For every loaded FIR, compute the current flight count.
 * Used for leaderboard / comparative view.
 * Only considers FIRs in the provided list (or all if empty).
 */
export function getFlightCountsByFIR(firIds?: string[]): Map<string, number> {
  const entries = firIds && firIds.length > 0
    ? firIds.map(id => getFIREntry(id)).filter((e): e is FIREntry => !!e)
    : getAllFIREntries();

  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.feature.properties.id, 0);
  }

  const allFlights = flightCache.getAll();
  for (const f of allFlights) {
    if (!f.latitude || !f.longitude) continue;
    for (const entry of entries) {
      const fId = entry.feature.properties.id;
      if (inBounds(f.latitude, f.longitude, entry) &&
          inPolygon(f.latitude, f.longitude, entry)) {
        counts.set(fId, (counts.get(fId) || 0) + 1);
      }
    }
  }

  return counts;
}
