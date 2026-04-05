// FIR Health types (matches backend responses)

export interface FIRHealthSnapshot {
  firId: string;
  timestamp: number;
  flightCount: number;
  chi: number;
  safetyScore: number;
  efficiencyScore: number;
  fluidityScore: number;
  avgAltitude: number;
  avgGroundSpeed: number;
  co2EstimateKg: number;
}

export interface InefficiencyEntry {
  icao24: string;
  callsign: string;
  kea: number;
  detourKm: number;
}

export interface FIRHealthSummary extends FIRHealthSnapshot {
  firName: string;
  country: string;
  saturationPct: number;
  topInefficient: InefficiencyEntry[];
}

export interface LeaderboardEntry {
  rank: number;
  firId: string;
  firName: string;
  country: string;
  chi: number;
  flightCount: number;
  efficiencyScore: number;
  saturationPct: number;
  co2EstimateKg: number;
}
