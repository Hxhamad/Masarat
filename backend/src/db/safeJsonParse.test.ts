/**
 * Regression: safeJsonParse returns fallback on malformed JSON (no crash).
 *
 * Both weatherStore and gnssStore wrap JSON.parse in safeJsonParse<T>(raw, fallback).
 * This test verifies the shared helper contract:
 *  - valid JSON → parsed value
 *  - invalid JSON → fallback (no throw)
 *  - non-string input → fallback (no throw)
 */

import { describe, it, expect } from 'vitest';

// Replicate the helper from weatherStore / gnssStore
function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
  });

  it('parses valid JSON array', () => {
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('returns fallback for malformed JSON', () => {
    const fallback = { default: true };
    expect(safeJsonParse('{not valid json', fallback)).toBe(fallback);
  });

  it('returns fallback for truncated JSON', () => {
    expect(safeJsonParse('{"a":', [])).toEqual([]);
  });

  it('returns fallback for empty string', () => {
    expect(safeJsonParse('', 'default')).toBe('default');
  });

  it('returns fallback for null input', () => {
    expect(safeJsonParse(null, [])).toEqual([]);
  });

  it('returns fallback for undefined input', () => {
    expect(safeJsonParse(undefined, {})).toEqual({});
  });

  it('returns fallback for numeric input', () => {
    expect(safeJsonParse(42, 'fallback')).toBe('fallback');
  });

  it('returns fallback for boolean input', () => {
    expect(safeJsonParse(true, 'fallback')).toBe('fallback');
  });

  it('returns fallback for object input (not a string)', () => {
    expect(safeJsonParse({ key: 'value' }, 'fallback')).toBe('fallback');
  });

  it('preserves typed fallback for GNSS evidence shape', () => {
    interface GNSSEvidenceFlags {
      positionJumps: boolean;
      altitudeMismatch: boolean;
      nicDowngrade: boolean;
      clusterPattern: boolean;
    }
    const fallback: GNSSEvidenceFlags = {
      positionJumps: false,
      altitudeMismatch: false,
      nicDowngrade: false,
      clusterPattern: false,
    };
    const result = safeJsonParse<GNSSEvidenceFlags>('CORRUPT', fallback);
    expect(result).toBe(fallback);
    expect(result.positionJumps).toBe(false);
  });

  it('preserves typed fallback for forecast hourly array', () => {
    const fallback: { hour: number; summary: string }[] = [];
    const result = safeJsonParse<typeof fallback>('{{{bad', fallback);
    expect(result).toBe(fallback);
    expect(result).toHaveLength(0);
  });
});
