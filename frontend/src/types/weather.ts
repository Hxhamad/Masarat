export type WeatherSource = 'aviationweather' | 'open-meteo' | 'rainviewer';
export type FlightCategory = 'vfr' | 'mvfr' | 'ifr' | 'lifr';
export type AlertProduct = 'sigmet' | 'g-airmet' | 'cwa' | 'pirep';
export type AlertSeverity = 'info' | 'caution' | 'warning';

export interface METARObservation {
  stationId: string;
  lat: number;
  lon: number;
  elevationFt?: number;
  observedAt: number;
  rawText: string;
  flightCategory?: FlightCategory;
  windDirectionDeg?: number;
  windSpeedKt?: number;
  windGustKt?: number;
  visibilitySm?: number;
  ceilingFt?: number;
  temperatureC?: number;
  dewpointC?: number;
  altimeterInHg?: number;
  firIds: string[];
}

export interface WeatherAlertSummary {
  id: string;
  productType: AlertProduct;
  severity: AlertSeverity;
  issuedAt: number;
  validFrom?: number;
  validTo?: number;
  title: string;
  summary: string;
  firIds: string[];
  geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export interface RadarFrame {
  timestamp: number;
  tileUrlTemplate: string;
  colorScheme?: number;
  snow?: boolean;
}

export interface RadarFrameCatalog {
  provider: 'rainviewer';
  generatedAt: number;
  frames: RadarFrame[];
}

export interface FIRForecastHourly {
  time: number[];
  precipitationMm: number[];
  visibilityM: number[];
  cloudCoverPct: number[];
  capeJkg?: number[];
  freezingLevelM?: number[];
  windSpeed925hPaKt?: number[];
}

export interface FIRForecastSummary {
  firId: string;
  generatedAt: number;
  hours: number;
  hourly: FIRForecastHourly;
}
