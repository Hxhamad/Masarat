/**
 * Weather Mapper
 *
 * Converts raw upstream responses into the shared weather types.
 */

import type {
  METARObservation,
  WeatherAlertSummary,
  FlightCategory,
  AlertProduct,
  AlertSeverity,
} from '../types/weather.js';

// ===== AviationWeather.gov METAR mapping =====

interface AvwxMetarRaw {
  stationId?: string;
  icaoId?: string;
  lat?: number;
  lon?: number;
  elev?: number;
  obsTime?: number;
  reportTime?: string;
  rawOb?: string;
  rawTaf?: string;
  fltCat?: string;
  wdir?: number;
  wspd?: number;
  wgst?: number;
  visib?: number | string;
  ceil?: number;
  temp?: number;
  dewp?: number;
  altim?: number;
}

export function mapMetar(raw: AvwxMetarRaw, firIds: string[] = []): METARObservation | null {
  const sid = raw.stationId ?? raw.icaoId;
  if (!sid || raw.lat == null || raw.lon == null) return null;

  return {
    stationId: sid,
    lat: raw.lat,
    lon: raw.lon,
    elevationFt: raw.elev ?? undefined,
    observedAt: raw.obsTime ? raw.obsTime * 1000 : Date.now(),
    rawText: raw.rawOb ?? '',
    flightCategory: normalizeFlightCategory(raw.fltCat),
    windDirectionDeg: raw.wdir ?? undefined,
    windSpeedKt: raw.wspd ?? undefined,
    windGustKt: raw.wgst ?? undefined,
    visibilitySm: typeof raw.visib === 'number' ? raw.visib : undefined,
    ceilingFt: raw.ceil ?? undefined,
    temperatureC: raw.temp ?? undefined,
    dewpointC: raw.dewp ?? undefined,
    altimeterInHg: raw.altim ?? undefined,
    firIds,
  };
}

function normalizeFlightCategory(cat?: string): FlightCategory | undefined {
  if (!cat) return undefined;
  const lower = cat.toLowerCase() as FlightCategory;
  if (['vfr', 'mvfr', 'ifr', 'lifr'].includes(lower)) return lower;
  return undefined;
}

// ===== AviationWeather.gov alert / product mapping =====

interface AvwxAlertRaw {
  airSigmetId?: string;
  hazard?: string;
  severity?: string;
  issueTime?: string;
  validTimeFrom?: string;
  validTimeTo?: string;
  rawAirSigmet?: string;
  alphaChar?: string;
  firId?: string;
  geom?: string;
  // PIREP fields
  pirepId?: string;
  pirepType?: string;
  rawOb?: string;
  obsTime?: number;
}

export function mapAlert(raw: AvwxAlertRaw, productType: AlertProduct, firIds: string[] = []): WeatherAlertSummary | null {
  const id = raw.airSigmetId ?? raw.pirepId ?? '';
  if (!id) return null;

  let geometry: WeatherAlertSummary['geometry'];
  if (raw.geom) {
    try { geometry = JSON.parse(raw.geom); } catch { /* skip */ }
  }

  return {
    id,
    productType,
    severity: normalizeSeverity(raw.severity ?? raw.pirepType),
    issuedAt: raw.issueTime ? new Date(raw.issueTime).getTime() : (raw.obsTime ? raw.obsTime * 1000 : Date.now()),
    validFrom: raw.validTimeFrom ? new Date(raw.validTimeFrom).getTime() : undefined,
    validTo: raw.validTimeTo ? new Date(raw.validTimeTo).getTime() : undefined,
    title: raw.hazard ?? raw.pirepType ?? productType.toUpperCase(),
    summary: raw.rawAirSigmet ?? raw.rawOb ?? '',
    firIds: raw.firId ? [raw.firId, ...firIds] : firIds,
    geometry,
  };
}

function normalizeSeverity(raw?: string): AlertSeverity {
  if (!raw) return 'info';
  const upper = raw.toUpperCase();
  if (upper.includes('SEV') || upper === 'WARNING') return 'warning';
  if (upper.includes('MOD') || upper === 'CAUTION') return 'caution';
  return 'info';
}
