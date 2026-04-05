export interface NavQuality {
  nic?: number;
  nacp?: number;
  sil?: number;
  sda?: number;
  positionSource?: 'adsb' | 'mlat' | 'other';
  lastPositionAgeSec?: number;
  sourceFeed?: DataSource;
}

export interface OnboardMet {
  windDirectionDeg?: number;
  windSpeedKt?: number;
  oatC?: number;
  tatC?: number;
  qnhHpa?: number;
}

export interface ADSBFlight {
  icao24: string;
  callsign: string;
  registration: string;
  aircraftType: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  groundSpeed: number;
  verticalRate: number;
  squawk: string;
  source: 'adsb' | 'mlat' | 'other';
  category: string;
  isOnGround: boolean;
  lastSeen: number;
  timestamp: number;
  type: 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
  trail: TrailPoint[];
  navQuality?: NavQuality;
  met?: OnboardMet;
}

export interface TrailPoint {
  lat: number;
  lon: number;
  alt: number;
  ts: number;
}

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type DataSource = 'adsb-lol' | 'airplanes-live' | 'opensky';

export interface AggregatorStats {
  totalFlights: number;
  dataSource: DataSource;
  lastUpdate: number;
  messagesPerSecond: number;
}

export interface WSFlightUpdate {
  type: 'flight-update';
  data: ADSBFlight[];
}

export interface WSFlightRemove {
  type: 'flight-remove';
  data: string[];
}

export interface WSStats {
  type: 'stats';
  data: AggregatorStats;
}

export type WSMessage = WSFlightUpdate | WSFlightRemove | WSStats;
