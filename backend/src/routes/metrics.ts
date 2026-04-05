import type { FastifyInstance } from 'fastify';
import { getOperationalMetrics } from '../services/adsbAggregator.js';
import { getWsConnectionCount } from '../ws/flightHandler.js';
import {
  lastMetarSync, lastAlertSync, lastForecastSync, lastRadarSync,
} from '../services/weatherScheduler.js';
import {
  lastComputeAt, lastSampleCount, confidenceMix,
} from '../services/gnssScheduler.js';

export async function metricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/metrics', async (_req, reply) => {
    const metrics = getOperationalMetrics();
    return reply.send({
      uptime: {
        ms: metrics.uptimeMs,
        seconds: metrics.uptimeSeconds,
        formatted: formatUptime(metrics.uptimeSeconds),
      },
      connections: {
        websocket: getWsConnectionCount(),
      },
      flights: {
        currentInCache: metrics.currentFlightsInCache,
        totalProcessed: metrics.totalFlightsProcessed,
        messagesPerSecond: metrics.messagesPerSecond,
      },
      errors: {
        total: metrics.totalErrors,
      },
      source: {
        active: metrics.activeSource,
        lastUpdate: metrics.lastUpdate,
      },
      weather: {
        lastMetarSync,
        lastAlertSync,
        lastForecastSync,
        lastRadarSync,
      },
      gnss: {
        lastComputeAt,
        lastSampleCount,
        confidenceMix: { ...confidenceMix },
      },
    });
  });
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}
