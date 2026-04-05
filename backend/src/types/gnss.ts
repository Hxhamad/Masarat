export type GNSSConfidence = 'insufficient-data' | 'low' | 'medium' | 'high';

export interface GNSSEvidenceFlags {
  navIntegrityPresent: boolean;
  mlatShareElevated: boolean;
  positionDropoutElevated: boolean;
  crossSourceAgreement: boolean;
}

export interface GeoBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface GNSSHexBin {
  h3Index: string;
  centroidLat: number;
  centroidLon: number;
  bucketStart: number;      // epoch ms
  bucketMinutes: number;
  computedAt: number;
  flightCount: number;
  anomalyScore: number;     // 0–100
  suspectedAffectedPct: number;
  confidence: GNSSConfidence;
  evidence: GNSSEvidenceFlags;
}

export interface GNSSFIRSummary {
  firId: string;
  firName: string;
  country: string;
  computedAt: number;       // epoch ms
  flightCount: number;
  anomalyScore: number;     // 0–100
  suspectedAffectedPct: number;
  confidence: GNSSConfidence;
  evidence: GNSSEvidenceFlags;
}

export interface GNSSHistoryPoint {
  timestamp: number;        // epoch ms
  anomalyScore: number;
  suspectedAffectedPct: number;
  flightCount: number;
  confidence: GNSSConfidence;
}

export interface GNSSHexBinsResponse {
  generatedAt: number;
  resolution: number;
  bucketMinutes: number;
  bounds: GeoBounds;
  inputFlightCount: number;
  cellCount: number;
  bins: GNSSHexBin[];
}
