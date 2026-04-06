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

// ── Cached FIR membership index ──
// Rebuilt at most every INDEX_REBUILD_INTERVAL_MS so that health/GNSS jobs
// don't repeatedly full-scan the flight cache with point-in-polygon tests.

const INDEX_REBUILD_INTERVAL_MS = 30_000; // 30 s
let firMembershipIndex = new Map<string, Set<string>>(); // firId → Set<icao24>
let lastIndexRebuild = 0;

function rebuildIndex(): void {
  const entries = getAllFIREntries();
  const allFlights = flightCache.getAll();
  const newIndex = new Map<string, Set<string>>();

  for (const entry of entries) {
    newIndex.set(entry.feature.properties.id, new Set());
  }

  for (const f of allFlights) {
    if (!f.latitude || !f.longitude) continue;
    for (const entry of entries) {
      if (inBounds(f.latitude, f.longitude, entry) &&
          inPolygon(f.latitude, f.longitude, entry)) {
        newIndex.get(entry.feature.properties.id)!.add(f.icao24);
      }
    }
  }

  firMembershipIndex = newIndex;
  lastIndexRebuild = Date.now();
}

function ensureIndex(): void {
  if (Date.now() - lastIndexRebuild >= INDEX_REBUILD_INTERVAL_MS) {
    rebuildIndex();
  }
}

/** Return all cached flights inside a given set of FIR IDs. */
export function getFlightsInFIRs(firIds: string[]): ADSBFlight[] {
  ensureIndex();

  const ids = new Set<string>();
  for (const firId of firIds) {
    const members = firMembershipIndex.get(firId);
    if (members) {
      for (const id of members) ids.add(id);
    }
  }

  const result: ADSBFlight[] = [];
  for (const icao24 of ids) {
    const flight = flightCache.get(icao24);
    if (flight) result.push(flight);
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
  ensureIndex();

  const entries = firIds && firIds.length > 0
    ? firIds.map(id => getFIREntry(id)).filter((e): e is FIREntry => !!e)
    : getAllFIREntries();

  const counts = new Map<string, number>();
  for (const entry of entries) {
    const fId = entry.feature.properties.id;
    const members = firMembershipIndex.get(fId);
    counts.set(fId, members ? members.size : 0);
  }

  return counts;
}
