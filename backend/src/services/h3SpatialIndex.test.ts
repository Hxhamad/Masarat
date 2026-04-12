/**
 * Tests for H3SpatialIndex — server-side spatial indexing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { H3SpatialIndex } from './h3SpatialIndex.js';

describe('H3SpatialIndex', () => {
  let index: H3SpatialIndex;

  beforeEach(() => {
    index = new H3SpatialIndex();
  });

  describe('update', () => {
    it('indexes a flight and tracks its cell', () => {
      const cell = index.update('aaaaaa', 40.6413, -73.7781); // JFK area
      expect(cell).toBeTruthy();
      expect(typeof cell).toBe('string');
      expect(index.size).toBe(1);
      expect(index.getCellForFlight('aaaaaa')).toBe(cell);
    });

    it('moves a flight to a new cell when position changes significantly', () => {
      const cell1 = index.update('aaaaaa', 40.6413, -73.7781); // JFK
      const cell2 = index.update('aaaaaa', 51.4700, -0.4543);  // Heathrow
      expect(cell1).not.toBe(cell2);
      expect(index.size).toBe(1); // still one flight
      expect(index.getCellForFlight('aaaaaa')).toBe(cell2);
    });

    it('is a no-op when position stays within same cell', () => {
      const cell1 = index.update('aaaaaa', 40.6413, -73.7781);
      const cell2 = index.update('aaaaaa', 40.6415, -73.7780); // tiny move
      expect(cell1).toBe(cell2);
      expect(index.size).toBe(1);
    });

    it('tracks multiple flights in the same cell', () => {
      index.update('aaaaaa', 40.6413, -73.7781);
      index.update('bbbbbb', 40.6414, -73.7782); // very close
      expect(index.size).toBe(2);
    });
  });

  describe('remove', () => {
    it('removes a flight from the index', () => {
      index.update('aaaaaa', 40.6413, -73.7781);
      expect(index.size).toBe(1);
      index.remove('aaaaaa');
      expect(index.size).toBe(0);
      expect(index.getCellForFlight('aaaaaa')).toBeUndefined();
    });

    it('handles removing non-existent flight gracefully', () => {
      index.remove('nonexistent');
      expect(index.size).toBe(0);
    });

    it('cleans up empty cells', () => {
      index.update('aaaaaa', 40.6413, -73.7781);
      expect(index.cellCount).toBe(1);
      index.remove('aaaaaa');
      expect(index.cellCount).toBe(0);
    });
  });

  describe('removeBatch', () => {
    it('removes multiple flights at once', () => {
      index.update('aaaaaa', 40.6413, -73.7781);
      index.update('bbbbbb', 51.4700, -0.4543);
      index.update('cccccc', 48.8566, 2.3522);
      expect(index.size).toBe(3);

      index.removeBatch(['aaaaaa', 'cccccc']);
      expect(index.size).toBe(1);
      expect(index.getCellForFlight('bbbbbb')).toBeTruthy();
      expect(index.getCellForFlight('aaaaaa')).toBeUndefined();
    });
  });

  describe('latLonToCell (static)', () => {
    it('returns a valid H3 index string', () => {
      const cell = H3SpatialIndex.latLonToCell(40.6413, -73.7781);
      expect(typeof cell).toBe('string');
      expect(cell.length).toBeGreaterThan(0);
    });

    it('returns the same cell for nearby points', () => {
      const c1 = H3SpatialIndex.latLonToCell(40.6413, -73.7781);
      const c2 = H3SpatialIndex.latLonToCell(40.6415, -73.7780);
      expect(c1).toBe(c2);
    });

    it('returns different cells for distant points', () => {
      const c1 = H3SpatialIndex.latLonToCell(40.6413, -73.7781); // NYC
      const c2 = H3SpatialIndex.latLonToCell(51.4700, -0.4543);  // London
      expect(c1).not.toBe(c2);
    });
  });

  describe('viewport filtering', () => {
    beforeEach(() => {
      // Index flights at various locations
      index.update('jfk001', 40.6413, -73.7781);   // JFK area
      index.update('jfk002', 40.6500, -73.7800);   // Near JFK
      index.update('lhr001', 51.4700, -0.4543);    // Heathrow
      index.update('cdg001', 48.8566, 2.3522);     // Paris CDG area
      index.update('dxb001', 25.2532, 55.3657);    // Dubai
    });

    it('returns only flights within the viewport bounds', () => {
      // Viewport covering NYC area only
      const visible = index.getFlightsInViewport(
        39.0,  // minLat
        -75.0, // minLng
        42.0,  // maxLat
        -72.0, // maxLng
      );

      expect(visible.has('jfk001')).toBe(true);
      expect(visible.has('jfk002')).toBe(true);
      expect(visible.has('lhr001')).toBe(false);
      expect(visible.has('cdg001')).toBe(false);
      expect(visible.has('dxb001')).toBe(false);
    });

    it('returns flights across a large viewport (Europe)', () => {
      // Wide viewport covering London and Paris
      const visible = index.getFlightsInViewport(
        47.0,  // minLat
        -2.0,  // minLng
        53.0,  // maxLat
        4.0,   // maxLng
      );

      expect(visible.has('lhr001')).toBe(true);
      expect(visible.has('cdg001')).toBe(true);
      expect(visible.has('jfk001')).toBe(false);
      expect(visible.has('dxb001')).toBe(false);
    });

    it('returns empty set for viewport with no flights', () => {
      // Viewport in the middle of the Pacific
      const visible = index.getFlightsInViewport(
        -10.0, // minLat
        -170.0, // minLng
        -5.0,  // maxLat
        -160.0, // maxLng
      );

      expect(visible.size).toBe(0);
    });

    it('viewportToCells returns non-empty cell set', () => {
      const cells = index.viewportToCells(39.0, -75.0, 42.0, -72.0);
      expect(cells.size).toBeGreaterThan(0);
    });
  });

  describe('clear', () => {
    it('removes all entries', () => {
      index.update('aaaaaa', 40.6413, -73.7781);
      index.update('bbbbbb', 51.4700, -0.4543);
      expect(index.size).toBe(2);

      index.clear();
      expect(index.size).toBe(0);
      expect(index.cellCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('handles equator/prime meridian (lat=0, lon=0)', () => {
      const cell = index.update('eq001', 0, 0);
      expect(cell).toBeTruthy();
      expect(index.getCellForFlight('eq001')).toBe(cell);
    });

    it('handles high latitude (near poles)', () => {
      const cell = index.update('arctic', 89.9, 0);
      expect(cell).toBeTruthy();
    });

    it('handles negative coordinates (southern/western hemisphere)', () => {
      const cell = index.update('sydney', -33.8688, 151.2093);
      expect(cell).toBeTruthy();
      expect(index.getCellForFlight('sydney')).toBe(cell);
    });

    it('handles date line crossing (lon ~180)', () => {
      const cell = index.update('pacific', 0, 179.9);
      expect(cell).toBeTruthy();
    });
  });
});
