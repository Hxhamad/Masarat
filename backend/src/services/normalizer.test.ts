/**
 * Regression: normalizer must validate upstream payloads at runtime.
 *
 * - Malformed/missing payloads return [] instead of crashing
 * - Flights at lat=0 / lon=0 are preserved (not dropped by truthy check)
 * - NaN/Infinity values in numeric fields are coerced to fallback
 * - OpenSky state vectors with < 17 elements are skipped
 */

import { describe, it, expect } from 'vitest';
import { normalizeReadsB, normalizeOpenSky } from '../services/normalizer.js';

// ── Helpers ──

function makeReadsBPayload(aircraft: Record<string, unknown>[]) {
  return { ac: aircraft, msg: '', now: 1000000, total: aircraft.length, ctime: 0, ptime: 0 };
}

function makeOpenSkyPayload(states: unknown[][]) {
  return { time: 1000000, states };
}

function minimalAircraft(overrides: Record<string, unknown> = {}) {
  return { hex: 'abcdef', lat: 45.0, lon: 2.0, alt_baro: 35000, ...overrides };
}

// 17-element OpenSky state vector
function minimalStateVector(overrides: Partial<Record<number, unknown>> = {}): unknown[] {
  const sv: unknown[] = [
    'abcdef',   // 0: icao24
    'TEST123',  // 1: callsign
    'US',       // 2: origin_country
    1000000,    // 3: time_position
    1000000,    // 4: last_contact
    2.0,        // 5: longitude
    45.0,       // 6: latitude
    10000,      // 7: baro_altitude (meters)
    false,      // 8: on_ground
    250,        // 9: velocity (m/s)
    90,         // 10: true_track
    5,          // 11: vertical_rate (m/s)
    null,       // 12: sensors
    10500,      // 13: geo_altitude
    '1200',     // 14: squawk
    false,      // 15: spi
    0,          // 16: position_source
  ];
  for (const [idx, val] of Object.entries(overrides)) {
    sv[Number(idx)] = val;
  }
  return sv;
}

// ── ReadsB Normalizer ──

describe('normalizeReadsB', () => {
  it('returns [] for null/undefined/non-object input', () => {
    expect(normalizeReadsB(null)).toEqual([]);
    expect(normalizeReadsB(undefined)).toEqual([]);
    expect(normalizeReadsB('not an object')).toEqual([]);
    expect(normalizeReadsB(42)).toEqual([]);
  });

  it('returns [] when ac is missing or not an array', () => {
    expect(normalizeReadsB({})).toEqual([]);
    expect(normalizeReadsB({ ac: 'not array' })).toEqual([]);
    expect(normalizeReadsB({ ac: null })).toEqual([]);
  });

  it('skips aircraft with missing lat/lon', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      { hex: 'aaa111', lon: 2.0 },          // no lat
      { hex: 'bbb222', lat: 45.0 },          // no lon
      { hex: 'ccc333' },                     // neither
    ]));
    expect(result).toHaveLength(0);
  });

  it('skips aircraft with non-number lat/lon', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      { hex: 'aaa111', lat: 'bad', lon: 2.0 },
      { hex: 'bbb222', lat: 45.0, lon: NaN },
    ]));
    expect(result).toHaveLength(0);
  });

  it('skips aircraft with Infinity lat/lon', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      { hex: 'aaa111', lat: Infinity, lon: 2.0 },
      { hex: 'bbb222', lat: 45.0, lon: -Infinity },
    ]));
    expect(result).toHaveLength(0);
  });

  it('preserves flights at lat=0, lon=0 (equator/Greenwich)', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      minimalAircraft({ hex: 'equat1', lat: 0, lon: 0 }),
      minimalAircraft({ hex: 'equat2', lat: 0, lon: 30 }),
      minimalAircraft({ hex: 'green1', lat: 51.5, lon: 0 }),
    ]));
    expect(result).toHaveLength(3);
    expect(result[0].latitude).toBe(0);
    expect(result[0].longitude).toBe(0);
    expect(result[1].latitude).toBe(0);
    expect(result[2].longitude).toBe(0);
  });

  it('skips aircraft with invalid hex', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      minimalAircraft({ hex: '' }),
      minimalAircraft({ hex: '~abc123' }),
      minimalAircraft({ hex: 123 }),       // non-string
    ]));
    expect(result).toHaveLength(0);
  });

  it('coerces NaN/undefined heading/speed/verticalRate to 0', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      minimalAircraft({ track: NaN, gs: undefined, baro_rate: Infinity }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].heading).toBe(0);
    expect(result[0].groundSpeed).toBe(0);
    expect(result[0].verticalRate).toBe(0);
  });

  it('normalizes a valid aircraft correctly', () => {
    const result = normalizeReadsB(makeReadsBPayload([
      minimalAircraft({ hex: 'A1B2C3', flight: ' UAL123 ', gs: 450, track: 180 }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].icao24).toBe('a1b2c3');
    expect(result[0].callsign).toBe('UAL123');
    expect(result[0].groundSpeed).toBe(450);
    expect(result[0].heading).toBe(180);
  });
});

// ── OpenSky Normalizer ──

describe('normalizeOpenSky', () => {
  it('returns [] for null/undefined/non-object input', () => {
    expect(normalizeOpenSky(null)).toEqual([]);
    expect(normalizeOpenSky(undefined)).toEqual([]);
    expect(normalizeOpenSky(42)).toEqual([]);
  });

  it('returns [] when states is null (valid OpenSky shape for no data)', () => {
    expect(normalizeOpenSky({ time: 1000, states: null })).toEqual([]);
  });

  it('skips state vectors with < 17 elements', () => {
    const result = normalizeOpenSky(makeOpenSkyPayload([
      ['abc', null, 'US', null, 0, 2.0, 45.0],  // only 7 elements
    ]));
    expect(result).toHaveLength(0);
  });

  it('skips state vectors with null lat/lon', () => {
    const result = normalizeOpenSky(makeOpenSkyPayload([
      minimalStateVector({ 5: null, 6: null }),
    ]));
    expect(result).toHaveLength(0);
  });

  it('preserves flights at lat=0, lon=0', () => {
    const result = normalizeOpenSky(makeOpenSkyPayload([
      minimalStateVector({ 5: 0, 6: 0 }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].latitude).toBe(0);
    expect(result[0].longitude).toBe(0);
  });

  it('coerces NaN/null numeric fields to 0', () => {
    const result = normalizeOpenSky(makeOpenSkyPayload([
      minimalStateVector({ 7: null, 9: NaN, 10: Infinity, 11: null }),
    ]));
    expect(result).toHaveLength(1);
    expect(result[0].altitude).toBe(0);
    expect(result[0].groundSpeed).toBe(0);
    expect(result[0].heading).toBe(0);
    expect(result[0].verticalRate).toBe(0);
  });

  it('converts OpenSky units correctly', () => {
    const result = normalizeOpenSky(makeOpenSkyPayload([
      minimalStateVector({ 7: 10000, 9: 250, 11: 5 }),
    ]));
    expect(result).toHaveLength(1);
    // 10000m → feet
    expect(result[0].altitude).toBe(Math.round(10000 * 3.28084));
    // 250 m/s → knots
    expect(result[0].groundSpeed).toBe(Math.round(250 * 1.94384));
    // 5 m/s → ft/min
    expect(result[0].verticalRate).toBe(Math.round(5 * 196.85));
  });
});
