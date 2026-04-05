/**
 * Health Poller
 *
 * Periodically computes FIR health snapshots for tracked FIRs.
 * Runs every 60s, persisting results to SQLite for the history API.
 */

import { getAllFIREntries } from './firLoader.js';
import { computeFIRHealth } from './kpiEngine.js';
import { insertHealthSnapshot } from '../db/healthStore.js';
import type { FIRHealthSnapshot, InefficiencyEntry } from '../types/fir.js';

const POLL_INTERVAL = 60_000; // 60s
const BATCH_SIZE = 50;

let timer: ReturnType<typeof setInterval> | null = null;
let batchOffset = 0;

// In-memory latest health cache for quick reads
const latestHealth = new Map<string, FIRHealthSnapshot & {
  topInefficient: InefficiencyEntry[];
  saturationPct: number;
}>();

function pollOnce(): void {
  const entries = getAllFIREntries();
  if (entries.length === 0) return;

  // Rotating batch: advance offset each tick so all FIRs get covered
  if (batchOffset >= entries.length) batchOffset = 0;
  const toProcess = entries.slice(batchOffset, batchOffset + BATCH_SIZE);
  batchOffset += BATCH_SIZE;
  let computed = 0;

  for (const entry of toProcess) {
    try {
      const firId = entry.feature.properties.id;
      const health = computeFIRHealth(firId);
      insertHealthSnapshot(health);
      latestHealth.set(firId, health);
      computed++;
    } catch (err) {
      // Skip individual FIR failures
    }
  }

  if (computed > 0) {
    console.log(`[health] Computed health for ${computed} FIRs`);
  }
}

export function startHealthPoller(): void {
  console.log('[health] Starting periodic health computation');
  // Run once immediately
  pollOnce();
  timer = setInterval(pollOnce, POLL_INTERVAL);
}

export function stopHealthPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Return cached health for a single FIR, or compute on-demand if not yet cached. */
export function getHealthOrCompute(firId: string) {
  return latestHealth.get(firId) ?? computeFIRHealth(firId);
}

/** Return cached/computed health for multiple FIRs. */
export function getHealthMulti(firIds: string[]) {
  return firIds.map((id) => getHealthOrCompute(id));
}
