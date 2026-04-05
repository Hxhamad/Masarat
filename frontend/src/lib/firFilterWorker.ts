/**
 * FIR Spatial Filter — WebWorker
 *
 * Receives flight positions + selected FIR polygons, returns the set of
 * icao24 IDs that are inside at least one selected FIR.
 *
 * Performance strategy:
 *   1. Bounding-box pre-filter (cheap — rejects ~80% of flights instantly)
 *   2. turf booleanPointInPolygon (expensive — only for bbox survivors)
 */

import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Polygon, MultiPolygon, Feature } from 'geojson';

export interface FIRWorkerRequest {
  flights: Array<{ icao24: string; lat: number; lng: number }>;
  firs: Array<{
    id: string;
    geometry: Polygon | MultiPolygon;
    bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number };
  }>;
}

export interface FIRWorkerResponse {
  /** Set of icao24s that passed the spatial filter */
  insideIds: string[];
}

self.onmessage = (e: MessageEvent<FIRWorkerRequest>) => {
  const { flights, firs } = e.data;
  const insideIds: string[] = [];

  for (const flight of flights) {
    let inside = false;

    for (const fir of firs) {
      // 1. Bounding-box pre-filter (fast reject)
      const { minLat, maxLat, minLng, maxLng } = fir.bounds;
      if (
        flight.lat < minLat ||
        flight.lat > maxLat ||
        flight.lng < minLng ||
        flight.lng > maxLng
      ) {
        continue;
      }

      // 2. Exact polygon test
      const pt = point([flight.lng, flight.lat]);
      const feature: Feature<Polygon | MultiPolygon> = {
        type: 'Feature',
        properties: {},
        geometry: fir.geometry,
      };

      if (booleanPointInPolygon(pt, feature)) {
        inside = true;
        break; // No need to check more FIRs
      }
    }

    if (inside) {
      insideIds.push(flight.icao24);
    }
  }

  const response: FIRWorkerResponse = { insideIds };
  self.postMessage(response);
};
