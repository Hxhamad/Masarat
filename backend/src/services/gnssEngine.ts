/**
 * GNSS Engine
 *
 * Computes GNSS anomaly summaries per FIR using the current flight cache
 * and the scoring module.
 */

import { cellToLatLng, latLngToCell } from 'h3-js';
import { getFlightsInFIR } from './firFilter.js';
import { getFIREntry } from './firLoader.js';
import { flightCache } from './cache.js';
import { scoreFlights } from './gnssScoring.js';
import type { ADSBFlight } from '../types.js';
import type { GeoBounds, GNSSHexBin, GNSSHexBinsResponse, GNSSFIRSummary } from '../types/gnss.js';

function normalizeLongitude(lng: number): number {
  let normalized = lng;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function normalizeBounds(bounds: GeoBounds): GeoBounds {
  return {
    minLat: Math.max(-90, Math.min(90, bounds.minLat)),
    maxLat: Math.max(-90, Math.min(90, bounds.maxLat)),
    minLng: normalizeLongitude(bounds.minLng),
    maxLng: normalizeLongitude(bounds.maxLng),
  };
}

function getFlightsForBounds(bounds: GeoBounds): ADSBFlight[] {
  if (bounds.maxLng >= bounds.minLng) {
    return flightCache.getByBounds(bounds.minLat, bounds.minLng, bounds.maxLat, bounds.maxLng);
  }

  const westHemisphere = flightCache.getByBounds(bounds.minLat, bounds.minLng, bounds.maxLat, 180);
  const eastHemisphere = flightCache.getByBounds(bounds.minLat, -180, bounds.maxLat, bounds.maxLng);
  const deduped = new Map<string, ADSBFlight>();

  for (const flight of [...westHemisphere, ...eastHemisphere]) {
    deduped.set(flight.icao24, flight);
  }

  return [...deduped.values()];
}

export function computeGNSSForFIR(firId: string): GNSSFIRSummary | null {
  const entry = getFIREntry(firId);
  if (!entry) return null;

  const flights = getFlightsInFIR(firId);
  const result = scoreFlights(flights);

  return {
    firId,
    firName: entry.feature.properties.name,
    country: entry.feature.properties.country,
    computedAt: Date.now(),
    flightCount: result.flightCount,
    anomalyScore: result.anomalyScore,
    suspectedAffectedPct: result.suspectedAffectedPct,
    confidence: result.confidence,
    evidence: result.evidence,
  };
}

export function computeGNSSHexBins(
  bounds: GeoBounds,
  resolution: number,
  bucketMinutes: number,
): GNSSHexBinsResponse {
  const normalizedBounds = normalizeBounds(bounds);
  const flights = getFlightsForBounds(normalizedBounds);
  const byCell = new Map<string, ADSBFlight[]>();

  for (const flight of flights) {
    if (!Number.isFinite(flight.latitude) || !Number.isFinite(flight.longitude)) continue;

    try {
      const h3Index = latLngToCell(flight.latitude, flight.longitude, resolution);
      const bucket = byCell.get(h3Index);
      if (bucket) {
        bucket.push(flight);
      } else {
        byCell.set(h3Index, [flight]);
      }
    } catch {
      // Ignore invalid coordinates rather than failing the entire viewport response.
    }
  }

  const generatedAt = Date.now();
  const bucketMs = Math.max(1, bucketMinutes) * 60_000;
  const bucketStart = generatedAt - (generatedAt % bucketMs);
  const bins: GNSSHexBin[] = [];

  for (const [h3Index, bucketFlights] of byCell) {
    const result = scoreFlights(bucketFlights);
    if (result.confidence === 'insufficient-data') continue;
    const [centroidLat, centroidLon] = cellToLatLng(h3Index);
    bins.push({
      h3Index,
      centroidLat,
      centroidLon,
      bucketStart,
      bucketMinutes,
      computedAt: generatedAt,
      flightCount: result.flightCount,
      anomalyScore: result.anomalyScore,
      suspectedAffectedPct: result.suspectedAffectedPct,
      confidence: result.confidence,
      evidence: result.evidence,
    });
  }

  bins.sort((a, b) => {
    if (b.anomalyScore !== a.anomalyScore) return b.anomalyScore - a.anomalyScore;
    return b.flightCount - a.flightCount;
  });

  return {
    generatedAt,
    resolution,
    bucketMinutes,
    bounds: normalizedBounds,
    inputFlightCount: flights.length,
    cellCount: bins.length,
    bins,
  };
}
