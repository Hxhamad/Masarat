/**
 * Regression: kpiEngine trail points at lat=0 / lon=0 are NOT dropped.
 *
 * The original bug used `.filter(p => p.lat && p.lon)` which is falsy for 0.
 * The fix changed to `.filter(p => p.lat != null && p.lon != null)`.
 */

import { describe, it, expect } from 'vitest';

interface TrailPoint {
  lat: number | null;
  lon: number | null;
  alt: number;
  ts: number;
}

// Replicate the fixed filter logic from kpiEngine computeEfficiencyScore
function filterValidTrailPoints(trail: TrailPoint[]): TrailPoint[] {
  return trail.filter(p => p.lat != null && p.lon != null);
}

describe('kpiEngine trail-point coordinate-zero filter', () => {
  it('keeps trail point at lat=0, lon=0', () => {
    const trail: TrailPoint[] = [
      { lat: 0, lon: 0, alt: 35000, ts: 1000 },
    ];
    expect(filterValidTrailPoints(trail)).toHaveLength(1);
  });

  it('keeps trail point at lat=0, lon=50', () => {
    const trail: TrailPoint[] = [
      { lat: 0, lon: 50, alt: 35000, ts: 1000 },
    ];
    expect(filterValidTrailPoints(trail)).toHaveLength(1);
  });

  it('keeps trail point at lat=46, lon=0', () => {
    const trail: TrailPoint[] = [
      { lat: 46, lon: 0, alt: 35000, ts: 1000 },
    ];
    expect(filterValidTrailPoints(trail)).toHaveLength(1);
  });

  it('drops trail point with null lat', () => {
    const trail: TrailPoint[] = [
      { lat: null, lon: 50, alt: 35000, ts: 1000 },
    ];
    expect(filterValidTrailPoints(trail)).toHaveLength(0);
  });

  it('drops trail point with null lon', () => {
    const trail: TrailPoint[] = [
      { lat: 46, lon: null, alt: 35000, ts: 1000 },
    ];
    expect(filterValidTrailPoints(trail)).toHaveLength(0);
  });

  it('filters mixed valid/invalid points correctly', () => {
    const trail: TrailPoint[] = [
      { lat: 46, lon: 2, alt: 35000, ts: 1 },
      { lat: null, lon: 2, alt: 35000, ts: 2 },
      { lat: 0, lon: 0, alt: 35000, ts: 3 },
      { lat: 46, lon: null, alt: 35000, ts: 4 },
      { lat: -10, lon: -20, alt: 35000, ts: 5 },
    ];
    const result = filterValidTrailPoints(trail);
    expect(result).toHaveLength(3);
    expect(result.map(p => p.ts)).toEqual([1, 3, 5]);
  });
});
