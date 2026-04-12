// ===== AircraftSnapshot Protobuf-style Binary Codec =====
//
// Zero-dependency binary serialization for WebSocket flight broadcasts.
// Isomorphic — works in both Node.js (backend) and browser (frontend).
//
// Wire format per AircraftSnapshot message:
//
//   ┌─────────────────────────────────────────────────────────────────┐
//   │ Envelope Header (8 bytes)                                      │
//   │  [0]  u8   messageType   (1=flight-update, 2=flight-remove,    │
//   │                           3=stats)                             │
//   │  [1]  u8   version       (1)                                   │
//   │  [2-3] u16  itemCount    (big-endian)                          │
//   │  [4-7] u32  timestamp    (epoch seconds, big-endian)           │
//   └─────────────────────────────────────────────────────────────────┘
//
//   For messageType=1 (flight-update), each item:
//   ┌─────────────────────────────────────────────────────────────────┐
//   │ AircraftSnapshot (fixed 40 bytes + variable string block)      │
//   │                                                                │
//   │  FIXED REGION (40 bytes):                                      │
//   │  [0-3]   i32  latitude     (degrees × 1e6, big-endian)        │
//   │  [4-7]   i32  longitude    (degrees × 1e6, big-endian)        │
//   │  [8-9]   i16  altitude     (value ÷ 25, feet/25, big-endian)  │
//   │  [10-11] u16  heading      (degrees × 10, big-endian)         │
//   │  [12-13] u16  groundSpeed  (knots, big-endian)                │
//   │  [14-15] i16  verticalRate (ft/min ÷ 10, big-endian)          │
//   │  [16-17] u16  flags        (bitfield, big-endian)             │
//   │           bit 0:     isOnGround                                │
//   │           bit 1:     isMilitary                                │
//   │           bit 2:     isCargo                                   │
//   │           bit 3:     isPrivate                                 │
//   │           bit 4:     isHelicopter                              │
//   │           bit 5:     isGround (type=ground)                   │
//   │           bits 6-7:  source (0=adsb, 1=mlat, 2=other)         │
//   │  [18-20] u24  icao24      (3 bytes, hex decoded)              │
//   │  [21]    u8   lastSeen    (seconds, clamped 0-255)            │
//   │  [22-23] u16  stringBlockLen (big-endian)                      │
//   │  [24-39] reserved / met data packed:                           │
//   │    [24-25] u16  windDir    (degrees × 10, 0xFFFF=absent)       │
//   │    [26-27] u16  windSpd    (knots × 10, 0xFFFF=absent)         │
//   │    [28-29] i16  oatC       (°C × 10, 0x7FFF=absent)            │
//   │    [30-31] i16  tatC       (°C × 10, 0x7FFF=absent)            │
//   │    [32-33] u16  qnhHpa     (hPa × 10, 0xFFFF=absent)           │
//   │    [34-37] u32  timestamp  (epoch seconds, big-endian)         │
//   │    [38-39] u16  squawkNum  (octal→decimal, 0xFFFF=absent)      │
//   │                                                                │
//   │  VARIABLE REGION (stringBlockLen bytes):                       │
//   │    Length-prefixed UTF-8 strings:                               │
//   │    [u8 len][...bytes]  callsign                                │
//   │    [u8 len][...bytes]  registration                            │
//   │    [u8 len][...bytes]  aircraftType                            │
//   │    [u8 len][...bytes]  category                                │
//   └─────────────────────────────────────────────────────────────────┘
//
//   For messageType=2 (flight-remove), each item:
//     [0-2]  u24  icao24 (3 bytes)
//
//   For messageType=3 (stats):
//     [0-3]  u32  totalFlights (big-endian)
//     [4]    u8   dataSource (0=adsb-lol, 1=airplanes-live, 2=opensky)
//     [5-8]  u32  lastUpdate (epoch sec, big-endian)
//     [9-10] u16  messagesPerSecond (big-endian)

// ── Constants ──

export const MSG_FLIGHT_UPDATE = 1;
export const MSG_FLIGHT_REMOVE = 2;
export const MSG_STATS = 3;
export const PROTO_VERSION = 1;
export const HEADER_SIZE = 8;
export const SNAPSHOT_FIXED_SIZE = 40;

export const ABSENT_U16 = 0xFFFF;
export const ABSENT_I16 = 0x7FFF;

// ── Types ──

export interface AircraftSnapshot {
  icao24: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  groundSpeed: number;
  verticalRate: number;
  squawk: string;
  source: 'adsb' | 'mlat' | 'other';
  category: string;
  isOnGround: boolean;
  lastSeen: number;
  timestamp: number;
  type: 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
  met?: {
    windDirectionDeg?: number;
    windSpeedKt?: number;
    oatC?: number;
    tatC?: number;
    qnhHpa?: number;
  };
}

export interface StatsSnapshot {
  totalFlights: number;
  dataSource: 'adsb-lol' | 'airplanes-live' | 'opensky';
  lastUpdate: number;
  messagesPerSecond: number;
}

export type DecodedMessage =
  | { type: 'flight-update'; data: AircraftSnapshot[] }
  | { type: 'flight-remove'; data: string[] }
  | { type: 'stats'; data: StatsSnapshot };

// ── Shared TextEncoder/Decoder ──

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── ICAO hex ↔ 3-byte conversion ──

function icao24ToBytes(hex: string): [number, number, number] {
  const v = parseInt(hex, 16);
  return [(v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
}

function bytesToIcao24(b0: number, b1: number, b2: number): string {
  return ((b0 << 16) | (b1 << 8) | b2).toString(16).padStart(6, '0');
}

// ── Source enum ──

function encodeSource(s: 'adsb' | 'mlat' | 'other'): number {
  return s === 'adsb' ? 0 : s === 'mlat' ? 1 : 2;
}

function decodeSource(v: number): 'adsb' | 'mlat' | 'other' {
  return v === 0 ? 'adsb' : v === 1 ? 'mlat' : 'other';
}

function encodeDataSource(s: string): number {
  return s === 'adsb-lol' ? 0 : s === 'airplanes-live' ? 1 : 2;
}

function decodeDataSource(v: number): 'adsb-lol' | 'airplanes-live' | 'opensky' {
  return v === 0 ? 'adsb-lol' : v === 1 ? 'airplanes-live' : 'opensky';
}

// ── Squawk encoding (octal string → u16) ──

function encodeSquawk(s: string): number {
  if (!s || s.length === 0) return ABSENT_U16;
  const v = parseInt(s, 8);
  return Number.isFinite(v) ? v & 0xFFFF : ABSENT_U16;
}

function decodeSquawk(v: number): string {
  if (v === ABSENT_U16) return '';
  return v.toString(8).padStart(4, '0');
}

// ── Flags bitfield ──

function packFlags(ac: AircraftSnapshot): number {
  let flags = 0;
  if (ac.isOnGround)           flags |= 1 << 0;
  if (ac.type === 'military')  flags |= 1 << 1;
  if (ac.type === 'cargo')     flags |= 1 << 2;
  if (ac.type === 'private')   flags |= 1 << 3;
  if (ac.type === 'helicopter') flags |= 1 << 4;
  if (ac.type === 'ground')    flags |= 1 << 5;
  flags |= (encodeSource(ac.source) & 0x3) << 6;
  return flags;
}

function unpackType(flags: number): AircraftSnapshot['type'] {
  if (flags & (1 << 1)) return 'military';
  if (flags & (1 << 2)) return 'cargo';
  if (flags & (1 << 3)) return 'private';
  if (flags & (1 << 4)) return 'helicopter';
  if (flags & (1 << 5)) return 'ground';
  return 'airline';
}

// ── Write a length-prefixed string into a DataView ──

function writeString(view: DataView, offset: number, str: string): number {
  const bytes = encoder.encode(str);
  const len = Math.min(bytes.length, 255); // u8 length prefix max
  view.setUint8(offset, len);
  const buf = new Uint8Array(view.buffer, view.byteOffset + offset + 1, len);
  buf.set(bytes.subarray(0, len));
  return 1 + len;
}

function readString(view: DataView, offset: number): [string, number] {
  const len = view.getUint8(offset);
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset + 1, len);
  return [decoder.decode(bytes), 1 + len];
}

// ══════════════════════════════════════════════════════════
// ENCODER (backend)
// ══════════════════════════════════════════════════════════

/**
 * Encode a flight-update message as a compact Uint8Array.
 * Designed to be called once and the buffer broadcast to all clients.
 */
export function encodeFlightUpdate(flights: AircraftSnapshot[]): Uint8Array {
  if (flights.length === 0) {
    const buf = new ArrayBuffer(HEADER_SIZE);
    const view = new DataView(buf);
    view.setUint8(0, MSG_FLIGHT_UPDATE);
    view.setUint8(1, PROTO_VERSION);
    view.setUint16(2, 0);
    view.setUint32(4, (Date.now() / 1000) >>> 0);
    return new Uint8Array(buf);
  }

  // Pre-encode all string blocks to know total size
  const stringBlocks: Uint8Array[] = [];
  let totalStringBytes = 0;

  for (const ac of flights) {
    // 4 strings: callsign, registration, aircraftType, category
    const csBytes = encoder.encode(ac.callsign);
    const regBytes = encoder.encode(ac.registration);
    const atBytes = encoder.encode(ac.aircraftType);
    const catBytes = encoder.encode(ac.category);

    const blockLen = 4 + csBytes.length + regBytes.length + atBytes.length + catBytes.length; // 4 length prefixes
    const block = new Uint8Array(blockLen);
    let off = 0;

    block[off++] = csBytes.length;
    block.set(csBytes, off); off += csBytes.length;

    block[off++] = regBytes.length;
    block.set(regBytes, off); off += regBytes.length;

    block[off++] = atBytes.length;
    block.set(atBytes, off); off += atBytes.length;

    block[off++] = catBytes.length;
    block.set(catBytes, off);

    stringBlocks.push(block);
    totalStringBytes += blockLen;
  }

  const totalSize = HEADER_SIZE + flights.length * SNAPSHOT_FIXED_SIZE + totalStringBytes;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Header
  view.setUint8(0, MSG_FLIGHT_UPDATE);
  view.setUint8(1, PROTO_VERSION);
  view.setUint16(2, flights.length);
  view.setUint32(4, (Date.now() / 1000) >>> 0);

  let pos = HEADER_SIZE;

  for (let i = 0; i < flights.length; i++) {
    const ac = flights[i];
    const stringBlock = stringBlocks[i];

    // Fixed region (40 bytes)
    view.setInt32(pos + 0, Math.round(ac.latitude * 1e6));
    view.setInt32(pos + 4, Math.round(ac.longitude * 1e6));
    view.setInt16(pos + 8, Math.round(ac.altitude / 25));
    view.setUint16(pos + 10, Math.round(ac.heading * 10));
    view.setUint16(pos + 12, Math.min(ac.groundSpeed, 65535));
    view.setInt16(pos + 14, Math.round(ac.verticalRate / 10));
    view.setUint16(pos + 16, packFlags(ac));

    // ICAO24
    const [b0, b1, b2] = icao24ToBytes(ac.icao24);
    view.setUint8(pos + 18, b0);
    view.setUint8(pos + 19, b1);
    view.setUint8(pos + 20, b2);

    // lastSeen (clamped to u8)
    view.setUint8(pos + 21, Math.min(ac.lastSeen, 255));

    // stringBlockLen
    view.setUint16(pos + 22, stringBlock.length);

    // Met data
    const met = ac.met;
    view.setUint16(pos + 24, met?.windDirectionDeg != null ? Math.round(met.windDirectionDeg * 10) : ABSENT_U16);
    view.setUint16(pos + 26, met?.windSpeedKt != null ? Math.round(met.windSpeedKt * 10) : ABSENT_U16);
    view.setInt16(pos + 28, met?.oatC != null ? Math.round(met.oatC * 10) : ABSENT_I16);
    view.setInt16(pos + 30, met?.tatC != null ? Math.round(met.tatC * 10) : ABSENT_I16);
    view.setUint16(pos + 32, met?.qnhHpa != null ? Math.round(met.qnhHpa * 10) : ABSENT_U16);

    // Timestamp (epoch seconds)
    view.setUint32(pos + 34, (ac.timestamp / 1000) >>> 0);

    // Squawk
    view.setUint16(pos + 38, encodeSquawk(ac.squawk));

    pos += SNAPSHOT_FIXED_SIZE;

    // Variable region (string block)
    u8.set(stringBlock, pos);
    pos += stringBlock.length;
  }

  return new Uint8Array(buffer);
}

/**
 * Encode a flight-remove message (list of ICAO24 hex strings).
 */
export function encodeFlightRemove(icao24s: string[]): Uint8Array {
  const totalSize = HEADER_SIZE + icao24s.length * 3;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint8(0, MSG_FLIGHT_REMOVE);
  view.setUint8(1, PROTO_VERSION);
  view.setUint16(2, icao24s.length);
  view.setUint32(4, (Date.now() / 1000) >>> 0);

  let pos = HEADER_SIZE;
  for (const hex of icao24s) {
    const [b0, b1, b2] = icao24ToBytes(hex);
    view.setUint8(pos, b0);
    view.setUint8(pos + 1, b1);
    view.setUint8(pos + 2, b2);
    pos += 3;
  }

  return new Uint8Array(buffer);
}

/**
 * Encode a stats message.
 */
export function encodeStats(stats: StatsSnapshot): Uint8Array {
  const totalSize = HEADER_SIZE + 11;
  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  view.setUint8(0, MSG_STATS);
  view.setUint8(1, PROTO_VERSION);
  view.setUint16(2, 1); // 1 item
  view.setUint32(4, (Date.now() / 1000) >>> 0);

  const pos = HEADER_SIZE;
  view.setUint32(pos, stats.totalFlights);
  view.setUint8(pos + 4, encodeDataSource(stats.dataSource));
  view.setUint32(pos + 5, (stats.lastUpdate / 1000) >>> 0);
  view.setUint16(pos + 9, Math.min(stats.messagesPerSecond, 65535));

  return new Uint8Array(buffer);
}

// ══════════════════════════════════════════════════════════
// DECODER (frontend)
// ══════════════════════════════════════════════════════════

/**
 * Decode a binary WebSocket message back into typed objects.
 * Returns null for unrecognized/malformed messages.
 */
export function decodeMessage(data: ArrayBuffer | Uint8Array): DecodedMessage | null {
  const buffer = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data;
  if (buffer.byteLength < HEADER_SIZE) return null;

  const view = new DataView(buffer);
  const msgType = view.getUint8(0);
  const version = view.getUint8(1);
  if (version !== PROTO_VERSION) return null;

  const itemCount = view.getUint16(2);

  switch (msgType) {
    case MSG_FLIGHT_UPDATE:
      return decodeFlightUpdate(view, itemCount);
    case MSG_FLIGHT_REMOVE:
      return decodeFlightRemove(view, itemCount);
    case MSG_STATS:
      return decodeStatsMsg(view);
    default:
      return null;
  }
}

function decodeFlightUpdate(view: DataView, count: number): DecodedMessage {
  const flights: AircraftSnapshot[] = new Array(count);
  let pos = HEADER_SIZE;

  for (let i = 0; i < count; i++) {
    const latitude = view.getInt32(pos + 0) / 1e6;
    const longitude = view.getInt32(pos + 4) / 1e6;
    const altitude = view.getInt16(pos + 8) * 25;
    const heading = view.getUint16(pos + 10) / 10;
    const groundSpeed = view.getUint16(pos + 12);
    const verticalRate = view.getInt16(pos + 14) * 10;
    const flags = view.getUint16(pos + 16);

    const icao24 = bytesToIcao24(
      view.getUint8(pos + 18),
      view.getUint8(pos + 19),
      view.getUint8(pos + 20),
    );

    const lastSeen = view.getUint8(pos + 21);
    const stringBlockLen = view.getUint16(pos + 22);

    // Met data
    const windDirRaw = view.getUint16(pos + 24);
    const windSpdRaw = view.getUint16(pos + 26);
    const oatRaw = view.getInt16(pos + 28);
    const tatRaw = view.getInt16(pos + 30);
    const qnhRaw = view.getUint16(pos + 32);

    const hasMet = windDirRaw !== ABSENT_U16 || windSpdRaw !== ABSENT_U16 ||
                   oatRaw !== ABSENT_I16 || tatRaw !== ABSENT_I16 || qnhRaw !== ABSENT_U16;

    const met = hasMet ? {
      windDirectionDeg: windDirRaw !== ABSENT_U16 ? windDirRaw / 10 : undefined,
      windSpeedKt: windSpdRaw !== ABSENT_U16 ? windSpdRaw / 10 : undefined,
      oatC: oatRaw !== ABSENT_I16 ? oatRaw / 10 : undefined,
      tatC: tatRaw !== ABSENT_I16 ? tatRaw / 10 : undefined,
      qnhHpa: qnhRaw !== ABSENT_U16 ? qnhRaw / 10 : undefined,
    } : undefined;

    const timestamp = view.getUint32(pos + 34) * 1000;
    const squawk = decodeSquawk(view.getUint16(pos + 38));

    pos += SNAPSHOT_FIXED_SIZE;

    // Read string block
    const strView = new DataView(view.buffer, view.byteOffset + pos, stringBlockLen);
    let sOff = 0;

    const [callsign, csLen] = readString(strView, sOff); sOff += csLen;
    const [registration, regLen] = readString(strView, sOff); sOff += regLen;
    const [aircraftType, atLen] = readString(strView, sOff); sOff += atLen;
    const [category] = readString(strView, sOff);

    pos += stringBlockLen;

    flights[i] = {
      icao24,
      callsign,
      registration,
      aircraftType,
      latitude,
      longitude,
      altitude,
      heading,
      groundSpeed,
      verticalRate,
      squawk,
      source: decodeSource((flags >>> 6) & 0x3),
      category,
      isOnGround: !!(flags & (1 << 0)),
      lastSeen,
      timestamp,
      type: unpackType(flags),
      met,
    };
  }

  return { type: 'flight-update', data: flights };
}

function decodeFlightRemove(view: DataView, count: number): DecodedMessage {
  const icao24s: string[] = new Array(count);
  let pos = HEADER_SIZE;

  for (let i = 0; i < count; i++) {
    icao24s[i] = bytesToIcao24(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
    );
    pos += 3;
  }

  return { type: 'flight-remove', data: icao24s };
}

function decodeStatsMsg(view: DataView): DecodedMessage {
  const pos = HEADER_SIZE;
  return {
    type: 'stats',
    data: {
      totalFlights: view.getUint32(pos),
      dataSource: decodeDataSource(view.getUint8(pos + 4)),
      lastUpdate: view.getUint32(pos + 5) * 1000,
      messagesPerSecond: view.getUint16(pos + 9),
    },
  };
}
