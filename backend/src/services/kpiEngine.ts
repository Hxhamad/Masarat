/**
 * KPI Engine — Consolidated Health Index (CHI)
 *
 * Computes a 0–100 health score for an FIR using three pillars:
 *   Safety   (30%) — convergence / closure-rate risk
 *   Efficiency (40%) — KEA (actual vs great-circle distance proxy)
 *   Fluidity (30%) — current volume vs rolling peak
 *
 * The first-pass heuristics documented here are designed to work with
 * the data available from ADS-B feeds (position, heading, speed).
 * They are NOT ICAO-grade KPIs — they are practical proxies.
 */

import * as turf from '@turf/turf';
import type { ADSBFlight } from '../types.js';
import type { FIRHealthSnapshot, InefficiencyEntry } from '../types/fir.js';
import { getFlightsInFIR } from './firFilter.js';
import { getHistoricalPeak } from '../db/healthStore.js';

// ===== Tuning constants =====

/** Min separation (nm) considered "safe" — below this, pair is a safety concern. */
const SAFETY_SEPARATION_NM = 5;
/** Speed threshold — if two aircraft close at > this rate they are "converging". */
const CLOSURE_RATE_KT = 100;
/** Max pairs to evaluate per FIR to keep computation bounded. */
const MAX_PAIR_CHECKS = 2000;
/** Average CO₂ per flight-hour for a generic narrowbody (kg). Rough OpenAP proxy. */
const CO2_KG_PER_FLIGHT_HOUR = 2500;

// ===== Rolling peak tracker (in-memory) =====

const peakCounts = new Map<string, number>();

function updatePeak(firId: string, count: number): number {
  const prev = peakCounts.get(firId) ?? count;
  const peak = Math.max(prev, count);
  peakCounts.set(firId, peak);
  return peak;
}

// ===== Safety Score =====

/**
 * Heuristic: for each pair of airborne flights, estimate closure rate.
 * Closure rate = rate at which the distance between two aircraft decreases.
 *
 * If closure rate > threshold AND current distance < separation threshold,
 * that pair is a "safety concern".  Score = 100 - (concerns / pairs * 100).
 */
function computeSafetyScore(flights: ADSBFlight[]): number {
  const airborne = flights.filter(f => !f.isOnGround && f.altitude > 0);
  if (airborne.length < 2) return 100;

  let concerns = 0;
  let pairsChecked = 0;

  for (let i = 0; i < airborne.length && pairsChecked < MAX_PAIR_CHECKS; i++) {
    for (let j = i + 1; j < airborne.length && pairsChecked < MAX_PAIR_CHECKS; j++) {
      const a = airborne[i];
      const b = airborne[j];

      // Quick altitude gate: if >2000 ft apart vertically, skip
      if (Math.abs(a.altitude - b.altitude) > 2000) continue;

      pairsChecked++;

      const distNm = turf.distance(
        turf.point([a.longitude, a.latitude]),
        turf.point([b.longitude, b.latitude]),
        { units: 'nauticalmiles' }
      );

      // Only evaluate nearby pairs
      if (distNm > 30) continue;

      // Estimate closure rate from heading & speed vectors
      const aVx = a.groundSpeed * Math.sin((a.heading * Math.PI) / 180);
      const aVy = a.groundSpeed * Math.cos((a.heading * Math.PI) / 180);
      const bVx = b.groundSpeed * Math.sin((b.heading * Math.PI) / 180);
      const bVy = b.groundSpeed * Math.cos((b.heading * Math.PI) / 180);

      // Relative velocity components
      const dx = b.longitude - a.longitude;
      const dy = b.latitude - a.latitude;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      const ux = dx / dist;
      const uy = dy / dist;

      // Closure rate = how fast they approach along the line connecting them
      const relVx = aVx - bVx;
      const relVy = aVy - bVy;
      const closureRate = relVx * ux + relVy * uy; // positive = closing

      if (closureRate > CLOSURE_RATE_KT && distNm < SAFETY_SEPARATION_NM) {
        concerns++;
      }
    }
  }

  if (pairsChecked === 0) return 100;
  const ratio = concerns / pairsChecked;
  return Math.round(Math.max(0, Math.min(100, 100 - ratio * 500)));
}

// ===== Efficiency Score (KEA proxy) =====

/**
 * For each flight with a trail (≥2 points inside the FIR), compute:
 *   KEA = actual distance flown / great-circle distance between entry & latest position
 *
 * A perfect straight line = 1.0.  Zig-zagging = higher.
 * FIR efficiency = average KEA across all scored flights, mapped to 0–100.
 */
function computeEfficiencyScore(flights: ADSBFlight[]): { score: number; inefficient: InefficiencyEntry[] } {
  const scored: { flight: ADSBFlight; kea: number; detourKm: number }[] = [];

  for (const f of flights) {
    if (f.trail.length < 3) continue; // Need enough trail to be meaningful

    const points = f.trail
      .filter(p => p.lat && p.lon)
      .sort((a, b) => a.ts - b.ts);

    if (points.length < 3) continue;

    // Actual distance flown (sum of segments)
    let actualKm = 0;
    for (let i = 1; i < points.length; i++) {
      actualKm += turf.distance(
        turf.point([points[i - 1].lon, points[i - 1].lat]),
        turf.point([points[i].lon, points[i].lat]),
        { units: 'kilometers' }
      );
    }

    // Great-circle from first to last
    const gcKm = turf.distance(
      turf.point([points[0].lon, points[0].lat]),
      turf.point([points[points.length - 1].lon, points[points.length - 1].lat]),
      { units: 'kilometers' }
    );

    if (gcKm < 10) continue; // Too short to score meaningfully

    const kea = actualKm / gcKm;
    scored.push({ flight: f, kea, detourKm: actualKm - gcKm });
  }

  if (scored.length === 0) return { score: 85, inefficient: [] }; // Default healthy

  const avgKea = scored.reduce((s, e) => s + e.kea, 0) / scored.length;
  // Map KEA to score: 1.0 = 100, 1.5 = 0
  const score = Math.round(Math.max(0, Math.min(100, (1.5 - avgKea) * 200)));

  // Top 3 most inefficient
  const inefficient: InefficiencyEntry[] = scored
    .sort((a, b) => b.kea - a.kea)
    .slice(0, 3)
    .map(e => ({
      icao24: e.flight.icao24,
      callsign: e.flight.callsign || e.flight.icao24,
      kea: Math.round(e.kea * 100) / 100,
      detourKm: Math.round(e.detourKm * 10) / 10,
    }));

  return { score, inefficient };
}

// ===== Fluidity Score =====

/**
 * Fluidity = 100 * (1 - saturation).
 * Saturation = current flight count / rolling peak.
 * >90% = "Red" (score < 10).
 */
function computeFluidityScore(firId: string, currentCount: number): { score: number; saturationPct: number } {
  // Check DB for historical peak first, then in-memory tracker
  const dbPeak = getHistoricalPeak(firId);
  const memPeak = updatePeak(firId, currentCount);
  const peak = Math.max(dbPeak, memPeak, 1); // avoid /0

  const saturationPct = Math.round((currentCount / peak) * 100);
  const score = Math.round(Math.max(0, Math.min(100, 100 - saturationPct)));

  return { score, saturationPct };
}

// ===== CO₂ Estimate =====

/**
 * Very rough estimate: count of airborne aircraft × average CO₂ rate × time slice.
 * This is a placeholder; OpenAP integration would give type-specific burn rates.
 */
function estimateCO2(flights: ADSBFlight[]): number {
  const airborne = flights.filter(f => !f.isOnGround);
  // Assume each is captured at a ~5s snapshot interval → per-snapshot kg
  const hoursPerSnapshot = 5 / 3600;
  return Math.round(airborne.length * CO2_KG_PER_FLIGHT_HOUR * hoursPerSnapshot);
}

// ===== Main Compute =====

export function computeFIRHealth(firId: string): FIRHealthSnapshot & {
  topInefficient: InefficiencyEntry[];
  saturationPct: number;
} {
  const flights = getFlightsInFIR(firId);
  const count = flights.length;

  const safetyScore = computeSafetyScore(flights);
  const { score: efficiencyScore, inefficient } = computeEfficiencyScore(flights);
  const { score: fluidityScore, saturationPct } = computeFluidityScore(firId, count);

  // Weighted CHI
  const chi = Math.round(
    safetyScore * 0.30 +
    efficiencyScore * 0.40 +
    fluidityScore * 0.30
  );

  const airborne = flights.filter(f => !f.isOnGround);
  const avgAltitude = airborne.length > 0
    ? Math.round(airborne.reduce((s, f) => s + f.altitude, 0) / airborne.length)
    : 0;
  const avgGroundSpeed = airborne.length > 0
    ? Math.round(airborne.reduce((s, f) => s + f.groundSpeed, 0) / airborne.length)
    : 0;

  const co2EstimateKg = estimateCO2(flights);

  const snapshot: FIRHealthSnapshot = {
    firId,
    timestamp: Date.now(),
    flightCount: count,
    chi,
    safetyScore,
    efficiencyScore,
    fluidityScore,
    avgAltitude,
    avgGroundSpeed,
    co2EstimateKg,
  };

  return { ...snapshot, topInefficient: inefficient, saturationPct };
}
