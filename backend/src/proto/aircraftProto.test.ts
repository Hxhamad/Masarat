/**
 * Roundtrip tests for the AircraftSnapshot binary codec.
 * Verifies encode→decode fidelity for all three message types.
 */
import { describe, it, expect } from 'vitest';
import {
  encodeFlightUpdate,
  encodeFlightRemove,
  encodeStats,
  decodeMessage,
  type AircraftSnapshot,
  type StatsSnapshot,
  HEADER_SIZE,
  MSG_FLIGHT_UPDATE,
  MSG_FLIGHT_REMOVE,
  MSG_STATS,
} from '../proto/aircraftProto.js';

function makeSnapshot(overrides: Partial<AircraftSnapshot> = {}): AircraftSnapshot {
  return {
    icao24: 'a1b2c3',
    callsign: 'UAL123',
    registration: 'N12345',
    aircraftType: 'B738',
    latitude: 40.641766,
    longitude: -73.778925,
    altitude: 35000,
    heading: 270.5,
    groundSpeed: 450,
    verticalRate: -500,
    squawk: '1200',
    source: 'adsb',
    category: 'A3',
    isOnGround: false,
    lastSeen: 2,
    timestamp: Date.now(),
    type: 'airline',
    ...overrides,
  };
}

describe('aircraftProto codec', () => {
  describe('flight-update roundtrip', () => {
    it('encodes and decodes a single aircraft snapshot', () => {
      const original = makeSnapshot();
      const buf = encodeFlightUpdate([original]);
      const decoded = decodeMessage(buf);

      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('flight-update');
      if (decoded!.type !== 'flight-update') throw new Error('wrong type');

      expect(decoded!.data).toHaveLength(1);
      const result = decoded!.data[0];

      expect(result.icao24).toBe('a1b2c3');
      expect(result.callsign).toBe('UAL123');
      expect(result.registration).toBe('N12345');
      expect(result.aircraftType).toBe('B738');
      expect(result.category).toBe('A3');
      expect(result.source).toBe('adsb');
      expect(result.type).toBe('airline');
      expect(result.isOnGround).toBe(false);
      expect(result.lastSeen).toBe(2);
      expect(result.squawk).toBe('1200');
      expect(result.groundSpeed).toBe(450);

      // Coordinates: i32 × 1e6 encoding preserves ~6 decimal places
      expect(result.latitude).toBeCloseTo(40.641766, 4);
      expect(result.longitude).toBeCloseTo(-73.778925, 4);

      // Altitude: ÷25 encoding → ±25 ft precision
      expect(Math.abs(result.altitude - 35000)).toBeLessThanOrEqual(25);

      // Heading: ×10 encoding → ±0.1° precision
      expect(result.heading).toBeCloseTo(270.5, 0);

      // Vertical rate: ÷10 encoding → ±10 ft/min precision
      expect(Math.abs(result.verticalRate - (-500))).toBeLessThanOrEqual(10);
    });

    it('correctly encodes military flag', () => {
      const buf = encodeFlightUpdate([makeSnapshot({ type: 'military' })]);
      const decoded = decodeMessage(buf);
      expect(decoded!.type).toBe('flight-update');
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].type).toBe('military');
    });

    it('correctly encodes cargo flag', () => {
      const buf = encodeFlightUpdate([makeSnapshot({ type: 'cargo' })]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].type).toBe('cargo');
    });

    it('correctly encodes ground status via flags', () => {
      const buf = encodeFlightUpdate([makeSnapshot({ type: 'ground', isOnGround: true, altitude: 0 })]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].isOnGround).toBe(true);
      expect(decoded!.data[0].type).toBe('ground');
    });

    it('encodes and decodes met data when present', () => {
      const met = { windDirectionDeg: 270, windSpeedKt: 45.5, oatC: -52.3, tatC: -30.1, qnhHpa: 1013.2 };
      const buf = encodeFlightUpdate([makeSnapshot({ met })]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      const result = decoded!.data[0];
      expect(result.met).toBeDefined();
      expect(result.met!.windDirectionDeg).toBeCloseTo(270, 0);
      expect(result.met!.windSpeedKt).toBeCloseTo(45.5, 0);
      expect(result.met!.oatC).toBeCloseTo(-52.3, 0);
      expect(result.met!.tatC).toBeCloseTo(-30.1, 0);
      expect(result.met!.qnhHpa).toBeCloseTo(1013.2, 0);
    });

    it('met is undefined when absent', () => {
      const buf = encodeFlightUpdate([makeSnapshot()]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].met).toBeUndefined();
    });

    it('handles empty flight array', () => {
      const buf = encodeFlightUpdate([]);
      expect(buf.byteLength).toBe(HEADER_SIZE);
      const decoded = decodeMessage(buf);
      expect(decoded!.type).toBe('flight-update');
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data).toHaveLength(0);
    });

    it('handles multiple flights', () => {
      const flights = [
        makeSnapshot({ icao24: 'aaaaaa', callsign: 'FDX101', type: 'cargo' }),
        makeSnapshot({ icao24: 'bbbbbb', callsign: 'MIL001', type: 'military' }),
        makeSnapshot({ icao24: 'cccccc', callsign: 'PVT01', type: 'private' }),
      ];
      const buf = encodeFlightUpdate(flights);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data).toHaveLength(3);
      expect(decoded!.data[0].icao24).toBe('aaaaaa');
      expect(decoded!.data[0].type).toBe('cargo');
      expect(decoded!.data[1].icao24).toBe('bbbbbb');
      expect(decoded!.data[1].type).toBe('military');
      expect(decoded!.data[2].icao24).toBe('cccccc');
      expect(decoded!.data[2].type).toBe('private');
    });

    it('encodes source=mlat correctly', () => {
      const buf = encodeFlightUpdate([makeSnapshot({ source: 'mlat' })]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].source).toBe('mlat');
    });

    it('preserves equator/Greenwich coordinates (lat=0, lon=0)', () => {
      const buf = encodeFlightUpdate([makeSnapshot({ latitude: 0, longitude: 0 })]);
      const decoded = decodeMessage(buf);
      if (decoded!.type !== 'flight-update') throw new Error();
      expect(decoded!.data[0].latitude).toBeCloseTo(0, 4);
      expect(decoded!.data[0].longitude).toBeCloseTo(0, 4);
    });
  });

  describe('flight-remove roundtrip', () => {
    it('encodes and decodes ICAO24 hex list', () => {
      const icaos = ['a1b2c3', '001122', 'ffffff'];
      const buf = encodeFlightRemove(icaos);
      const decoded = decodeMessage(buf);

      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('flight-remove');
      if (decoded!.type !== 'flight-remove') throw new Error();
      expect(decoded!.data).toEqual(icaos);
    });

    it('handles empty list', () => {
      const buf = encodeFlightRemove([]);
      const decoded = decodeMessage(buf);
      expect(decoded!.type).toBe('flight-remove');
      if (decoded!.type !== 'flight-remove') throw new Error();
      expect(decoded!.data).toHaveLength(0);
    });
  });

  describe('stats roundtrip', () => {
    it('encodes and decodes stats snapshot', () => {
      const stats: StatsSnapshot = {
        totalFlights: 12345,
        dataSource: 'airplanes-live',
        lastUpdate: Date.now(),
        messagesPerSecond: 420,
      };
      const buf = encodeStats(stats);
      const decoded = decodeMessage(buf);

      expect(decoded).not.toBeNull();
      expect(decoded!.type).toBe('stats');
      if (decoded!.type !== 'stats') throw new Error();
      expect(decoded!.data.totalFlights).toBe(12345);
      expect(decoded!.data.dataSource).toBe('airplanes-live');
      expect(decoded!.data.messagesPerSecond).toBe(420);
      // lastUpdate loses sub-second precision (stored as epoch seconds)
      expect(Math.abs(decoded!.data.lastUpdate - stats.lastUpdate)).toBeLessThanOrEqual(1000);
    });
  });

  describe('wire size', () => {
    it('binary is significantly smaller than JSON for bulk updates', () => {
      // Simulate a 1000-flight batch
      const flights: AircraftSnapshot[] = [];
      for (let i = 0; i < 1000; i++) {
        flights.push(makeSnapshot({
          icao24: i.toString(16).padStart(6, '0'),
          callsign: `TST${i}`,
          latitude: 40 + Math.random() * 10,
          longitude: -74 + Math.random() * 10,
          altitude: Math.random() * 45000,
        }));
      }

      const binarySize = encodeFlightUpdate(flights).byteLength;
      const jsonSize = new TextEncoder().encode(JSON.stringify({
        type: 'flight-update',
        data: flights,
      })).byteLength;

      console.log(`[proto-bench] 1000 flights: binary=${binarySize} bytes, JSON=${jsonSize} bytes, ratio=${(binarySize / jsonSize * 100).toFixed(1)}%`);

      // Binary should be at least 50% smaller than JSON
      expect(binarySize).toBeLessThan(jsonSize * 0.5);
    });
  });

  describe('malformed input', () => {
    it('returns null for buffer < header size', () => {
      expect(decodeMessage(new Uint8Array(4))).toBeNull();
    });

    it('returns null for unknown version', () => {
      const buf = new ArrayBuffer(HEADER_SIZE);
      const view = new DataView(buf);
      view.setUint8(0, MSG_FLIGHT_UPDATE);
      view.setUint8(1, 99); // bad version
      expect(decodeMessage(new Uint8Array(buf))).toBeNull();
    });

    it('returns null for unknown message type', () => {
      const buf = new ArrayBuffer(HEADER_SIZE);
      const view = new DataView(buf);
      view.setUint8(0, 255); // bad type
      view.setUint8(1, 1);
      expect(decodeMessage(new Uint8Array(buf))).toBeNull();
    });
  });
});
