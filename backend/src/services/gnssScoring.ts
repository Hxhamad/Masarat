/**
 * GNSS Scoring
 *
 * Phase 1: proxy-based anomaly scoring using currently available data.
 * - MLAT share (elevated MLAT in an area usually dominated by ADS-B = suspicious)
 * - Position dropout rate (flights not updating positions)
 * - Stale-position share (high lastSeen / seen_pos values)
 *
 * Confidence is always 'low' or 'insufficient-data' until direct nav-integrity
 * fields (NACp, NIC, SIL, SDA) are available from a richer upstream source.
 */

import type { GNSSConfidence, GNSSEvidenceFlags } from '../types/gnss.js';
import type { ADSBFlight } from '../types.js';

const MIN_SAMPLE = 10;
const MLAT_THRESHOLD = 0.30;        // >30% MLAT share is elevated
const STALE_THRESHOLD_SEC = 30;     // position age > 30s = stale
const DROPOUT_THRESHOLD = 0.15;     // >15% stale positions = elevated

export interface ScoringResult {
  anomalyScore: number;             // 0–100
  suspectedAffectedPct: number;
  confidence: GNSSConfidence;
  evidence: GNSSEvidenceFlags;
  flightCount: number;
}

export function scoreFlights(flights: ADSBFlight[]): ScoringResult {
  const total = flights.length;

  if (total < MIN_SAMPLE) {
    return {
      anomalyScore: 0,
      suspectedAffectedPct: 0,
      confidence: 'insufficient-data',
      evidence: {
        navIntegrityPresent: false,
        mlatShareElevated: false,
        positionDropoutElevated: false,
        crossSourceAgreement: true,
      },
      flightCount: total,
    };
  }

  // Check if any flight has real nav-integrity fields
  const hasNavIntegrity = flights.some(
    (f) => f.navQuality?.nacp != null || f.navQuality?.nic != null,
  );

  // MLAT share
  const mlatCount = flights.filter((f) => f.source === 'mlat').length;
  const mlatShare = mlatCount / total;
  const mlatElevated = mlatShare > MLAT_THRESHOLD;

  // Stale position / dropout
  const staleCount = flights.filter((f) => f.lastSeen > STALE_THRESHOLD_SEC).length;
  const staleShare = staleCount / total;
  const dropoutElevated = staleShare > DROPOUT_THRESHOLD;

  // Suspected affected = MLAT + stale (de-duplicated)
  const suspectedSet = new Set<string>();
  for (const f of flights) {
    if (f.source === 'mlat' || f.lastSeen > STALE_THRESHOLD_SEC) {
      suspectedSet.add(f.icao24);
    }
  }
  const suspectedPct = (suspectedSet.size / total) * 100;

  // Composite anomaly score (0–100)
  // Weight: 50% MLAT share, 30% dropout rate, 20% ensemble penalty
  const mlatComponent = Math.min(mlatShare / 0.6, 1) * 50;        // saturates at 60% MLAT
  const dropoutComponent = Math.min(staleShare / 0.3, 1) * 30;    // saturates at 30% stale
  const ensemblePenalty = (mlatElevated && dropoutElevated) ? 20 : 0;
  const raw = mlatComponent + dropoutComponent + ensemblePenalty;
  const anomalyScore = Math.round(Math.min(raw, 100));

  // Confidence: without real nav integrity, we cap at 'low'
  let confidence: GNSSConfidence = 'low';
  if (hasNavIntegrity) {
    confidence = anomalyScore > 50 ? 'high' : 'medium';
  }

  return {
    anomalyScore,
    suspectedAffectedPct: Math.round(suspectedPct * 10) / 10,
    confidence,
    evidence: {
      navIntegrityPresent: hasNavIntegrity,
      mlatShareElevated: mlatElevated,
      positionDropoutElevated: dropoutElevated,
      crossSourceAgreement: !mlatElevated || !dropoutElevated,
    },
    flightCount: total,
  };
}
