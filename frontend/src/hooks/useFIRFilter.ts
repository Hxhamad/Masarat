/**
 * useFIRFilter — Spatial filtering hook
 *
 * Filters the flight list to only include aircraft physically inside
 * the selected FIR polygons, unless aircraftScope is set to 'all'.
 *
 * Performance:
 *  - <= WORKER_THRESHOLD flights: inline on main thread (no worker overhead)
 *  - > WORKER_THRESHOLD flights: offloaded to WebWorker to avoid jank
 *  - Bounding-box pre-filter always runs first (eliminates ~80% cheaply)
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { useFIRStore } from '../stores/firStore';
import { useFilterStore } from '../stores/filterStore';
import { getFIRFeature, getFIRBounds } from '../lib/firService';
import type { ADSBFlight } from '../types/flight';
import type { FIRWorkerRequest, FIRWorkerResponse } from '../lib/firFilterWorker';

const WORKER_THRESHOLD = 500;

export function useFIRFilter(flights: ADSBFlight[]): ADSBFlight[] {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const [workerResult, setWorkerResult] = useState<Set<string> | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Build FIR data for filtering (memoised on selection change)
  const selectedFIRData = useMemo(() => {
    if (aircraftScope === 'all' || selectedFIRs.length === 0) return null;

    return selectedFIRs
      .map((id) => {
        const feature = getFIRFeature(id);
        const bounds = getFIRBounds(id);
        if (!feature || !bounds) return null;
        return { id, geometry: feature.geometry, bounds };
      })
      .filter(Boolean) as FIRWorkerRequest['firs'];
  }, [selectedFIRs, aircraftScope]);

  // Inline filter for small flight counts
  const inlineFilter = useCallback(
    (flights: ADSBFlight[], firData: FIRWorkerRequest['firs']): ADSBFlight[] => {
      return flights.filter((f) => {
        for (const fir of firData) {
          // Bbox pre-filter
          const { minLat, maxLat, minLng, maxLng } = fir.bounds;
          if (f.latitude < minLat || f.latitude > maxLat || f.longitude < minLng || f.longitude > maxLng) {
            continue;
          }
          // Exact test
          const pt = point([f.longitude, f.latitude]);
          const feat: Feature<Polygon | MultiPolygon> = {
            type: 'Feature',
            properties: {},
            geometry: fir.geometry,
          };
          if (booleanPointInPolygon(pt, feat)) return true;
        }
        return false;
      });
    },
    [],
  );

  // Worker-based filter for large flight counts
  const needsWorker = aircraftScope !== 'all' && !!(selectedFIRData && selectedFIRData.length > 0 && flights.length > WORKER_THRESHOLD);

  useEffect(() => {
    if (!needsWorker || !selectedFIRData) {
      return;
    }

    // Create worker (Vite handles ?worker imports, but we use URL constructor for compat)
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../lib/firFilterWorker.ts', import.meta.url),
        { type: 'module' },
      );
    }

    const worker = workerRef.current;

    const handler = (e: MessageEvent<FIRWorkerResponse>) => {
      setWorkerResult(new Set(e.data.insideIds));
    };
    worker.addEventListener('message', handler);

    const request: FIRWorkerRequest = {
      flights: flights.map((f) => ({ icao24: f.icao24, lat: f.latitude, lng: f.longitude })),
      firs: selectedFIRData,
    };
    worker.postMessage(request);

    return () => {
      worker.removeEventListener('message', handler);
    };
  }, [needsWorker, flights, selectedFIRData]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  // Return filtered flights
  return useMemo(() => {
    // "All Aircraft" mode: bypass spatial filtering entirely
    if (aircraftScope === 'all') {
      return flights;
    }

    // No FIRs selected → no aircraft shown
    if (!selectedFIRData || selectedFIRData.length === 0) {
      return [];
    }

    // Small set: inline
    if (flights.length <= WORKER_THRESHOLD) {
      return inlineFilter(flights, selectedFIRData);
    }

    // Large set: use worker result (may be stale for one frame)
    if (workerResult) {
      return flights.filter((f) => workerResult.has(f.icao24));
    }

    // Worker hasn't responded yet — show nothing until filter settles
    return [];
  }, [flights, selectedFIRData, workerResult, inlineFilter, aircraftScope]);
}
