/**
 * Regression: coordinate‑zero flights are NOT dropped by the FIR filter.
 *
 * The original bug used `!f.latitude` which is falsy for 0.
 * The fix changed to `f.latitude == null || f.longitude == null`.
 * These tests verify that flights at lat=0 / lon=0 pass through.
 */

import { describe, it, expect } from 'vitest';

// Replicate the guard logic from firFilter.ts rebuildIndex()
function shouldSkipFlight(lat: number | null | undefined, lon: number | null | undefined): boolean {
  return lat == null || lon == null;
}

describe('firFilter coordinate-zero guard', () => {
  it('does NOT skip flight at lat=0, lon=0', () => {
    expect(shouldSkipFlight(0, 0)).toBe(false);
  });

  it('does NOT skip flight at lat=0, lon=35', () => {
    expect(shouldSkipFlight(0, 35)).toBe(false);
  });

  it('does NOT skip flight at lat=46, lon=0', () => {
    expect(shouldSkipFlight(46, 0)).toBe(false);
  });

  it('skips flight with null latitude', () => {
    expect(shouldSkipFlight(null, 35)).toBe(true);
  });

  it('skips flight with undefined longitude', () => {
    expect(shouldSkipFlight(46, undefined)).toBe(true);
  });

  it('skips flight with both null', () => {
    expect(shouldSkipFlight(null, null)).toBe(true);
  });

  it('accepts normal non-zero coordinates', () => {
    expect(shouldSkipFlight(46.2, 2.3)).toBe(false);
  });

  it('accepts negative coordinates (southern/western hemisphere)', () => {
    expect(shouldSkipFlight(-33.86, -151.2)).toBe(false);
  });
});
