// ===== Normalized Internal Model =====

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
  altitude: number;        // feet MSL, 0 = ground
  heading: number;         // degrees true (0-359)
  groundSpeed: number;     // knots
  verticalRate: number;    // ft/min
  squawk: string;
  source: 'adsb' | 'mlat' | 'other';
  category: string;        // emitter category (A0-D7)
  isOnGround: boolean;
  lastSeen: number;        // seconds since last message
  timestamp: number;       // epoch ms when this record was created/updated
  type: 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
  trail: TrailPoint[];
  navQuality?: NavQuality;
  met?: OnboardMet;
}

export interface TrailPoint {
  lat: number;
  lon: number;
  alt: number;
  ts: number; // epoch ms
}

// ===== readsb v2 JSON Format (adsb.lol + airplanes.live) =====

export interface ReadsBAircraft {
  hex: string;
  type?: string;           // adsb_icao, mlat, etc.
  flight?: string;         // callsign, 8 chars space-padded
  r?: string;              // registration
  t?: string;              // aircraft type code (A320, B738)
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;             // ground speed knots
  track?: number;          // true track degrees
  baro_rate?: number;      // vertical rate ft/min
  geom_rate?: number;
  squawk?: string;
  lat?: number;
  lon?: number;
  seen?: number;           // seconds since last message
  seen_pos?: number;       // seconds since last position
  messages?: number;
  category?: string;       // A0-D7
  dbFlags?: number;        // 1=military, 2=interesting, 4=PIA, 8=LADD
  emergency?: string;
  nav_qnh?: number;
  nav_altitude_mcp?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  true_heading?: number;
  mag_heading?: number;
  wd?: number;             // wind direction
  ws?: number;             // wind speed
  oat?: number;            // outside air temp
  tat?: number;            // total air temp
  mlat?: string[];
  tisb?: string[];
  rssi?: number;
  alert?: number;
  spi?: number;
}

export interface ReadsBResponse {
  ac: ReadsBAircraft[];
  msg: string;
  now: number;       // epoch ms
  total: number;
  ctime: number;
  ptime: number;
}

// Alias to match the interface name (capital B)
export type ReadsBaircraft = ReadsBAircraft;

// ===== OpenSky Network Format (Fallback) =====

// OpenSky state vector is a positional array:
// [0] icao24, [1] callsign, [2] origin_country, [3] time_position,
// [4] last_contact, [5] longitude, [6] latitude, [7] baro_altitude (meters),
// [8] on_ground, [9] velocity (m/s), [10] true_track, [11] vertical_rate (m/s),
// [12] sensors, [13] geo_altitude (meters), [14] squawk, [15] spi, [16] position_source

export type OpenSkyStateVector = [
  string,           // 0: icao24
  string | null,    // 1: callsign
  string,           // 2: origin_country
  number | null,    // 3: time_position
  number,           // 4: last_contact
  number | null,    // 5: longitude
  number | null,    // 6: latitude
  number | null,    // 7: baro_altitude (meters)
  boolean,          // 8: on_ground
  number | null,    // 9: velocity (m/s)
  number | null,    // 10: true_track (degrees)
  number | null,    // 11: vertical_rate (m/s)
  number[] | null,  // 12: sensors
  number | null,    // 13: geo_altitude (meters)
  string | null,    // 14: squawk
  boolean,          // 15: spi
  number,           // 16: position_source (0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM)
];

export interface OpenSkyResponse {
  time: number;
  states: OpenSkyStateVector[] | null;
}

// ===== Aggregator Status =====

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';
export type DataSource = 'adsb-lol' | 'airplanes-live' | 'opensky';

export interface AggregatorStats {
  totalFlights: number;
  dataSource: DataSource;
  lastUpdate: number;
  messagesPerSecond: number;
}

// ===== WebSocket Event Types =====

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

// ===== Client → Server WS commands =====

export interface WSSubscribe {
  type: 'subscribe';
  viewport: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
}

export interface WSUnsubscribe {
  type: 'unsubscribe';
}

export type WSClientMessage = WSSubscribe | WSUnsubscribe;
