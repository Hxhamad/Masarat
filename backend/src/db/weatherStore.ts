/**
 * Weather Store (SQLite)
 *
 * Persists METAR observations, alerts, FIR forecast summaries,
 * and radar frame catalog metadata.
 */

import { getDatabase } from './sqlite.js';
import type Database from 'better-sqlite3';
import type {
  METARObservation,
  WeatherAlertSummary,
  RadarFrameCatalog,
  FIRForecastSummary,
} from '../types/weather.js';

let upsertMetarStmt: Database.Statement | null = null;
let metarByFirStmt: Database.Statement | null = null;
let metarByBoundsStmt: Database.Statement | null = null;
let upsertAlertStmt: Database.Statement | null = null;
let alertsByFirStmt: Database.Statement | null = null;
let upsertForecastStmt: Database.Statement | null = null;
let forecastByFirStmt: Database.Statement | null = null;
let cleanupMetarStmt: Database.Statement | null = null;
let cleanupAlertsStmt: Database.Statement | null = null;

export function initWeatherTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_metar (
      station_id TEXT PRIMARY KEY,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      elevation_ft REAL,
      observed_at INTEGER NOT NULL,
      raw_text TEXT NOT NULL,
      flight_category TEXT,
      wind_direction_deg REAL,
      wind_speed_kt REAL,
      wind_gust_kt REAL,
      visibility_sm REAL,
      ceiling_ft REAL,
      temperature_c REAL,
      dewpoint_c REAL,
      altimeter_inhg REAL,
      fir_ids TEXT NOT NULL DEFAULT '[]'
    );

    CREATE INDEX IF NOT EXISTS idx_metar_observed ON weather_metar(observed_at);
    CREATE INDEX IF NOT EXISTS idx_metar_lat_lon ON weather_metar(lat, lon);

    CREATE TABLE IF NOT EXISTS weather_alerts (
      id TEXT PRIMARY KEY,
      product_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      valid_from INTEGER,
      valid_to INTEGER,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      fir_ids TEXT NOT NULL DEFAULT '[]',
      geometry TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_alerts_issued ON weather_alerts(issued_at);

    CREATE TABLE IF NOT EXISTS weather_forecast (
      fir_id TEXT PRIMARY KEY,
      generated_at INTEGER NOT NULL,
      hours INTEGER NOT NULL,
      hourly_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS weather_radar_catalog (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      provider TEXT NOT NULL DEFAULT 'rainviewer',
      generated_at INTEGER NOT NULL,
      frames_json TEXT NOT NULL
    );
  `);
}

// ===== METAR =====

export function upsertMetar(obs: METARObservation): void {
  const db = getDatabase();
  if (!upsertMetarStmt) {
    upsertMetarStmt = db.prepare(`
      INSERT INTO weather_metar
        (station_id, lat, lon, elevation_ft, observed_at, raw_text,
         flight_category, wind_direction_deg, wind_speed_kt, wind_gust_kt,
         visibility_sm, ceiling_ft, temperature_c, dewpoint_c, altimeter_inhg, fir_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(station_id) DO UPDATE SET
        lat=excluded.lat, lon=excluded.lon, elevation_ft=excluded.elevation_ft,
        observed_at=excluded.observed_at, raw_text=excluded.raw_text,
        flight_category=excluded.flight_category,
        wind_direction_deg=excluded.wind_direction_deg,
        wind_speed_kt=excluded.wind_speed_kt, wind_gust_kt=excluded.wind_gust_kt,
        visibility_sm=excluded.visibility_sm, ceiling_ft=excluded.ceiling_ft,
        temperature_c=excluded.temperature_c, dewpoint_c=excluded.dewpoint_c,
        altimeter_inhg=excluded.altimeter_inhg, fir_ids=excluded.fir_ids
    `);
  }
  upsertMetarStmt.run(
    obs.stationId, obs.lat, obs.lon, obs.elevationFt ?? null,
    obs.observedAt, obs.rawText, obs.flightCategory ?? null,
    obs.windDirectionDeg ?? null, obs.windSpeedKt ?? null, obs.windGustKt ?? null,
    obs.visibilitySm ?? null, obs.ceilingFt ?? null,
    obs.temperatureC ?? null, obs.dewpointC ?? null,
    obs.altimeterInHg ?? null, JSON.stringify(obs.firIds),
  );
}

export function upsertMetarBatch(items: METARObservation[]): void {
  const db = getDatabase();
  const tx = db.transaction(() => {
    for (const obs of items) upsertMetar(obs);
  });
  tx();
}

export function getMetarByFIR(firId: string): METARObservation[] {
  const db = getDatabase();
  if (!metarByFirStmt) {
    metarByFirStmt = db.prepare(`
      SELECT * FROM weather_metar
      WHERE fir_ids LIKE ?
      ORDER BY observed_at DESC
    `);
  }
  const rows = metarByFirStmt.all(`%"${firId}"%`) as Record<string, unknown>[];
  return rows.map(rowToMetar);
}

export function getMetarByBounds(
  south: number, west: number, north: number, east: number,
): METARObservation[] {
  const db = getDatabase();
  if (!metarByBoundsStmt) {
    metarByBoundsStmt = db.prepare(`
      SELECT * FROM weather_metar
      WHERE lat >= ? AND lat <= ? AND lon >= ? AND lon <= ?
      ORDER BY observed_at DESC
    `);
  }
  const rows = metarByBoundsStmt.all(south, north, west, east) as Record<string, unknown>[];
  return rows.map(rowToMetar);
}

function rowToMetar(r: Record<string, unknown>): METARObservation {
  return {
    stationId: r.station_id as string,
    lat: r.lat as number,
    lon: r.lon as number,
    elevationFt: r.elevation_ft as number | undefined,
    observedAt: r.observed_at as number,
    rawText: r.raw_text as string,
    flightCategory: (r.flight_category as METARObservation['flightCategory']) ?? undefined,
    windDirectionDeg: r.wind_direction_deg as number | undefined,
    windSpeedKt: r.wind_speed_kt as number | undefined,
    windGustKt: r.wind_gust_kt as number | undefined,
    visibilitySm: r.visibility_sm as number | undefined,
    ceilingFt: r.ceiling_ft as number | undefined,
    temperatureC: r.temperature_c as number | undefined,
    dewpointC: r.dewpoint_c as number | undefined,
    altimeterInHg: r.altimeter_inhg as number | undefined,
    firIds: JSON.parse((r.fir_ids as string) || '[]'),
  };
}

// ===== Alerts =====

export function upsertAlert(a: WeatherAlertSummary): void {
  const db = getDatabase();
  if (!upsertAlertStmt) {
    upsertAlertStmt = db.prepare(`
      INSERT INTO weather_alerts
        (id, product_type, severity, issued_at, valid_from, valid_to,
         title, summary, fir_ids, geometry)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        product_type=excluded.product_type, severity=excluded.severity,
        issued_at=excluded.issued_at, valid_from=excluded.valid_from,
        valid_to=excluded.valid_to, title=excluded.title,
        summary=excluded.summary, fir_ids=excluded.fir_ids,
        geometry=excluded.geometry
    `);
  }
  upsertAlertStmt.run(
    a.id, a.productType, a.severity, a.issuedAt,
    a.validFrom ?? null, a.validTo ?? null,
    a.title, a.summary,
    JSON.stringify(a.firIds),
    a.geometry ? JSON.stringify(a.geometry) : null,
  );
}

export function upsertAlertBatch(items: WeatherAlertSummary[]): void {
  const db = getDatabase();
  const tx = db.transaction(() => {
    for (const a of items) upsertAlert(a);
  });
  tx();
}

export function getAlertsByFIRs(firIds: string[]): WeatherAlertSummary[] {
  const db = getDatabase();
  if (!alertsByFirStmt) {
    alertsByFirStmt = db.prepare(`
      SELECT * FROM weather_alerts ORDER BY issued_at DESC
    `);
  }
  const rows = alertsByFirStmt.all() as Record<string, unknown>[];
  return rows
    .map(rowToAlert)
    .filter((a) => a.firIds.some((f) => firIds.includes(f)));
}

function rowToAlert(r: Record<string, unknown>): WeatherAlertSummary {
  return {
    id: r.id as string,
    productType: r.product_type as WeatherAlertSummary['productType'],
    severity: r.severity as WeatherAlertSummary['severity'],
    issuedAt: r.issued_at as number,
    validFrom: r.valid_from as number | undefined,
    validTo: r.valid_to as number | undefined,
    title: r.title as string,
    summary: r.summary as string,
    firIds: JSON.parse((r.fir_ids as string) || '[]'),
    geometry: r.geometry ? JSON.parse(r.geometry as string) : undefined,
  };
}

// ===== FIR Forecast =====

export function upsertForecast(f: FIRForecastSummary): void {
  const db = getDatabase();
  if (!upsertForecastStmt) {
    upsertForecastStmt = db.prepare(`
      INSERT INTO weather_forecast (fir_id, generated_at, hours, hourly_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(fir_id) DO UPDATE SET
        generated_at=excluded.generated_at,
        hours=excluded.hours,
        hourly_json=excluded.hourly_json
    `);
  }
  upsertForecastStmt.run(f.firId, f.generatedAt, f.hours, JSON.stringify(f.hourly));
}

export function getForecast(firId: string): FIRForecastSummary | undefined {
  const db = getDatabase();
  if (!forecastByFirStmt) {
    forecastByFirStmt = db.prepare(
      'SELECT * FROM weather_forecast WHERE fir_id = ?',
    );
  }
  const row = forecastByFirStmt.get(firId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    firId: row.fir_id as string,
    generatedAt: row.generated_at as number,
    hours: row.hours as number,
    hourly: JSON.parse(row.hourly_json as string),
  };
}

// ===== Radar catalog =====

export function upsertRadarCatalog(catalog: RadarFrameCatalog): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO weather_radar_catalog (id, provider, generated_at, frames_json)
    VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider=excluded.provider,
      generated_at=excluded.generated_at,
      frames_json=excluded.frames_json
  `).run(catalog.provider, catalog.generatedAt, JSON.stringify(catalog.frames));
}

export function getRadarCatalog(): RadarFrameCatalog | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM weather_radar_catalog WHERE id = 1').get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    provider: row.provider as 'rainviewer',
    generatedAt: row.generated_at as number,
    frames: JSON.parse(row.frames_json as string),
  };
}

// ===== Cleanup =====

export function cleanupOldMetar(maxAgeMs = 24 * 3_600_000): number {
  const db = getDatabase();
  if (!cleanupMetarStmt) {
    cleanupMetarStmt = db.prepare('DELETE FROM weather_metar WHERE observed_at < ?');
  }
  return cleanupMetarStmt.run(Date.now() - maxAgeMs).changes;
}

export function cleanupOldAlerts(maxAgeMs = 48 * 3_600_000): number {
  const db = getDatabase();
  if (!cleanupAlertsStmt) {
    cleanupAlertsStmt = db.prepare('DELETE FROM weather_alerts WHERE issued_at < ?');
  }
  return cleanupAlertsStmt.run(Date.now() - maxAgeMs).changes;
}
