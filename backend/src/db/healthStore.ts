/**
 * Health Snapshot Store (SQLite)
 *
 * Stores FIR health snapshots and provides history / peak queries.
 * Extends the existing SQLite setup pattern.
 */

import { getDatabase } from './sqlite.js';
import type { FIRHealthSnapshot } from '../types/fir.js';
import type Database from 'better-sqlite3';

let insertStmt: Database.Statement | null = null;
let historyStmt: Database.Statement | null = null;
let peakStmt: Database.Statement | null = null;
let latestStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;

/** Call once after initDatabase(). Creates the health tables. */
export function initHealthTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS fir_health (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fir_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      flight_count INTEGER NOT NULL,
      chi INTEGER NOT NULL,
      safety_score INTEGER NOT NULL,
      efficiency_score INTEGER NOT NULL,
      fluidity_score INTEGER NOT NULL,
      avg_altitude REAL NOT NULL,
      avg_ground_speed REAL NOT NULL,
      co2_estimate_kg REAL NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_health_fir ON fir_health(fir_id);
    CREATE INDEX IF NOT EXISTS idx_health_ts ON fir_health(timestamp);
    CREATE INDEX IF NOT EXISTS idx_health_fir_ts ON fir_health(fir_id, timestamp);
  `);
}

export function insertHealthSnapshot(s: FIRHealthSnapshot): void {
  const db = getDatabase();
  if (!insertStmt) {
    insertStmt = db.prepare(`
      INSERT INTO fir_health (fir_id, timestamp, flight_count, chi, safety_score,
        efficiency_score, fluidity_score, avg_altitude, avg_ground_speed, co2_estimate_kg)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }
  insertStmt.run(
    s.firId, s.timestamp, s.flightCount, s.chi,
    s.safetyScore, s.efficiencyScore, s.fluidityScore,
    s.avgAltitude, s.avgGroundSpeed, s.co2EstimateKg
  );
}

/** Get the last 24h of health snapshots for a FIR, ordered newest first. */
export function getHealthHistory(firId: string, hours = 24, limit = 288): FIRHealthSnapshot[] {
  const db = getDatabase();
  if (!historyStmt) {
    historyStmt = db.prepare(`
      SELECT fir_id as firId, timestamp, flight_count as flightCount,
        chi, safety_score as safetyScore, efficiency_score as efficiencyScore,
        fluidity_score as fluidityScore, avg_altitude as avgAltitude,
        avg_ground_speed as avgGroundSpeed, co2_estimate_kg as co2EstimateKg
      FROM fir_health
      WHERE fir_id = ? AND timestamp > ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
  }
  const cutoff = Date.now() - hours * 3_600_000;
  return historyStmt.all(firId, cutoff, limit) as FIRHealthSnapshot[];
}

/** Get the latest snapshot for a FIR. */
export function getLatestSnapshot(firId: string): FIRHealthSnapshot | undefined {
  const db = getDatabase();
  if (!latestStmt) {
    latestStmt = db.prepare(`
      SELECT fir_id as firId, timestamp, flight_count as flightCount,
        chi, safety_score as safetyScore, efficiency_score as efficiencyScore,
        fluidity_score as fluidityScore, avg_altitude as avgAltitude,
        avg_ground_speed as avgGroundSpeed, co2_estimate_kg as co2EstimateKg
      FROM fir_health
      WHERE fir_id = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);
  }
  return latestStmt.get(firId) as FIRHealthSnapshot | undefined;
}

/** Highest flight count ever recorded for this FIR (for fluidity / saturation). */
export function getHistoricalPeak(firId: string): number {
  const db = getDatabase();
  if (!peakStmt) {
    peakStmt = db.prepare(
      'SELECT MAX(flight_count) as peak FROM fir_health WHERE fir_id = ?'
    );
  }
  const row = peakStmt.get(firId) as { peak: number | null } | undefined;
  return row?.peak ?? 0;
}

/** Remove health data older than maxAgeMs (default 7 days). */
export function cleanupOldHealth(maxAgeMs = 7 * 86_400_000): number {
  const db = getDatabase();
  if (!cleanupStmt) {
    cleanupStmt = db.prepare('DELETE FROM fir_health WHERE timestamp < ?');
  }
  const result = cleanupStmt.run(Date.now() - maxAgeMs);
  return result.changes;
}
