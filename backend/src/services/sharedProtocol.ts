// ===== Shared Memory Binary Protocol =====
//
// Each aircraft slot occupies SLOT_SIZE_U32 uint32 entries in the shared buffer.
// Float64 values (lat, lon) occupy 2 × uint32 each (8 bytes) and are accessed
// via a Float64Array view aligned on the same backing buffer.
//
// Layout per slot (in Uint32 indices relative to slot start):
//   [0]      flags        — bit 0: written, bit 1: isOnGround, bits 4-7: source enum, bits 8-11: type enum
//   [1]      latitude_lo  — lower 32 bits of Float64
//   [2]      latitude_hi  — upper 32 bits of Float64
//   [3]      longitude_lo
//   [4]      longitude_hi
//   [5]      altitude     — int32 (feet MSL)
//   [6]      heading      — float32 encoded as uint32 (degrees × 100)
//   [7]      groundSpeed  — uint32 (knots × 100)
//   [8]      verticalRate — int32 (ft/min, stored as uint32 via twos-complement)
//   [9]      lastSeen     — uint32 (seconds)
//   [10]     timestamp_lo — lower 32 bits of epoch ms
//   [11]     timestamp_hi — upper 32 bits of epoch ms
//   [12]     windDir      — uint32 (degrees × 100, 0xFFFFFFFF = absent)
//   [13]     windSpd      — uint32 (knots × 100, 0xFFFFFFFF = absent)
//   [14]     oatC         — int32 (×100, 0x7FFFFFFF = absent)
//   [15]     tatC         — int32 (×100, 0x7FFFFFFF = absent)
//   [16]     qnhHpa       — uint32 (×100, 0xFFFFFFFF = absent)
//   [17]     seenPos      — uint32 (×100, 0xFFFFFFFF = absent)

export const SLOT_SIZE_U32 = 18;

// Maximum aircraft per batch — 65,536 slots ≈ 4.7 MB shared buffer
export const MAX_SLOTS = 65_536;

// Total buffer size in bytes
export const BUFFER_SIZE_BYTES = MAX_SLOTS * SLOT_SIZE_U32 * 4;

// Flag bits
export const FLAG_WRITTEN     = 1 << 0;
export const FLAG_ON_GROUND   = 1 << 1;

// Source enum packed into bits 4-7
export const SOURCE_ADSB  = 0;
export const SOURCE_MLAT  = 1;
export const SOURCE_OTHER = 2;

// Type enum packed into bits 8-11
export const TYPE_AIRLINE    = 0;
export const TYPE_PRIVATE    = 1;
export const TYPE_CARGO      = 2;
export const TYPE_MILITARY   = 3;
export const TYPE_GROUND     = 4;
export const TYPE_HELICOPTER = 5;

// Sentinel values for "absent" optional fields
export const ABSENT_U32 = 0xFFFFFFFF;
export const ABSENT_I32 = 0x7FFFFFFF;

// ── Encoding helpers ──

export function encodeSource(s: 'adsb' | 'mlat' | 'other'): number {
  switch (s) {
    case 'adsb':  return SOURCE_ADSB;
    case 'mlat':  return SOURCE_MLAT;
    default:      return SOURCE_OTHER;
  }
}

export function decodeSource(bits: number): 'adsb' | 'mlat' | 'other' {
  switch (bits) {
    case SOURCE_ADSB:  return 'adsb';
    case SOURCE_MLAT:  return 'mlat';
    default:           return 'other';
  }
}

export function encodeType(t: string): number {
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

export function decodeType(bits: number): 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter' {
  switch (bits) {
    case TYPE_AIRLINE:    return 'airline';
    case TYPE_PRIVATE:    return 'private';
    case TYPE_CARGO:      return 'cargo';
    case TYPE_MILITARY:   return 'military';
    case TYPE_GROUND:     return 'ground';
    case TYPE_HELICOPTER: return 'helicopter';
    default:              return 'airline';
  }
}

/** Pack flags into a single uint32 */
export function packFlags(
  isOnGround: boolean,
  source: 'adsb' | 'mlat' | 'other',
  type: string,
): number {
  let flags = FLAG_WRITTEN;
  if (isOnGround) flags |= FLAG_ON_GROUND;
  flags |= (encodeSource(source) & 0xF) << 4;
  flags |= (encodeType(type) & 0xF) << 8;
  return flags;
}

/** Write a float64 into two consecutive uint32 slots */
export function writeFloat64(u32: Uint32Array, offset: number, value: number): void {
  const f64 = new Float64Array(1);
  f64[0] = value;
  const asU32 = new Uint32Array(f64.buffer);
  u32[offset]     = asU32[0];
  u32[offset + 1] = asU32[1];
}

/** Read a float64 from two consecutive uint32 slots */
export function readFloat64(u32: Uint32Array, offset: number): number {
  const asU32 = new Uint32Array(2);
  asU32[0] = u32[offset];
  asU32[1] = u32[offset + 1];
  return new Float64Array(asU32.buffer)[0];
}

/** Encode a signed int32 as uint32 for storage */
export function encodeI32(v: number): number {
  return (v | 0) >>> 0;
}

/** Decode a uint32 back to signed int32 */
export function decodeI32(v: number): number {
  return v | 0;
}
