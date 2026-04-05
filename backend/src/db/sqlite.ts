import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'masarat.db');
const TRAIL_FLUSH_INTERVAL_MS = 1_000;
const TRAIL_FLUSH_BATCH_SIZE = 1_000;

let db: Database.Database;

interface TrailInsertRow {
  icao24: string;
  lat: number;
  lon: number;
  alt: number;
  ts: number;
}

export function initDatabase(): Database.Database {
  db = new Database(DB_PATH);
  
  // WAL mode for concurrent reads during writes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('temp_store = MEMORY');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS trail_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      icao24 TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude REAL NOT NULL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_trail_icao24 ON trail_history(icao24);
    CREATE INDEX IF NOT EXISTS idx_trail_timestamp ON trail_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trail_icao24_ts ON trail_history(icao24, timestamp);
  `);

  if (trailFlushTimer) {
    clearInterval(trailFlushTimer);
  }
  trailFlushTimer = setInterval(() => {
    try {
      flushQueuedTrailPoints();
    } catch (error) {
      console.error('[db] Failed to flush queued trail points:', (error as Error).message);
    }
  }, TRAIL_FLUSH_INTERVAL_MS);
  trailFlushTimer.unref?.();

  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

// Prepared statements for performance
let insertTrailStmt: Database.Statement | null = null;
let getTrailStmt: Database.Statement | null = null;
let cleanupStmt: Database.Statement | null = null;
let insertTrailBatchTxn: ((rows: TrailInsertRow[]) => void) | null = null;
let trailFlushTimer: ReturnType<typeof setInterval> | null = null;
let queuedTrailPoints: TrailInsertRow[] = [];

function ensureTrailStatements(): void {
  if (!insertTrailStmt) {
    insertTrailStmt = db.prepare(
      'INSERT INTO trail_history (icao24, latitude, longitude, altitude, timestamp) VALUES (?, ?, ?, ?, ?)'
    );
  }

  if (!insertTrailBatchTxn) {
    insertTrailBatchTxn = db.transaction((rows: TrailInsertRow[]) => {
      for (const row of rows) {
        insertTrailStmt!.run(row.icao24, row.lat, row.lon, row.alt, row.ts);
      }
    });
  }

  if (!getTrailStmt) {
    getTrailStmt = db.prepare(
      'SELECT latitude as lat, longitude as lon, altitude as alt, timestamp as ts FROM trail_history WHERE icao24 = ? ORDER BY timestamp DESC LIMIT ?'
    );
  }

  if (!cleanupStmt) {
    cleanupStmt = db.prepare('DELETE FROM trail_history WHERE timestamp < ?');
  }
}

function flushQueuedTrailPoints(): void {
  if (!db || queuedTrailPoints.length === 0) {
    return;
  }

  ensureTrailStatements();

  const batch = queuedTrailPoints;
  queuedTrailPoints = [];
  insertTrailBatchTxn!(batch);
}

export function insertTrailPoint(icao24: string, lat: number, lon: number, alt: number, ts: number): void {
  queuedTrailPoints.push({ icao24, lat, lon, alt, ts });

  if (queuedTrailPoints.length >= TRAIL_FLUSH_BATCH_SIZE) {
    flushQueuedTrailPoints();
  }
}

export function getTrailHistory(icao24: string, limit = 60): Array<{ lat: number; lon: number; alt: number; ts: number }> {
  flushQueuedTrailPoints();
  ensureTrailStatements();
  return getTrailStmt!.all(icao24, limit) as Array<{ lat: number; lon: number; alt: number; ts: number }>;
}

/** Delete trail points older than maxAgeMs (default 24h) */
export function cleanupOldTrails(maxAgeMs = 86_400_000): number {
  flushQueuedTrailPoints();
  ensureTrailStatements();
  const result = cleanupStmt!.run(Date.now() - maxAgeMs);
  return result.changes;
}

export function closeDatabase(): void {
  if (db) {
    if (trailFlushTimer) {
      clearInterval(trailFlushTimer);
      trailFlushTimer = null;
    }
    flushQueuedTrailPoints();
    db.close();
  }
}
