/**
 * GNSS Store (SQLite)
 *
 * Persists GNSS anomaly summaries and history for FIRs.
 */

import { getDatabase } from './sqlite.js';
import type Database from 'better-sqlite3';
import type { GNSSFIRSummary, GNSSHistoryPoint, GNSSConfidence } from '../types/gnss.js';

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

let upsertSummaryStmt: Database.Statement | null = null;
let summaryByFirStmt: Database.Statement | null = null;
let insertHistoryStmt: Database.Statement | null = null;
let historyByFirStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;

export function initGNSSTables(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS gnss_fir_summary (
      fir_id TEXT PRIMARY KEY,
      fir_name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT '',
      computed_at INTEGER NOT NULL,
      flight_count INTEGER NOT NULL,
      anomaly_score REAL NOT NULL,
      suspected_affected_pct REAL NOT NULL,
      confidence TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gnss_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fir_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      anomaly_score REAL NOT NULL,
      suspected_affected_pct REAL NOT NULL,
      flight_count INTEGER NOT NULL,
      confidence TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_gnss_hist_fir ON gnss_history(fir_id);
    CREATE INDEX IF NOT EXISTS idx_gnss_hist_ts ON gnss_history(fir_id, timestamp);
  `);
}

export function upsertGNSSSummary(s: GNSSFIRSummary): void {
  const db = getDatabase();
  if (!upsertSummaryStmt) {
    upsertSummaryStmt = db.prepare(`
      INSERT INTO gnss_fir_summary
        (fir_id, fir_name, country, computed_at, flight_count,
         anomaly_score, suspected_affected_pct, confidence, evidence_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fir_id) DO UPDATE SET
        fir_name=excluded.fir_name, country=excluded.country,
        computed_at=excluded.computed_at, flight_count=excluded.flight_count,
        anomaly_score=excluded.anomaly_score,
        suspected_affected_pct=excluded.suspected_affected_pct,
        confidence=excluded.confidence, evidence_json=excluded.evidence_json
    `);
  }
  upsertSummaryStmt.run(
    s.firId, s.firName, s.country, s.computedAt, s.flightCount,
    s.anomalyScore, s.suspectedAffectedPct, s.confidence,
    JSON.stringify(s.evidence),
  );
}

export function getGNSSSummary(firId: string): GNSSFIRSummary | undefined {
  const db = getDatabase();
  if (!summaryByFirStmt) {
    summaryByFirStmt = db.prepare('SELECT * FROM gnss_fir_summary WHERE fir_id = ?');
  }
  const row = summaryByFirStmt.get(firId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToSummary(row);
}

export function getGNSSSummaryMulti(firIds: string[]): GNSSFIRSummary[] {
  return firIds.map((id) => getGNSSSummary(id)).filter((s): s is GNSSFIRSummary => s !== undefined);
}

function rowToSummary(r: Record<string, unknown>): GNSSFIRSummary {
  return {
    firId: r.fir_id as string,
    firName: r.fir_name as string,
    country: r.country as string,
    computedAt: r.computed_at as number,
    flightCount: r.flight_count as number,
    anomalyScore: r.anomaly_score as number,
    suspectedAffectedPct: r.suspected_affected_pct as number,
    confidence: r.confidence as GNSSConfidence,
    evidence: safeJsonParse<GNSSFIRSummary['evidence']>(r.evidence_json, {
      navIntegrityPresent: false,
      mlatShareElevated: false,
      positionDropoutElevated: false,
      crossSourceAgreement: false,
    }),
  };
}

export function insertGNSSHistory(firId: string, point: GNSSHistoryPoint): void {
  const db = getDatabase();
  if (!insertHistoryStmt) {
    insertHistoryStmt = db.prepare(`
      INSERT INTO gnss_history
        (fir_id, timestamp, anomaly_score, suspected_affected_pct, flight_count, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }
  insertHistoryStmt.run(
    firId, point.timestamp, point.anomalyScore,
    point.suspectedAffectedPct, point.flightCount, point.confidence,
  );
}

export function getGNSSHistory(firId: string, hours = 24): GNSSHistoryPoint[] {
  const db = getDatabase();
  if (!historyByFirStmt) {
    historyByFirStmt = db.prepare(`
      SELECT timestamp, anomaly_score as anomalyScore,
        suspected_affected_pct as suspectedAffectedPct,
        flight_count as flightCount, confidence
      FROM gnss_history
      WHERE fir_id = ? AND timestamp > ?
      ORDER BY timestamp DESC
      LIMIT 500
    `);
  }
  const cutoff = Date.now() - hours * 3_600_000;
  return historyByFirStmt.all(firId, cutoff) as GNSSHistoryPoint[];
}

export function cleanupOldGNSS(maxAgeMs = 7 * 86_400_000): number {
  const db = getDatabase();
  if (!cleanupStmt) {
    cleanupStmt = db.prepare('DELETE FROM gnss_history WHERE timestamp < ?');
  }
  return cleanupStmt.run(Date.now() - maxAgeMs).changes;
}
