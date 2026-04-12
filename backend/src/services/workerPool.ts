// ===== Worker Pool =====
//
// Manages a pool of worker_threads that share a common SharedArrayBuffer.
// Tasks are dispatched round-robin. Each worker writes numeric flight data
// into the shared buffer at non-overlapping slot ranges, while string
// metadata is returned via the standard MessagePort channel.

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { ADSBFlight } from '../types.js';
import {
  SLOT_SIZE_U32,
  BUFFER_SIZE_BYTES,
  FLAG_WRITTEN,
  FLAG_ON_GROUND,
  readFloat64,
  decodeI32,
  decodeSource,
  decodeType,
  ABSENT_U32,
  ABSENT_I32,
} from './sharedProtocol.js';

// ── Types ──

interface WorkerTask {
  id: number;
  resolve: (flights: ADSBFlight[]) => void;
  reject: (err: Error) => void;
}

interface WorkerEntry {
  worker: Worker;
  busy: boolean;
}

interface WorkerResult {
  id: number;
  count: number;
  metas: Array<{
    index: number;
    icao24: string;
    callsign: string;
    registration: string;
    aircraftType: string;
    squawk: string;
    category: string;
    sourceStr: 'adsb' | 'mlat' | 'other';
    typeStr: 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
    positionSource?: 'adsb' | 'mlat' | 'other';
    lastPositionAgeSec?: number;
  }>;
  error?: string;
}

// ── Pool ──

export class WorkerPool {
  private workers: WorkerEntry[] = [];
  private sharedBuffer: SharedArrayBuffer;
  private u32: Uint32Array;
  private taskId = 0;
  private pendingTasks = new Map<number, WorkerTask>();
  private roundRobin = 0;
  private workerPath: string;

  constructor(poolSize: number = Math.max(2, Math.min(4, (globalThis as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 4))) {
    // Allocate shared memory — one large buffer shared by all workers
    this.sharedBuffer = new SharedArrayBuffer(BUFFER_SIZE_BYTES);
    this.u32 = new Uint32Array(this.sharedBuffer);

    // Resolve worker script path relative to this module
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    this.workerPath = resolve(thisDir, 'normalizeWorker.ts');

    // Spin up workers
    for (let i = 0; i < poolSize; i++) {
      this.spawnWorker();
    }
  }

  private spawnWorker(): void {
    const worker = new Worker(this.workerPath, {
      workerData: { sharedBuffer: this.sharedBuffer },
      // tsx registers ts-node style loaders automatically when the parent
      // process was started via tsx. For production (compiled JS), the
      // workerPath will be .js and no special loader is needed.
      ...(this.workerPath.endsWith('.ts') ? { execArgv: ['--no-warnings', '--import', 'tsx/esm'] } : {}),
    });

    const entry: WorkerEntry = { worker, busy: false };

    worker.on('message', (result: WorkerResult) => {
      entry.busy = false;
      const task = this.pendingTasks.get(result.id);
      if (!task) return;
      this.pendingTasks.delete(result.id);

      if (result.error) {
        task.reject(new Error(result.error));
        return;
      }

      // Reconstruct ADSBFlight[] by reading numerics from shared buffer
      // and merging with string metadata from the message channel
      try {
        const flights = this.readFlightsFromBuffer(result.count, result.metas);
        task.resolve(flights);
      } catch (err) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    worker.on('error', (err: Error) => {
      console.error('[WorkerPool] Worker error:', err.message);
      // Reject all pending tasks for this worker
      for (const [id, task] of this.pendingTasks) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
        this.pendingTasks.delete(id);
      }
      // Replace dead worker
      const idx = this.workers.indexOf(entry);
      if (idx !== -1) {
        this.workers.splice(idx, 1);
        this.spawnWorker();
      }
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        console.warn(`[WorkerPool] Worker exited with code ${code}, respawning...`);
        const idx = this.workers.indexOf(entry);
        if (idx !== -1) {
          this.workers.splice(idx, 1);
          this.spawnWorker();
        }
      }
    });

    this.workers.push(entry);
  }

  /**
   * Submit a normalization task to the pool.
   * Returns the fully-assembled ADSBFlight[] array.
   */
  async normalize(
    format: 'readsb' | 'opensky',
    payload: unknown,
  ): Promise<ADSBFlight[]> {
    const id = ++this.taskId;

    return new Promise<ADSBFlight[]>((resolve, reject) => {
      this.pendingTasks.set(id, { id, resolve, reject });

      // Round-robin to next available worker (or just round-robin if all busy)
      const startIdx = this.roundRobin;
      let worker: WorkerEntry | undefined;

      for (let i = 0; i < this.workers.length; i++) {
        const idx = (startIdx + i) % this.workers.length;
        if (!this.workers[idx].busy) {
          worker = this.workers[idx];
          this.roundRobin = (idx + 1) % this.workers.length;
          break;
        }
      }

      // If all workers are busy, queue on the next worker anyway (it will process sequentially)
      if (!worker) {
        worker = this.workers[this.roundRobin];
        this.roundRobin = (this.roundRobin + 1) % this.workers.length;
      }

      worker.busy = true;
      worker.worker.postMessage({ id, format, payload });
    });
  }

  /**
   * Read numeric fields from shared buffer and merge with string metadata
   * to reconstruct a full ADSBFlight[].
   */
  private readFlightsFromBuffer(count: number, metas: WorkerResult['metas']): ADSBFlight[] {
    const flights: ADSBFlight[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const meta = metas[i];
      const base = meta.index * SLOT_SIZE_U32;

      const flags = this.u32[base + 0];
      if (!(flags & FLAG_WRITTEN)) continue; // should not happen, but guard

      const latitude   = readFloat64(this.u32, base + 1);
      const longitude  = readFloat64(this.u32, base + 3);
      const altitude   = decodeI32(this.u32[base + 5]);
      const heading    = this.u32[base + 6] / 100;
      const groundSpeed = this.u32[base + 7] / 100;
      const verticalRate = decodeI32(this.u32[base + 8]);
      const lastSeen   = this.u32[base + 9];
      const tsLo       = this.u32[base + 10];
      const tsHi       = this.u32[base + 11];
      const timestamp  = tsHi * 0x100000000 + tsLo;
      const isOnGround = !!(flags & FLAG_ON_GROUND);
      const source     = decodeSource((flags >>> 4) & 0xF);
      const type       = decodeType((flags >>> 8) & 0xF);

      // Optional met data
      const windDirRaw = this.u32[base + 12];
      const windSpdRaw = this.u32[base + 13];
      const oatRaw     = this.u32[base + 14];
      const tatRaw     = this.u32[base + 15];
      const qnhRaw     = this.u32[base + 16];
      const seenPosRaw = this.u32[base + 17];

      const hasMet = windDirRaw !== ABSENT_U32 || windSpdRaw !== ABSENT_U32 ||
                     oatRaw !== (ABSENT_I32 >>> 0) || tatRaw !== (ABSENT_I32 >>> 0) ||
                     qnhRaw !== ABSENT_U32;

      const met = hasMet
        ? {
            windDirectionDeg: windDirRaw !== ABSENT_U32 ? windDirRaw / 100 : undefined,
            windSpeedKt: windSpdRaw !== ABSENT_U32 ? windSpdRaw / 100 : undefined,
            oatC: oatRaw !== (ABSENT_I32 >>> 0) ? decodeI32(oatRaw) / 100 : undefined,
            tatC: tatRaw !== (ABSENT_I32 >>> 0) ? decodeI32(tatRaw) / 100 : undefined,
            qnhHpa: qnhRaw !== ABSENT_U32 ? qnhRaw / 100 : undefined,
          }
        : undefined;

      const navQuality = {
        positionSource: meta.positionSource ?? source,
        lastPositionAgeSec: seenPosRaw !== ABSENT_U32 ? seenPosRaw / 100 : undefined,
      };

      flights[i] = {
        icao24: meta.icao24,
        callsign: meta.callsign,
        registration: meta.registration,
        aircraftType: meta.aircraftType,
        latitude,
        longitude,
        altitude,
        heading,
        groundSpeed,
        verticalRate,
        squawk: meta.squawk,
        source,
        category: meta.category,
        isOnGround,
        lastSeen,
        timestamp,
        type,
        trail: [],
        navQuality,
        met,
      };
    }

    return flights;
  }

  /**
   * Gracefully shut down all workers.
   */
  async shutdown(): Promise<void> {
    const terminatePromises = this.workers.map((entry) => entry.worker.terminate());
    await Promise.all(terminatePromises);
    this.workers = [];
    this.pendingTasks.clear();
    console.log('[WorkerPool] All workers terminated');
  }

  /** Number of workers in the pool */
  get size(): number {
    return this.workers.length;
  }

  /** Number of pending tasks */
  get pending(): number {
    return this.pendingTasks.size;
  }
}
