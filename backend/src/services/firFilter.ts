/**
 * FIR Filter Service
 *
 * Two-stage spatial filtering: fast bbox pre-filter, then exact point-in-polygon.
 * Uses an incremental membership index that only re-tests flights whose position
 * has changed significantly since the last rebuild.
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

// ── Incremental FIR membership index ──
// Full rebuild on first pass, then only re-tests flights whose position moved
// more than MOVE_THRESHOLD_DEG since last index.

const INDEX_REBUILD_INTERVAL_MS = 30_000; // 30 s
const MOVE_THRESHOLD_DEG = 0.05; // ~5.5 km — skip re-test if flight barely moved

let firMembershipIndex = new Map<string, Set<string>>(); // firId → Set<icao24>
/** Per-flight position at the time it was last classified. */
let indexedPositions = new Map<string, { lat: number; lon: number }>(); // icao24 → pos
/** Per-flight FIR memberships for incremental updates. */
let flightFIRs = new Map<string, Set<string>>(); // icao24 → Set<firId>
let lastIndexRebuild = 0;

function rebuildIndex(): void {
  const entries = getAllFIREntries();
  const allFlights = flightCache.getAll();
  const allIds = new Set<string>();

  // Initialize empty sets for every FIR in the new index
  const newIndex = new Map<string, Set<string>>();
  for (const entry of entries) {
    newIndex.set(entry.feature.properties.id, new Set());
  }

  for (const f of allFlights) {
    if (f.latitude == null || f.longitude == null) continue;
    allIds.add(f.icao24);

    // Check if this flight moved enough to warrant re-classification
    const prev = indexedPositions.get(f.icao24);
    if (prev &&
        Math.abs(f.latitude - prev.lat) < MOVE_THRESHOLD_DEG &&
        Math.abs(f.longitude - prev.lon) < MOVE_THRESHOLD_DEG) {
      // Position unchanged — reuse prior FIR memberships
      const priorFIRs = flightFIRs.get(f.icao24);
      if (priorFIRs) {
        for (const firId of priorFIRs) {
          newIndex.get(firId)?.add(f.icao24);
        }
        continue;
      }
    }

    // Classify this flight against all FIRs
    const memberOf = new Set<string>();
    for (const entry of entries) {
      const firId = entry.feature.properties.id;
      if (inBounds(f.latitude, f.longitude, entry) &&
          inPolygon(f.latitude, f.longitude, entry)) {
        newIndex.get(firId)!.add(f.icao24);
        memberOf.add(firId);
      }
    }
    flightFIRs.set(f.icao24, memberOf);
    indexedPositions.set(f.icao24, { lat: f.latitude, lon: f.longitude });
  }

  // Prune stale entries from the position/FIR caches
  for (const icao24 of indexedPositions.keys()) {
    if (!allIds.has(icao24)) {
      indexedPositions.delete(icao24);
      flightFIRs.delete(icao24);
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
