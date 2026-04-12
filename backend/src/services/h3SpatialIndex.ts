/**
 * H3SpatialIndex — Server-side spatial index for aircraft using H3 hexagons.
 *
 * Maintains a bidirectional mapping:
 *   - cellToFlights: H3 cell index → Set<icao24>
 *   - flightToCell:  icao24 → H3 cell index
 *
 * This enables O(cells) viewport filtering instead of O(flights) by
 * converting a bounding box into a set of H3 cells and looking up which
 * flights exist in those cells.
 *
 * Resolution 5 is used (avg edge ~8.5 km, area ~252 km²) which provides
 * a good granularity/overhead tradeoff for aircraft tracking at continental
 * scale. At 50k flights globally, this yields ~15k-20k occupied cells.
 */

import { latLngToCell, polygonToCells, gridDisk } from 'h3-js';

// H3 resolution 5: avg edge ~8.5 km, area ~252 km²
// Good balance between cell count and spatial precision for aircraft
const H3_RESOLUTION = 5;

// Padding ring count: expand the viewport by this many cell rings
// to prevent edge flickering when aircraft are near viewport boundary.
const VIEWPORT_PAD_RINGS = 1;

export class H3SpatialIndex {
  // H3 cell → set of icao24 IDs in that cell
  private cellToFlights = new Map<string, Set<string>>();

  // icao24 → current H3 cell
  private flightToCell = new Map<string, string>();

  /**
   * Compute the H3 cell index for a lat/lon pair.
   * Returns the H3 index string at the configured resolution.
   */
  static latLonToCell(lat: number, lon: number): string {
    return latLngToCell(lat, lon, H3_RESOLUTION);
  }

  /** Total number of indexed flights */
  get size(): number {
    return this.flightToCell.size;
  }

  /** Total number of occupied cells */
  get cellCount(): number {
    return this.cellToFlights.size;
  }

  /**
   * Update the spatial index for a single flight.
   * If the flight moved to a different H3 cell, it's removed from the old cell
   * and added to the new one. If the cell hasn't changed, this is a no-op.
   */
  update(icao24: string, lat: number, lon: number): string {
    const newCell = latLngToCell(lat, lon, H3_RESOLUTION);
    const oldCell = this.flightToCell.get(icao24);

    if (oldCell === newCell) return newCell;

    // Remove from old cell
    if (oldCell) {
      const oldSet = this.cellToFlights.get(oldCell);
      if (oldSet) {
        oldSet.delete(icao24);
        if (oldSet.size === 0) this.cellToFlights.delete(oldCell);
      }
    }

    // Add to new cell
    let newSet = this.cellToFlights.get(newCell);
    if (!newSet) {
      newSet = new Set<string>();
      this.cellToFlights.set(newCell, newSet);
    }
    newSet.add(icao24);

    this.flightToCell.set(icao24, newCell);
    return newCell;
  }

  /**
   * Remove a flight from the spatial index entirely.
   */
  remove(icao24: string): void {
    const cell = this.flightToCell.get(icao24);
    if (cell) {
      const set = this.cellToFlights.get(cell);
      if (set) {
        set.delete(icao24);
        if (set.size === 0) this.cellToFlights.delete(cell);
      }
      this.flightToCell.delete(icao24);
    }
  }

  /**
   * Remove multiple flights from the index.
   */
  removeBatch(icao24s: string[]): void {
    for (const id of icao24s) {
      this.remove(id);
    }
  }

  /**
   * Get the H3 cell for a flight, or undefined if not indexed.
   */
  getCellForFlight(icao24: string): string | undefined {
    return this.flightToCell.get(icao24);
  }

  /**
   * Convert a viewport bounding box into the set of H3 cells that cover it,
   * including padding rings to prevent edge aircraft from flickering.
   *
   * Returns a Set<string> of H3 cell indices.
   */
  viewportToCells(minLat: number, minLng: number, maxLat: number, maxLng: number): Set<string> {
    // Build a polygon from the viewport bounding box
    // Note: polygonToCells expects [lng, lat] coordinate pairs (GeoJSON order)
    const polygon: [number, number][] = [
      [minLat, minLng],
      [maxLat, minLng],
      [maxLat, maxLng],
      [minLat, maxLng],
      [minLat, minLng], // close the ring
    ];

    // Get all H3 cells that cover the viewport
    const coreCells = polygonToCells(polygon, H3_RESOLUTION);

    // Expand by padding rings to prevent edge flickering
    const allCells = new Set<string>();
    for (const cell of coreCells) {
      allCells.add(cell);
      if (VIEWPORT_PAD_RINGS > 0) {
        for (const neighbor of gridDisk(cell, VIEWPORT_PAD_RINGS)) {
          allCells.add(neighbor);
        }
      }
    }

    return allCells;
  }

  /**
   * Get all ICAO24 IDs whose current H3 cell is in the given cell set.
   * This is the core viewport-filtering operation — O(cells) instead of O(flights).
   */
  getFlightsInCells(cells: Set<string>): Set<string> {
    const result = new Set<string>();
    for (const cell of cells) {
      const flights = this.cellToFlights.get(cell);
      if (flights) {
        for (const id of flights) {
          result.add(id);
        }
      }
    }
    return result;
  }

  /**
   * High-level API: get all ICAO24 IDs visible in a viewport bounding box.
   */
  getFlightsInViewport(minLat: number, minLng: number, maxLat: number, maxLng: number): Set<string> {
    const cells = this.viewportToCells(minLat, minLng, maxLat, maxLng);
    return this.getFlightsInCells(cells);
  }

  /**
   * Clear the entire index.
   */
  clear(): void {
    this.cellToFlights.clear();
    this.flightToCell.clear();
  }
}

// Singleton instance — shared between aggregator and WS handler
export const spatialIndex = new H3SpatialIndex();
