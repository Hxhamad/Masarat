/**
 * Weather REST Endpoints
 *
 * GET  /api/weather/metar?firId=XXXX | ?south=..&west=..&north=..&east=..
 * GET  /api/weather/alerts?firIds=XXXX,YYYY
 * GET  /api/weather/radar/frames
 * GET  /api/weather/forecast/fir/:firId?hours=12
 * POST /api/weather/forecast  (body: { firIds, hours? })
 */

import type { FastifyInstance } from 'fastify';
import {
  getMetarByFIR,
  getMetarByBounds,
  getAlertsByFIRs,
  getRadarCatalog,
  getForecast,
} from '../db/weatherStore.js';
import { fetchFIRForecasts } from '../services/weatherForecastService.js';
import { upsertForecast } from '../db/weatherStore.js';
import { getFIREntry, isFIRDataLoaded } from '../services/firLoader.js';
import { lastMetarSync, lastAlertSync, lastForecastSync, lastRadarSync } from '../services/weatherScheduler.js';

const FIR_ID_RE = /^[A-Za-z0-9_-]{2,20}$/;
const MAX_FIR_IDS = 50;

function isValidFirId(id: unknown): id is string {
  return typeof id === 'string' && FIR_ID_RE.test(id);
}

function isValidBounds(s: number, w: number, n: number, e: number): boolean {
  return (
    !Number.isNaN(s) && !Number.isNaN(w) && !Number.isNaN(n) && !Number.isNaN(e) &&
    s >= -90 && s <= 90 && n >= -90 && n <= 90 &&
    w >= -180 && w <= 180 && e >= -180 && e <= 180 &&
    s <= n
  );
}

export async function weatherRoutes(app: FastifyInstance): Promise<void> {

  // METAR observations
  app.get('/api/weather/metar', async (req, reply) => {
    const q = req.query as Record<string, string>;

    // By FIR
    if (q.firId) {
      if (!isValidFirId(q.firId)) return reply.code(400).send({ error: 'Invalid FIR ID' });
      const items = getMetarByFIR(q.firId);
      return reply.send({ items, total: items.length, source: 'aviationweather', fetchedAt: lastMetarSync });
    }

    // By bounds
    const { south, west, north, east } = q;
    if (south && west && north && east) {
      const s = parseFloat(south), w = parseFloat(west), n = parseFloat(north), e = parseFloat(east);
      if (!isValidBounds(s, w, n, e)) return reply.code(400).send({ error: 'Invalid bounds' });
      const items = getMetarByBounds(s, w, n, e);
      return reply.send({ items, total: items.length, source: 'aviationweather', fetchedAt: lastMetarSync });
    }

    return reply.code(400).send({ error: 'Provide firId or bounds (south,west,north,east)' });
  });

  // Weather alerts
  app.get('/api/weather/alerts', async (req, reply) => {
    const { firIds: raw } = req.query as Record<string, string>;
    if (!raw) return reply.code(400).send({ error: 'firIds query parameter required' });
    const firIds = raw.split(',').map((s) => s.trim()).filter(isValidFirId).slice(0, MAX_FIR_IDS);
    if (firIds.length === 0) return reply.code(400).send({ error: 'No valid FIR IDs provided' });
    const items = getAlertsByFIRs(firIds);
    return reply.send({ items, total: items.length, source: 'aviationweather', fetchedAt: lastAlertSync });
  });

  // Radar frame catalog
  app.get('/api/weather/radar/frames', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    const catalog = getRadarCatalog();
    if (!catalog) return reply.code(503).send({ error: 'Radar catalog not yet available' });
    return reply.send({ catalog });
  });

  // Forecast for a single FIR
  app.get<{ Params: { firId: string }; Querystring: { hours?: string } }>(
    '/api/weather/forecast/fir/:firId',
    async (req, reply) => {
      const { firId } = req.params;
      if (!isValidFirId(firId)) return reply.code(400).send({ error: 'Invalid FIR ID' });
      if (!isFIRDataLoaded()) return reply.code(503).send({ error: 'FIR data still loading' });
      if (!getFIREntry(firId)) return reply.code(404).send({ error: `FIR ${firId} not found` });

      let forecast = getForecast(firId);
      if (!forecast) {
        // On-demand fetch
        const results = await fetchFIRForecasts([firId], parseInt(req.query.hours ?? '24', 10) || 24);
        forecast = results[0] ?? null;
        if (forecast) upsertForecast(forecast);
      }
      if (!forecast) return reply.code(503).send({ error: 'Forecast unavailable' });
      return reply.send({ forecast });
    },
  );

  // Batch forecast
  app.post<{ Body: { firIds: string[]; hours?: number } }>(
    '/api/weather/forecast',
    async (req, reply) => {
      const { firIds, hours } = req.body ?? {};
      if (!Array.isArray(firIds) || firIds.length === 0) {
        return reply.code(400).send({ error: 'firIds array required' });
      }
      const ids = firIds.filter(isValidFirId).slice(0, MAX_FIR_IDS);
      if (ids.length === 0) return reply.code(400).send({ error: 'No valid FIR IDs' });

      const results = ids
        .map((id) => getForecast(id))
        .filter((f): f is NonNullable<typeof f> => f !== null);

      return reply.send({ results });
    },
  );
}
