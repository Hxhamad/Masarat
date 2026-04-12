import type { ADSBFlight, AggregatorStats } from '../types.js';
import { normalizeReadsBAsync, normalizeOpenSkyAsync, shutdownNormalizerPool } from './normalizer.js';
import { flightCache } from './cache.js';
import { insertTrailPoint } from '../db/sqlite.js';
import { spatialIndex } from './h3SpatialIndex.js';

type DataSource = 'adsb-lol' | 'airplanes-live' | 'opensky';

interface SourceConfig {
  name: DataSource;
  url: string;
  normalize: (data: unknown) => Promise<ADSBFlight[]>;
  rateLimit: number; // ms between requests
}

const sources: SourceConfig[] = [
  {
    name: 'adsb-lol',
    url: 'https://api.adsb.lol/v2/lat/0/lon/0/dist/20000',
    normalize: (d) => normalizeReadsBAsync(d),
    rateLimit: 8_000,
  },
  {
    name: 'airplanes-live',
    url: 'https://api.airplanes.live/v2/point/46/2/1200',
    normalize: (d) => normalizeReadsBAsync(d),
    rateLimit: 4_000,
  },
  {
    name: 'opensky',
    url: 'https://opensky-network.org/api/states/all',
    normalize: (d) => normalizeOpenSkyAsync(d),
    rateLimit: 12_000,
  },
];

let activeSourceIndex = 0;
let lastFetchTime = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let onUpdate: ((flights: ADSBFlight[], removed: string[]) => void) | null = null;

const stats: AggregatorStats = {
  totalFlights: 0,
  dataSource: 'adsb-lol',
  lastUpdate: 0,
  messagesPerSecond: 0,
};

let messageCount = 0;
let mpsWindowStart = Date.now();

const POSITION_CHANGE_THRESHOLD_DEG = 0.001;
const ALTITUDE_CHANGE_THRESHOLD_FT = 100;
const SPEED_CHANGE_THRESHOLD_KT = 5;
const HEADING_CHANGE_THRESHOLD_DEG = 3;
const VERTICAL_RATE_CHANGE_THRESHOLD_FPM = 250;
const LAST_SEEN_CHANGE_THRESHOLD_SEC = 15;
const MAX_TRAIL_POINTS = 60;

// Operational metrics (cumulative)
let totalFlightsProcessed = 0;
let totalErrors = 0;
const startTime = Date.now();

function headingDelta(prevHeading: number, nextHeading: number): number {
  const rawDelta = Math.abs(prevHeading - nextHeading) % 360;
  return rawDelta > 180 ? 360 - rawDelta : rawDelta;
}

function hasPositionChange(existing: ADSBFlight | undefined, incoming: ADSBFlight): boolean {
  if (!existing) return true;

  return (
    Math.abs(existing.latitude - incoming.latitude) > POSITION_CHANGE_THRESHOLD_DEG ||
    Math.abs(existing.longitude - incoming.longitude) > POSITION_CHANGE_THRESHOLD_DEG
  );
}

function appendTrailPoint(existingTrail: ADSBFlight['trail'], flight: ADSBFlight): ADSBFlight['trail'] {
  const lastPoint = existingTrail[existingTrail.length - 1];
  const nextPoint = {
    lat: flight.latitude,
    lon: flight.longitude,
    alt: flight.altitude,
    ts: flight.timestamp,
  };

  if (
    lastPoint &&
    Math.abs(lastPoint.lat - nextPoint.lat) <= POSITION_CHANGE_THRESHOLD_DEG &&
    Math.abs(lastPoint.lon - nextPoint.lon) <= POSITION_CHANGE_THRESHOLD_DEG &&
    Math.abs(lastPoint.alt - nextPoint.alt) < ALTITUDE_CHANGE_THRESHOLD_FT
  ) {
    return existingTrail;
  }

  const nextTrail =
    existingTrail.length >= MAX_TRAIL_POINTS
      ? existingTrail.slice(existingTrail.length - MAX_TRAIL_POINTS + 1)
      : existingTrail.slice();

  nextTrail.push(nextPoint);
  return nextTrail;
}

function navQualityChanged(existing: ADSBFlight['navQuality'], incoming: ADSBFlight['navQuality']): boolean {
  return (
    existing?.nic !== incoming?.nic ||
    existing?.nacp !== incoming?.nacp ||
    existing?.sil !== incoming?.sil ||
    existing?.sda !== incoming?.sda ||
    existing?.positionSource !== incoming?.positionSource ||
    existing?.lastPositionAgeSec !== incoming?.lastPositionAgeSec ||
    existing?.sourceFeed !== incoming?.sourceFeed
  );
}

function metChanged(existing: ADSBFlight['met'], incoming: ADSBFlight['met']): boolean {
  return (
    existing?.windDirectionDeg !== incoming?.windDirectionDeg ||
    existing?.windSpeedKt !== incoming?.windSpeedKt ||
    existing?.oatC !== incoming?.oatC ||
    existing?.tatC !== incoming?.tatC ||
    existing?.qnhHpa !== incoming?.qnhHpa
  );
}

function hasMeaningfulFlightChange(existing: ADSBFlight | undefined, incoming: ADSBFlight): boolean {
  if (!existing) return true;

  return (
    Math.abs(existing.latitude - incoming.latitude) > POSITION_CHANGE_THRESHOLD_DEG ||
    Math.abs(existing.longitude - incoming.longitude) > POSITION_CHANGE_THRESHOLD_DEG ||
    Math.abs(existing.altitude - incoming.altitude) >= ALTITUDE_CHANGE_THRESHOLD_FT ||
    Math.abs(existing.groundSpeed - incoming.groundSpeed) >= SPEED_CHANGE_THRESHOLD_KT ||
    Math.abs(existing.verticalRate - incoming.verticalRate) >= VERTICAL_RATE_CHANGE_THRESHOLD_FPM ||
    headingDelta(existing.heading, incoming.heading) >= HEADING_CHANGE_THRESHOLD_DEG ||
    Math.abs(existing.lastSeen - incoming.lastSeen) >= LAST_SEEN_CHANGE_THRESHOLD_SEC ||
    existing.callsign !== incoming.callsign ||
    existing.registration !== incoming.registration ||
    existing.aircraftType !== incoming.aircraftType ||
    existing.squawk !== incoming.squawk ||
    existing.source !== incoming.source ||
    existing.category !== incoming.category ||
    existing.isOnGround !== incoming.isOnGround ||
    existing.type !== incoming.type ||
    navQualityChanged(existing.navQuality, incoming.navQuality) ||
    metChanged(existing.met, incoming.met)
  );
}

export function getOperationalMetrics() {
  return {
    uptimeMs: Date.now() - startTime,
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    totalFlightsProcessed,
    totalErrors,
    activeSource: stats.dataSource,
    lastUpdate: stats.lastUpdate,
    messagesPerSecond: stats.messagesPerSecond,
    currentFlightsInCache: stats.totalFlights,
  };
}

export function getStats(): AggregatorStats {
  return { ...stats };
}

export function setUpdateCallback(cb: (flights: ADSBFlight[], removed: string[]) => void): void {
  onUpdate = cb;
}

function applySnapshot(sourceName: DataSource, flights: ADSBFlight[]): void {
  const changedFlights: ADSBFlight[] = [];

  // Update cache
  for (const f of flights) {
    const existing = flightCache.get(f.icao24);
    const existingTrail = existing?.trail ?? [];
    const positionChanged = hasPositionChange(existing, f);
    const shouldBroadcast = hasMeaningfulFlightChange(existing, f);

    if (positionChanged) {
      f.trail = appendTrailPoint(existingTrail, f);
      insertTrailPoint(f.icao24, f.latitude, f.longitude, f.altitude, f.timestamp);
    } else if (existingTrail.length > 0) {
      f.trail = existingTrail;
    }

    flightCache.set(f);

    // Update H3 spatial index for this flight's current position
    spatialIndex.update(f.icao24, f.latitude, f.longitude);

    if (shouldBroadcast) {
      changedFlights.push(f);
    }
  }

  const removed = flightCache.evictStale();

  // Remove evicted flights from the spatial index
  if (removed.length > 0) {
    spatialIndex.removeBatch(removed);
  }

  stats.totalFlights = flightCache.size;
  stats.dataSource = sourceName;
  stats.lastUpdate = Date.now();
  messageCount += flights.length;
  totalFlightsProcessed += flights.length;

  const mpsElapsed = (Date.now() - mpsWindowStart) / 1000;
  if (mpsElapsed >= 5) {
    stats.messagesPerSecond = Math.round(messageCount / mpsElapsed);
    messageCount = 0;
    mpsWindowStart = Date.now();
  }

  if (onUpdate) onUpdate(changedFlights, removed);
}

async function primeInitialSnapshot(): Promise<void> {
  const bootstrapSource = sources.find((source) => source.name === 'opensky');
  if (!bootstrapSource) return;

  try {
    const flights = await fetchFromSource(bootstrapSource);
    applySnapshot(bootstrapSource.name, flights);
    console.log(`[aggregator] Primed cache with ${flights.length} flights from ${bootstrapSource.name}`);
  } catch (err) {
    console.warn(`[aggregator] Initial prime failed for ${bootstrapSource.name}:`, (err as Error).message);
  }
}

async function fetchFromSource(source: SourceConfig): Promise<ADSBFlight[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return await source.normalize(data);
  } finally {
    clearTimeout(timeout);
  }
}

async function poll(): Promise<void> {
  const source = sources[activeSourceIndex];
  const now = Date.now();

  // Respect rate limit
  const elapsed = now - lastFetchTime;
  if (elapsed < source.rateLimit) {
    schedulePoll(source.rateLimit - elapsed);
    return;
  }

  try {
    const flights = await fetchFromSource(source);
    lastFetchTime = Date.now();
    applySnapshot(source.name, flights);

    // Reset to primary on success if we were on fallback
    if (activeSourceIndex > 0) {
      // Try primary again after 60s
      setTimeout(() => { activeSourceIndex = 0; }, 60_000);
    }

    schedulePoll(source.rateLimit);
  } catch (err) {
    console.error(`[aggregator] ${source.name} failed:`, (err as Error).message);
    totalErrors++;
    // Failover to next source
    activeSourceIndex = (activeSourceIndex + 1) % sources.length;
    console.log(`[aggregator] Switching to ${sources[activeSourceIndex].name}`);
    schedulePoll(1_000); // Retry quickly with new source
  }
}

function schedulePoll(delay: number): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, delay);
}

export async function startAggregator(): Promise<void> {
  console.log(`[aggregator] Starting with primary source: ${sources[0].name}`);
  await primeInitialSnapshot();
  poll();
}

export async function stopAggregator(): Promise<void> {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  await shutdownNormalizerPool();
  console.log('[aggregator] Stopped');
}
