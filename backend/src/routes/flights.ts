import type { FastifyInstance } from 'fastify';
import { flightCache } from '../services/cache.js';
import { getTrailHistory } from '../db/sqlite.js';

// ICAO24 is a 6-character hex address
const ICAO24_RE = /^[0-9a-f]{6}$/;

function isValidBounds(s: number, w: number, n: number, e: number): boolean {
  return (
    !Number.isNaN(s) && !Number.isNaN(w) && !Number.isNaN(n) && !Number.isNaN(e) &&
    s >= -90 && s <= 90 && n >= -90 && n <= 90 &&
    w >= -180 && w <= 180 && e >= -180 && e <= 180 &&
    s <= n
  );
}

export async function flightRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/flights — all flights (or filtered by bounds)
  app.get('/api/flights', async (req, reply) => {
    reply.header('Cache-Control', 'no-cache, max-age=0');
    const { south, west, north, east } = req.query as Record<string, string>;

    if (south && west && north && east) {
      const s = parseFloat(south);
      const w = parseFloat(west);
      const n = parseFloat(north);
      const e = parseFloat(east);
      if (!isValidBounds(s, w, n, e)) {
        return reply.code(400).send({ error: 'Invalid bounds parameters' });
      }
      const flights = flightCache.getByBounds(s, w, n, e);
      return reply.send({ ac: flights, total: flights.length });
    }

    const flights = flightCache.getAll();
    return reply.send({ ac: flights, total: flights.length });
  });

  // GET /api/flights/:icao24 — single flight with trail
  app.get<{ Params: { icao24: string } }>('/api/flights/:icao24', async (req, reply) => {
    const icao24 = req.params.icao24.toLowerCase();
    if (!ICAO24_RE.test(icao24)) {
      return reply.code(400).send({ error: 'Invalid ICAO24 address' });
    }
    const flight = flightCache.get(icao24);
    if (!flight) {
      return reply.code(404).send({ error: 'Flight not found' });
    }

    // Attach trail from SQLite
    const trail = getTrailHistory(icao24, 60);
    flight.trail = trail.map(t => ({ lat: t.lat, lon: t.lon, alt: t.alt, ts: t.ts }));

    return reply.send(flight);
  });
}
