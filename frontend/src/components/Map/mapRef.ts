/**
 * Shared Leaflet map instance ref.
 *
 * FlightMap sets this on init; other components (FIRLayer, etc.)
 * read it to add their own layers without prop-drilling.
 */

import type L from 'leaflet';

let mapInstance: L.Map | null = null;

export function setMapInstance(map: L.Map | null): void {
  mapInstance = map;
}

export function getMapInstance(): L.Map | null {
  return mapInstance;
}
