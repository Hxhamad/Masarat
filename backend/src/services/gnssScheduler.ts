/**
 * GNSS Scheduler
 *
 * Periodically computes GNSS anomaly scores for all tracked FIRs.
 * Runs every 2 minutes, persisting to SQLite for history.
 */

import { getAllFIREntries } from './firLoader.js';
import { computeGNSSForFIR } from './gnssEngine.js';
import { upsertGNSSSummary, insertGNSSHistory, cleanupOldGNSS } from '../db/gnssStore.js';
import type { GNSSHistoryPoint, GNSSConfidence } from '../types/gnss.js';

const POLL_INTERVAL = 120_000; // 2 min
const BATCH_SIZE = 30;

let timer: ReturnType<typeof setInterval> | null = null;
let batchOffset = 0;

// Metrics
export let lastComputeAt: number | null = null;
export let lastSampleCount = 0;
export const confidenceMix: Record<string, number> = {
  'insufficient-data': 0,
  low: 0,
  medium: 0,
  high: 0,
};

function pollOnce(): void {
  const entries = getAllFIREntries();
  if (entries.length === 0) return;

  if (batchOffset >= entries.length) batchOffset = 0;
  const toProcess = entries.slice(batchOffset, batchOffset + BATCH_SIZE);
  batchOffset += BATCH_SIZE;

  // Reset confidence mix counters
  confidenceMix['insufficient-data'] = 0;
  confidenceMix['low'] = 0;
  confidenceMix['medium'] = 0;
  confidenceMix['high'] = 0;

  let computed = 0;
  let sampleTotal = 0;

  for (const entry of toProcess) {
    try {
      const firId = entry.feature.properties.id;
      const summary = computeGNSSForFIR(firId);
      if (!summary) continue;

      upsertGNSSSummary(summary);

      const histPoint: GNSSHistoryPoint = {
        timestamp: summary.computedAt,
        anomalyScore: summary.anomalyScore,
        suspectedAffectedPct: summary.suspectedAffectedPct,
        flightCount: summary.flightCount,
        confidence: summary.confidence,
      };
      insertGNSSHistory(firId, histPoint);

      confidenceMix[summary.confidence]++;
      sampleTotal += summary.flightCount;
      computed++;
    } catch {
      // Skip individual FIR failures
    }
  }

  lastComputeAt = Date.now();
  lastSampleCount = sampleTotal;

  if (computed > 0) {
    console.log(`[gnss] Computed anomaly scores for ${computed} FIRs`);
  }
}

export function startGNSSScheduler(): void {
  console.log('[gnss] Starting GNSS anomaly scheduler');
  pollOnce();
  timer = setInterval(pollOnce, POLL_INTERVAL);
}

export function stopGNSSScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  console.log('[gnss] Scheduler stopped');
}
