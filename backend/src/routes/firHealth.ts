/**
 * FIR Health REST Endpoints
 *
 * GET  /api/fir/list                — list all loaded FIR IDs / names
 * GET  /api/fir/:firId/health       — current health summary for one FIR
 * GET  /api/fir/:firId/history      — 24h health history
 * GET  /api/fir/:firId/flights      — live flights inside the FIR
 * POST /api/fir/health              — health summary for multiple FIRs (body: { firIds: string[] })
 * GET  /api/fir/leaderboard         — comparative leaderboard (query: ?firIds=X,Y,Z or all tracked)
 */

import type { FastifyInstance } from 'fastify';
import { getAllFIREntries, getFIREntry, isFIRDataLoaded } from '../services/firLoader.js';
import { getFlightsInFIR } from '../services/firFilter.js';
import { getHealthOrCompute, getHealthMulti } from '../services/healthPoller.js';
import { getHealthHistory } from '../db/healthStore.js';

// FIR IDs are short alphanumeric strings (e.g. "EDGG", "LFFF")
const FIR_ID_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_FIR_IDS = 50;

function isValidFirId(id: unknown): id is string {
  return typeof id === 'string' && FIR_ID_RE.test(id);
}

export async function firHealthRoutes(app: FastifyInstance): Promise<void> {

  // List all available FIRs
  app.get('/api/fir/list', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=300');
    if (!isFIRDataLoaded()) {
      return reply.code(503).send({ error: 'FIR data still loading' });
    }
    const entries = getAllFIREntries();
    const list = entries.map(e => ({
      id: e.feature.properties.id,
      name: e.feature.properties.name,
      country: e.feature.properties.country,
    }));
    return reply.send({ firs: list, total: list.length });
  });

  // Current health for one FIR
  app.get<{ Params: { firId: string } }>('/api/fir/:firId/health', async (req, reply) => {
    const { firId } = req.params;
    if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID format' });
    const entry = getFIREntry(firId);
    if (!entry) return reply.code(404).send({ error: `FIR ${firId} not found` });

    const health = getHealthOrCompute(firId);
    return reply.send({
      ...health,
      firName: entry.feature.properties.name,
      country: entry.feature.properties.country,
    });
  });

  // 24h health history
  app.get<{ Params: { firId: string }; Querystring: { hours?: string } }>(
    '/api/fir/:firId/history',
    async (req, reply) => {
      const { firId } = req.params;
      if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID format' });
      if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

      const hours = parseInt(req.query.hours ?? '24', 10) || 24;
      const history = getHealthHistory(firId, Math.min(hours, 168));
      return reply.send({ firId, history });
    }
  );

  // Live flights inside an FIR
  app.get<{ Params: { firId: string } }>('/api/fir/:firId/flights', async (req, reply) => {
    const { firId } = req.params;
    if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID format' });
    if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

    const flights = getFlightsInFIR(firId);
    return reply.send({ firId, ac: flights, total: flights.length });
  });

  // Multi-FIR health (POST with body)
  app.post<{ Body: { firIds: string[] } }>('/api/fir/health', async (req, reply) => {
    const { firIds } = req.body ?? {};
    if (!Array.isArray(firIds) || firIds.length === 0) {
      return reply.code(400).send({ error: 'firIds array required' });
    }
    // Validate and cap
    const ids = firIds.filter(isValidFirId).slice(0, MAX_FIR_IDS);
    if (ids.length === 0) {
      return reply.code(400).send({ error: 'No valid FIR IDs provided' });
    }
    const results = getHealthMulti(ids).map(h => {
      const entry = getFIREntry(h.firId);
      return {
        ...h,
        firName: entry?.feature.properties.name ?? h.firId,
        country: entry?.feature.properties.country ?? '',
      };
    });
    return reply.send({ results });
  });

  // Global leaderboard
  app.get('/api/fir/leaderboard', async (req, reply) => {
    const { firIds: raw } = req.query as Record<string, string>;
    let ids: string[];

    if (raw) {
      ids = raw.split(',').map(s => s.trim()).filter(isValidFirId).slice(0, MAX_FIR_IDS);
    } else {
      // Default: use all loaded FIRs (may be slow for 300+ FIRs)
      // In practice, callers should supply a subset
      ids = getAllFIREntries().slice(0, 30).map(e => e.feature.properties.id);
    }

    const results = getHealthMulti(ids).map(h => {
      const entry = getFIREntry(h.firId);
      return {
        ...h,
        firName: entry?.feature.properties.name ?? h.firId,
        country: entry?.feature.properties.country ?? '',
      };
    });
    const sorted = results.sort((a, b) => b.chi - a.chi);

    return reply.send({
      leaderboard: sorted.map((r, idx) => ({
        rank: idx + 1,
        firId: r.firId,
        firName: r.firName,
        country: r.country,
        chi: r.chi,
        flightCount: r.flightCount,
        efficiencyScore: r.efficiencyScore,
        saturationPct: r.saturationPct,
        co2EstimateKg: r.co2EstimateKg,
      })),
    });
  });
}
