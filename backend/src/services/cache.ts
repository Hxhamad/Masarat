import type { ADSBFlight } from '../types.js';

interface CacheEntry {
  flight: ADSBFlight;
  expiresAt: number;
}

const DEFAULT_TTL = 120_000; // 2 min — matches stale aircraft timeout
const MAX_SIZE = 50_000;

class FlightCache {
  private cache = new Map<string, CacheEntry>();
  private ttl: number;

  constructor(ttl = DEFAULT_TTL) {
    this.ttl = ttl;
  }

  set(flight: ADSBFlight): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_SIZE && !this.cache.has(flight.icao24)) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(flight.icao24, {
      flight,
      expiresAt: Date.now() + this.ttl,
    });
  }

  get(icao24: string): ADSBFlight | undefined {
    const entry = this.cache.get(icao24);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(icao24);
      return undefined;
    }
    return entry.flight;
  }

  getAll(): ADSBFlight[] {
    const now = Date.now();
    const results: ADSBFlight[] = [];
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      } else {
        results.push(entry.flight);
      }
    }
    return results;
  }

  getByBounds(south: number, west: number, north: number, east: number): ADSBFlight[] {
    const now = Date.now();
    const results: ADSBFlight[] = [];
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      const f = entry.flight;
      if (f.latitude >= south && f.latitude <= north &&
          f.longitude >= west && f.longitude <= east) {
        results.push(f);
      }
    }
    return results;
  }

  delete(icao24: string): boolean {
    return this.cache.delete(icao24);
  }

  /** Remove all flights whose server-set expiry has passed. Returns removed icao24s. */
  evictStale(): string[] {
    const now = Date.now();
    const removed: string[] = [];
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed.push(key);
      }
    }
    return removed;
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

export const flightCache = new FlightCache();
