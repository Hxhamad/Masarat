import type { ADSBFlight, ReadsBAircraft, ReadsBResponse, OpenSkyResponse, OpenSkyStateVector } from '../types.js';
import { WorkerPool } from './workerPool.js';

// ===== Worker Pool Singleton =====
//
// Lazy-initialized on first async call. The pool is shared across
// all aggregator sources and reused for the lifetime of the process.

let pool: WorkerPool | null = null;

function getPool(): WorkerPool {
  if (!pool) {
    pool = new WorkerPool();
    console.log(`[normalizer] WorkerPool initialized with ${pool.size} threads`);
  }
  return pool;
}

/**
 * Gracefully tear down the worker pool.
 * Called during server shutdown.
 */
export async function shutdownNormalizerPool(): Promise<void> {
  if (pool) {
    await pool.shutdown();
    pool = null;
  }
}

// ===== Async Normalization (Worker-Thread Based) =====
//
// These are the primary entry points used by adsbAggregator.ts.
// They dispatch raw JSON payloads to worker threads, which write
// numeric fields into SharedArrayBuffer and return string metadata
// via MessagePort — completely bypassing JSON serialization overhead
// for the hot numeric path.

/**
 * Normalize a ReadsB response payload using worker threads.
 * The event loop remains unblocked during the 50,000-object spike.
 */
export async function normalizeReadsBAsync(response: unknown): Promise<ADSBFlight[]> {
  if (!isReadsBResponse(response)) return [];
  return getPool().normalize('readsb', response);
}

/**
 * Normalize an OpenSky response payload using worker threads.
 */
export async function normalizeOpenSkyAsync(response: unknown): Promise<ADSBFlight[]> {
  if (!isOpenSkyResponse(response)) return [];
  if (!response.states || !Array.isArray(response.states)) return [];
  return getPool().normalize('opensky', response);
}

// ===== Synchronous Normalization (Original — preserved for tests & fallback) =====

// ===== Safe number coercion =====

function toFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

// ===== Upstream payload guards =====

function isReadsBResponse(d: unknown): d is ReadsBResponse {
  return d != null && typeof d === 'object' && Array.isArray((d as Record<string, unknown>).ac);
}

function isOpenSkyResponse(d: unknown): d is OpenSkyResponse {
  if (d == null || typeof d !== 'object') return false;
  const r = d as Record<string, unknown>;
  return r.states === null || Array.isArray(r.states);
}

// ===== readsb v2 Normalizer (adsb.lol + airplanes.live) =====

function classifyAircraftType(ac: ReadsBAircraft): ADSBFlight['type'] {
  if (ac.alt_baro === 'ground' || ac.alt_baro === 0) return 'ground';
  if (ac.dbFlags && (ac.dbFlags & 1)) return 'military';
  // Heuristic: cargo carriers often have specific callsign prefixes
  const cs = (ac.flight || '').trim().toUpperCase();
  if (/^(FDX|UPS|GTI|CLX|BOX|ABW)/.test(cs)) return 'cargo';
  // Most remaining are airline; private jets are harder to classify without enrichment  
  if (ac.category && ac.category.startsWith('A') && parseInt(ac.category[1]) <= 1) return 'private';
  return 'airline';
}

function classifySource(ac: ReadsBAircraft): ADSBFlight['source'] {
  const t = ac.type || '';
  if (t.includes('mlat')) return 'mlat';
  if (t.includes('adsb') || t.includes('adsr') || t.includes('adsc')) return 'adsb';
  return 'other';
}

export function normalizeReadsB(response: unknown): ADSBFlight[] {
  if (!isReadsBResponse(response)) return [];
  
  const now = response.now || Date.now();
  const flights: ADSBFlight[] = [];

  for (const ac of response.ac) {
    if (ac == null || typeof ac !== 'object') continue;
    // Skip aircraft without valid position
    if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
    if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
    // Skip invalid hex
    if (!ac.hex || typeof ac.hex !== 'string' || ac.hex.startsWith('~')) continue;

    const altBaro = ac.alt_baro;
    const altitude = altBaro === 'ground' ? 0 : (typeof altBaro === 'number' ? altBaro : 0);
    const isOnGround = altBaro === 'ground' || altitude === 0;

    // Build optional onboard-met from ReadsB fields
    const met: ADSBFlight['met'] =
      (ac.wd != null || ac.ws != null || ac.oat != null || ac.tat != null || ac.nav_qnh != null)
        ? {
            windDirectionDeg: ac.wd ?? undefined,
            windSpeedKt: ac.ws ?? undefined,
            oatC: ac.oat ?? undefined,
            tatC: ac.tat ?? undefined,
            qnhHpa: ac.nav_qnh ?? undefined,
          }
        : undefined;

    // Build optional nav quality — NIC/NACp/SIL/SDA left undefined
    // until a richer upstream source is added.
    const navQuality: ADSBFlight['navQuality'] = {
      positionSource: classifySource(ac),
      lastPositionAgeSec: ac.seen_pos ?? undefined,
    };

    flights.push({
      icao24: ac.hex.toLowerCase(),
      callsign: (ac.flight || '').trim(),
      registration: ac.r || '',
      aircraftType: ac.t || '',
      latitude: ac.lat,
      longitude: ac.lon,
      altitude,
      heading: toFiniteNumber(ac.track, 0),
      groundSpeed: toFiniteNumber(ac.gs, 0),
      verticalRate: toFiniteNumber(ac.baro_rate ?? ac.geom_rate, 0),
      squawk: ac.squawk || '',
      source: classifySource(ac),
      category: ac.category || '',
      isOnGround,
      lastSeen: ac.seen ?? 0,
      timestamp: now,
      type: classifyAircraftType(ac),
      trail: [], // Trails populated from cache/DB
      navQuality,
      met,
    });
  }

  return flights;
}

// ===== OpenSky Normalizer (Fallback) =====

export function normalizeOpenSky(response: unknown): ADSBFlight[] {
  if (!isOpenSkyResponse(response)) return [];
  if (!response.states || !Array.isArray(response.states)) return [];

  const now = Date.now();
  const flights: ADSBFlight[] = [];

  for (const sv of response.states) {
    if (!Array.isArray(sv) || sv.length < 17) continue;
    const [icao24, callsign, , , , lon, lat, baroAlt, onGround, velocity, track, vertRate, , , squawk, , posSource] = sv;

    // Skip without valid position
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (typeof icao24 !== 'string') continue;

    // Convert meters to feet (baro_altitude is in meters in OpenSky)
    const altitudeFt = typeof baroAlt === 'number' && Number.isFinite(baroAlt) ? Math.round(baroAlt * 3.28084) : 0;
    // Convert m/s to knots
    const speedKt = typeof velocity === 'number' && Number.isFinite(velocity) ? Math.round(velocity * 1.94384) : 0;
    // Convert m/s to ft/min
    const vRateFpm = typeof vertRate === 'number' && Number.isFinite(vertRate) ? Math.round(vertRate * 196.85) : 0;

    const source: ADSBFlight['source'] = posSource === 2 ? 'mlat' : posSource === 0 ? 'adsb' : 'other';

    flights.push({
      icao24: icao24.toLowerCase(),
      callsign: (callsign || '').trim(),
      registration: '',
      aircraftType: '',
      latitude: lat,
      longitude: lon,
      altitude: onGround ? 0 : altitudeFt,
      heading: typeof track === 'number' && Number.isFinite(track) ? track : 0,
      groundSpeed: speedKt,
      verticalRate: vRateFpm,
      squawk: squawk || '',
      source,
      category: '',
      isOnGround: onGround,
      lastSeen: 0,
      timestamp: now,
      type: onGround ? 'ground' : 'airline',
      trail: [],
    });
  }

  return flights;
}
