/**
 * Regression: cache eviction uses server-owned expiresAt (not flight.timestamp).
 *
 * - evictStale() removes entries past their TTL
 * - Flights with timestamp=0 (upstream clock) are NOT evicted prematurely
 * - TTL is reset on each set() call
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ADSBFlight } from '../types.js';

function makeFlight(icao24: string, overrides: Partial<ADSBFlight> = {}): ADSBFlight {
  return {
    icao24,
    callsign: '',
    registration: '',
    aircraftType: '',
    latitude: 45,
    longitude: 2,
    altitude: 35000,
    heading: 180,
    groundSpeed: 450,
    verticalRate: 0,
    squawk: '1200',
    source: 'adsb',
    category: '',
    isOnGround: false,
    lastSeen: 0,
    timestamp: 0,
    type: 'airline',
    trail: [],
    ...overrides,
  };
}

// We need to import cache fresh per-test to avoid cross-test pollution.
// Since flightCache is a singleton, we clear() it in afterEach.
describe('FlightCache eviction', () => {
  let flightCache: typeof import('../services/cache.js')['flightCache'];

  // Dynamic import to pick up the module
  async function loadCache() {
    const mod = await import('../services/cache.js');
    flightCache = mod.flightCache;
    flightCache.clear();
  }

  afterEach(() => {
    flightCache?.clear();
    vi.useRealTimers();
  });

  it('evicts entries past their TTL', async () => {
    vi.useFakeTimers();
    await loadCache();

    flightCache.set(makeFlight('aaa111'));
    expect(flightCache.size).toBe(1);

    // Advance past default TTL (120s)
    vi.advanceTimersByTime(121_000);

    const removed = flightCache.evictStale();
    expect(removed).toContain('aaa111');
    expect(flightCache.size).toBe(0);
  });

  it('does NOT evict a flight with timestamp=0 before TTL expires', async () => {
    vi.useFakeTimers();
    await loadCache();

    // timestamp=0 simulates upstream clock giving epoch-zero
    flightCache.set(makeFlight('bbb222', { timestamp: 0 }));

    // Only advance 60s — well within 120s TTL
    vi.advanceTimersByTime(60_000);

    const removed = flightCache.evictStale();
    expect(removed).toHaveLength(0);
    expect(flightCache.size).toBe(1);
  });

  it('refreshes TTL on re-set', async () => {
    vi.useFakeTimers();
    await loadCache();

    flightCache.set(makeFlight('ccc333'));

    // Advance 100s (close to TTL)
    vi.advanceTimersByTime(100_000);

    // Re-set resets the TTL
    flightCache.set(makeFlight('ccc333', { altitude: 36000 }));

    // Advance another 100s — 200s total but only 100s since last set
    vi.advanceTimersByTime(100_000);

    const removed = flightCache.evictStale();
    expect(removed).toHaveLength(0);
    expect(flightCache.get('ccc333')?.altitude).toBe(36000);
  });

  it('get() returns undefined for expired entries', async () => {
    vi.useFakeTimers();
    await loadCache();

    flightCache.set(makeFlight('ddd444'));
    vi.advanceTimersByTime(121_000);

    expect(flightCache.get('ddd444')).toBeUndefined();
  });
});
