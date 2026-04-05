import type { Feature, Polygon, MultiPolygon } from 'geojson';

export interface FIRProperties {
  id: string;         // e.g. "OEJD" (ICAO code)
  name: string;       // e.g. "Jeddah FIR"
  country: string;    // e.g. "Saudi Arabia"
}

export type FIRFeature = Feature<Polygon | MultiPolygon, FIRProperties>;

export interface FIRBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
