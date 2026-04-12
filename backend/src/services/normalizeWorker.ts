import { parentPort, workerData } from 'node:worker_threads';

// ── Inlined shared protocol constants (avoids ESM .js import issues in worker threads) ──

const SLOT_SIZE_U32 = 18;
const FLAG_WRITTEN     = 1 << 0;
const FLAG_ON_GROUND   = 1 << 1;
const SOURCE_ADSB  = 0;
const SOURCE_MLAT  = 1;
const SOURCE_OTHER = 2;
const TYPE_AIRLINE    = 0;
const TYPE_PRIVATE    = 1;
const TYPE_CARGO      = 2;
const TYPE_MILITARY   = 3;
const TYPE_GROUND     = 4;
const TYPE_HELICOPTER = 5;
const ABSENT_U32 = 0xFFFFFFFF;
const ABSENT_I32 = 0x7FFFFFFF;

function encodeSource(s: 'adsb' | 'mlat' | 'other'): number {
  return s === 'adsb' ? SOURCE_ADSB : s === 'mlat' ? SOURCE_MLAT : SOURCE_OTHER;
}

function encodeType(t: string): number {
  switch (t) {
    case 'airline':    return TYPE_AIRLINE;
    case 'private':    return TYPE_PRIVATE;
    case 'cargo':      return TYPE_CARGO;
    case 'military':   return TYPE_MILITARY;
    case 'ground':     return TYPE_GROUND;
    case 'helicopter': return TYPE_HELICOPTER;
    default:           return TYPE_AIRLINE;
  }
}

function packFlags(isOnGround: boolean, source: 'adsb' | 'mlat' | 'other', type: string): number {
  let flags = FLAG_WRITTEN;
  if (isOnGround) flags |= FLAG_ON_GROUND;
  flags |= (encodeSource(source) & 0xF) << 4;
  flags |= (encodeType(type) & 0xF) << 8;
  return flags;
}

function writeFloat64(u32: Uint32Array, offset: number, value: number): void {
  const f64 = new Float64Array(1);
  f64[0] = value;
  const asU32 = new Uint32Array(f64.buffer);
  u32[offset]     = asU32[0];
  u32[offset + 1] = asU32[1];
}

function encodeI32(v: number): number {
  return (v | 0) >>> 0;
}

// ── Types inlined to avoid import resolution issues in workers ──

interface ReadsBAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  lat?: number;
  lon?: number;
  seen?: number;
  seen_pos?: number;
  messages?: number;
  category?: string;
  dbFlags?: number;
  emergency?: string;
  nav_qnh?: number;
  wd?: number;
  ws?: number;
  oat?: number;
  tat?: number;
  [key: string]: unknown;
}

interface ReadsBResponse {
  ac: ReadsBAircraft[];
  now: number;
  [key: string]: unknown;
}

type OpenSkyStateVector = unknown[];

interface OpenSkyResponse {
  time: number;
  states: OpenSkyStateVector[] | null;
}

interface StringMeta {
  index: number;           // slot index in the shared buffer
  icao24: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  squawk: string;
  category: string;
  sourceStr: 'adsb' | 'mlat' | 'other';
  typeStr: 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
  // Optional meteorological / nav quality
  positionSource?: 'adsb' | 'mlat' | 'other';
  lastPositionAgeSec?: number;
}

// ── Shared buffer from workerData ──

const sharedBuffer: SharedArrayBuffer = workerData.sharedBuffer;
const u32 = new Uint32Array(sharedBuffer);

// ── Classification helpers (same logic as original normalizer) ──

function toFiniteNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return fallback;
}

function classifyAircraftType(ac: ReadsBAircraft): 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter' {
  if (ac.alt_baro === 'ground' || ac.alt_baro === 0) return 'ground';
  if (ac.dbFlags && (ac.dbFlags & 1)) return 'military';
  const cs = (ac.flight || '').trim().toUpperCase();
  if (/^(FDX|UPS|GTI|CLX|BOX|ABW)/.test(cs)) return 'cargo';
  if (ac.category && ac.category.startsWith('A') && parseInt(ac.category[1]) <= 1) return 'private';
  return 'airline';
}

function classifySource(ac: ReadsBAircraft): 'adsb' | 'mlat' | 'other' {
  const t = ac.type || '';
  if (t.includes('mlat')) return 'mlat';
  if (t.includes('adsb') || t.includes('adsr') || t.includes('adsc')) return 'adsb';
  return 'other';
}

// ── ReadsB normalization → shared buffer ──

function processReadsB(response: ReadsBResponse): StringMeta[] {
  const now = response.now || Date.now();
  const metas: StringMeta[] = [];
  let slotIdx = 0;

  for (const ac of response.ac) {
    if (ac == null || typeof ac !== 'object') continue;
    if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
    if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
    if (!ac.hex || typeof ac.hex !== 'string' || ac.hex.startsWith('~')) continue;

    const altBaro = ac.alt_baro;
    const altitude = altBaro === 'ground' ? 0 : (typeof altBaro === 'number' ? altBaro : 0);
    const isOnGround = altBaro === 'ground' || altitude === 0;
    const source = classifySource(ac);
    const type = classifyAircraftType(ac);

    const base = slotIdx * SLOT_SIZE_U32;

    // [0] flags
    u32[base + 0] = packFlags(isOnGround, source, type);

    // [1-2] latitude (float64)
    writeFloat64(u32, base + 1, ac.lat);

    // [3-4] longitude (float64)
    writeFloat64(u32, base + 3, ac.lon);

    // [5] altitude (i32)
    u32[base + 5] = encodeI32(altitude);

    // [6] heading (×100)
    u32[base + 6] = Math.round(toFiniteNumber(ac.track, 0) * 100) >>> 0;

    // [7] groundSpeed (×100)
    u32[base + 7] = Math.round(toFiniteNumber(ac.gs, 0) * 100) >>> 0;

    // [8] verticalRate (i32)
    u32[base + 8] = encodeI32(Math.round(toFiniteNumber(ac.baro_rate ?? ac.geom_rate, 0)));

    // [9] lastSeen
    u32[base + 9] = (ac.seen ?? 0) >>> 0;

    // [10-11] timestamp (uint64 split)
    u32[base + 10] = now >>> 0;
    u32[base + 11] = (now / 0x100000000) >>> 0;

    // [12] windDir (×100 or ABSENT)
    u32[base + 12] = ac.wd != null ? Math.round(ac.wd * 100) >>> 0 : ABSENT_U32;

    // [13] windSpd (×100 or ABSENT)
    u32[base + 13] = ac.ws != null ? Math.round(ac.ws * 100) >>> 0 : ABSENT_U32;

    // [14] oatC (×100 or ABSENT)
    u32[base + 14] = ac.oat != null ? encodeI32(Math.round(ac.oat * 100)) : ABSENT_I32 >>> 0;

    // [15] tatC (×100 or ABSENT)
    u32[base + 15] = ac.tat != null ? encodeI32(Math.round(ac.tat * 100)) : ABSENT_I32 >>> 0;

    // [16] qnhHpa (×100 or ABSENT)
    u32[base + 16] = ac.nav_qnh != null ? Math.round(ac.nav_qnh * 100) >>> 0 : ABSENT_U32;

    // [17] seenPos (×100 or ABSENT)
    u32[base + 17] = ac.seen_pos != null ? Math.round(ac.seen_pos * 100) >>> 0 : ABSENT_U32;

    metas.push({
      index: slotIdx,
      icao24: ac.hex.toLowerCase(),
      callsign: (ac.flight || '').trim(),
      registration: ac.r || '',
      aircraftType: ac.t || '',
      squawk: ac.squawk || '',
      category: ac.category || '',
      sourceStr: source,
      typeStr: type,
      positionSource: source,
      lastPositionAgeSec: ac.seen_pos ?? undefined,
    });

    slotIdx++;
  }

  return metas;
}

// ── OpenSky normalization → shared buffer ──

function processOpenSky(response: OpenSkyResponse): StringMeta[] {
  if (!response.states || !Array.isArray(response.states)) return [];

  const now = Date.now();
  const metas: StringMeta[] = [];
  let slotIdx = 0;

  for (const sv of response.states) {
    if (!Array.isArray(sv) || sv.length < 17) continue;

    const [icao24, callsign, , , , lon, lat, baroAlt, onGround, velocity, track, vertRate, , , squawk, , posSource] = sv;

    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (typeof icao24 !== 'string') continue;

    const altitudeFt = typeof baroAlt === 'number' && Number.isFinite(baroAlt) ? Math.round(baroAlt * 3.28084) : 0;
    const speedKt = typeof velocity === 'number' && Number.isFinite(velocity) ? Math.round(velocity * 1.94384) : 0;
    const vRateFpm = typeof vertRate === 'number' && Number.isFinite(vertRate) ? Math.round(vertRate * 196.85) : 0;
    const source: 'adsb' | 'mlat' | 'other' = posSource === 2 ? 'mlat' : posSource === 0 ? 'adsb' : 'other';
    const type = onGround ? 'ground' : 'airline';

    const base = slotIdx * SLOT_SIZE_U32;

    u32[base + 0] = packFlags(!!onGround, source, type);
    writeFloat64(u32, base + 1, lat);
    writeFloat64(u32, base + 3, lon);
    u32[base + 5] = encodeI32(onGround ? 0 : altitudeFt);
    u32[base + 6] = (typeof track === 'number' && Number.isFinite(track) ? Math.round(track * 100) : 0) >>> 0;
    u32[base + 7] = Math.round(speedKt * 100) >>> 0;
    u32[base + 8] = encodeI32(vRateFpm);
    u32[base + 9] = 0;
    u32[base + 10] = now >>> 0;
    u32[base + 11] = (now / 0x100000000) >>> 0;

    // OpenSky has no met data
    u32[base + 12] = ABSENT_U32;
    u32[base + 13] = ABSENT_U32;
    u32[base + 14] = ABSENT_I32 >>> 0;
    u32[base + 15] = ABSENT_I32 >>> 0;
    u32[base + 16] = ABSENT_U32;
    u32[base + 17] = ABSENT_U32;

    metas.push({
      index: slotIdx,
      icao24: (icao24 as string).toLowerCase(),
      callsign: ((callsign as string | null) || '').trim(),
      registration: '',
      aircraftType: '',
      squawk: (squawk as string) || '',
      category: '',
      sourceStr: source,
      typeStr: type as 'airline' | 'ground',
    });

    slotIdx++;
  }

  return metas;
}

// ── Message handler ──

if (parentPort) {
  parentPort.on('message', (msg: { id: number; format: 'readsb' | 'opensky'; payload: unknown }) => {
    try {
      // Clear the written flags in the shared buffer before processing
      // (only up to MAX_SLOTS worth to avoid full-buffer zeroing)
      const maxClear = Math.min(65_536, u32.length / SLOT_SIZE_U32);
      for (let i = 0; i < maxClear; i++) {
        u32[i * SLOT_SIZE_U32] = 0; // clear flags
      }

      let metas: StringMeta[];

      if (msg.format === 'readsb') {
        metas = processReadsB(msg.payload as ReadsBResponse);
      } else {
        metas = processOpenSky(msg.payload as OpenSkyResponse);
      }

      parentPort!.postMessage({ id: msg.id, count: metas.length, metas });
    } catch (err) {
      parentPort!.postMessage({ id: msg.id, count: 0, metas: [], error: (err as Error).message });
    }
  });
}
