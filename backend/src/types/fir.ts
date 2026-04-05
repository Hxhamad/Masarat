import type { Feature, Polygon, MultiPolygon } from 'geojson';

export interface FIRProperties {
  id: string;       // ICAO code, e.g. "OEJD"
  name: string;     // e.g. "Jeddah FIR"
  country: string;  // e.g. "Saudi Arabia"
}

export type FIRFeature = Feature<Polygon | MultiPolygon, FIRProperties>;

export interface FIRBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface FIREntry {
  feature: FIRFeature;
  bounds: FIRBounds;
}

// ===== Health / KPI Types =====

export interface FIRHealthSnapshot {
  firId: string;
  timestamp: number;        // epoch ms
  flightCount: number;
  chi: number;              // Consolidated Health Index 0–100
  safetyScore: number;      // 0–100
  efficiencyScore: number;  // 0–100
  fluidityScore: number;    // 0–100
  avgAltitude: number;
  avgGroundSpeed: number;
  co2EstimateKg: number;    // rough estimate
}

export interface FIRHealthSummary extends FIRHealthSnapshot {
  firName: string;
  country: string;
  saturationPct: number;    // current / peak ratio
  topInefficient: InefficiencyEntry[];
}

export interface InefficiencyEntry {
  icao24: string;
  callsign: string;
  kea: number;              // ratio ≥ 1.0 (actual / great-circle)
  detourKm: number;
}

export interface LeaderboardEntry {
  firId: string;
  firName: string;
  country: string;
  chi: number;
  flightCount: number;
  efficiencyScore: number;
  saturationPct: number;
  co2EstimateKg: number;
}
