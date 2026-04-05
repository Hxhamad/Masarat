/**
 * GNSS Anomaly REST Endpoints
 *
 * GET  /api/gnss/fir/:firId/current
 * GET  /api/gnss/fir/:firId/history?hours=24&bucketMinutes=15
 * GET  /api/gnss/hexbins?minLat=..&minLng=..&maxLat=..&maxLng=..&resolution=4
 * POST /api/gnss/summary   (body: { firIds })
 * GET  /api/gnss/leaderboard?firIds=XXXX,YYYY
 */

import type { FastifyInstance } from 'fastify';
import { getGNSSSummary, getGNSSSummaryMulti, getGNSSHistory } from '../db/gnssStore.js';
import { computeGNSSForFIR, computeGNSSHexBins } from '../services/gnssEngine.js';
import { getFIREntry, isFIRDataLoaded, getAllFIREntries } from '../services/firLoader.js';
import type { GeoBounds } from '../types/gnss.js';

const FIR_ID_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_FIR_IDS = 50;
const MIN_H3_RESOLUTION = 2;
const MAX_H3_RESOLUTION = 7;

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseBounds(query: Record<string, unknown>): GeoBounds | null {
  const minLat = parseNumber(query.minLat);
  const minLng = parseNumber(query.minLng);
  const maxLat = parseNumber(query.maxLat);
  const maxLng = parseNumber(query.maxLng);

  if (
    minLat === undefined || minLng === undefined ||
    maxLat === undefined || maxLng === undefined
  ) {
    return null;
  }

  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) return null;
  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180) return null;
  if (maxLat <= minLat) return null;

  return { minLat, minLng, maxLat, maxLng };
}

function isValidFirId(id: unknown): id is string {
  return typeof id === 'string' && FIR_ID_RE.test(id);
}

export async function gnssRoutes(app: FastifyInstance): Promise<void> {

  app.get<{ Querystring: Record<string, string | undefined> }>('/api/gnss/hexbins', async (req, reply) => {
    const bounds = parseBounds(req.query as Record<string, unknown>);
    if (!bounds) {
      return reply.code(400).send({ error: 'Valid minLat, minLng, maxLat, and maxLng are required' });
    }

    const resolution = clampInt(
      parseInt(req.query.resolution ?? String(MIN_H3_RESOLUTION + 2), 10) || (MIN_H3_RESOLUTION + 2),
      MIN_H3_RESOLUTION,
      MAX_H3_RESOLUTION,
    );
    const bucketMinutes = clampInt(parseInt(req.query.bucketMinutes ?? '2', 10) || 2, 1, 60);

    return reply.send(computeGNSSHexBins(bounds, resolution, bucketMinutes));
  });

  // Current GNSS summary for one FIR
  app.get<{ Params: { firId: string } }>('/api/gnss/fir/:firId/current', async (req, reply) => {
    const { firId } = req.params;
    if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID' });
    if (!isFIRDataLoaded()) return reply.code(503).send({ error: 'FIR data still loading' });
    if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

    // Return cached or compute on-demand
    const summary = getGNSSSummary(firId) ?? computeGNSSForFIR(firId);
    if (!summary) return reply.code(503).send({ error: 'Unable to compute GNSS summary' });
    return reply.send({ summary });
  });

  // GNSS history for one FIR
  app.get<{ Params: { firId: string }; Querystring: { hours?: string; bucketMinutes?: string } }>(
    '/api/gnss/fir/:firId/history',
    async (req, reply) => {
      const { firId } = req.params;
      if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID' });
      if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

      const hours = Math.min(parseInt(req.query.hours ?? '24', 10) || 24, 168);
      const history = getGNSSHistory(firId, hours);
      return reply.send({ firId, history });
    },
  );

  // Multi-FIR summary
  app.post<{ Body: { firIds: string[] } }>('/api/gnss/summary', async (req, reply) => {
    const { firIds } = req.body ?? {};
    if (!Array.isArray(firIds) || firIds.length === 0) {
      return reply.code(400).send({ error: 'firIds array required' });
    }
    const ids = firIds.filter(isValidFirId).slice(0, MAX_FIR_IDS);
    if (ids.length === 0) return reply.code(400).send({ error: 'No valid FIR IDs' });
    const results = getGNSSSummaryMulti(ids);
    return reply.send({ results });
  });

  // GNSS leaderboard
  app.get('/api/gnss/leaderboard', async (req, reply) => {
    const { firIds: raw } = req.query as Record<string, string>;
    let ids: string[];

    if (raw) {
      ids = raw.split(',').map((s) => s.trim()).filter(isValidFirId).slice(0, MAX_FIR_IDS);
    } else {
      ids = getAllFIREntries().slice(0, 30).map((e) => e.feature.properties.id);
    }

    const results = getGNSSSummaryMulti(ids);
    const sorted = results.sort((a, b) => b.anomalyScore - a.anomalyScore);

    return reply.send({
      leaderboard: sorted.map((r, idx) => ({
        rank: idx + 1,
        firId: r.firId,
        firName: r.firName,
        country: r.country,
        anomalyScore: r.anomalyScore,
        suspectedAffectedPct: r.suspectedAffectedPct,
        confidence: r.confidence,
        flightCount: r.flightCount,
      })),
    });
  });
}
