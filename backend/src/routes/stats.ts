import type { FastifyInstance } from 'fastify';
import { getStats } from '../services/adsbAggregator.js';
import { flightCache } from '../services/cache.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/stats', async (_req, reply) => {
    reply.header('Cache-Control', 'no-cache, max-age=0');
    const stats = getStats();
    return reply.send({
      ...stats,
      cacheSize: flightCache.size,
      uptime: process.uptime(),
    });
  });
}
