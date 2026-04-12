import Fastify from 'fastify';
import cors from '@fastify/cors';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase, closeDatabase, cleanupOldTrails } from './db/sqlite.js';
import { initHealthTables, cleanupOldHealth } from './db/healthStore.js';
import { initWebSocket } from './ws/flightHandler.js';
import { startAggregator, stopAggregator } from './services/adsbAggregator.js';
import { loadFIRData } from './services/firLoader.js';
import { flightRoutes } from './routes/flights.js';
import { statsRoutes } from './routes/stats.js';
import { firHealthRoutes } from './routes/firHealth.js';
import { metricsRoutes } from './routes/metrics.js';
import { weatherRoutes } from './routes/weather.js';
import { gnssRoutes } from './routes/gnss.js';
import { startHealthPoller } from './services/healthPoller.js';
import { initWeatherTables, cleanupOldMetar, cleanupOldAlerts } from './db/weatherStore.js';
import { initGNSSTables, cleanupOldGNSS } from './db/gnssStore.js';
import { startWeatherScheduler, stopWeatherScheduler } from './services/weatherScheduler.js';
import { startGNSSScheduler, stopGNSSScheduler } from './services/gnssScheduler.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const API_KEY = process.env.API_KEY || '';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const RATE_LIMIT_API = parseInt(process.env.RATE_LIMIT_API || '120', 10);
const RATE_LIMIT_METRICS = parseInt(process.env.RATE_LIMIT_METRICS || '10', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || '3600000', 10);

/** Export for use by route guards */
export { API_KEY };

async function start(): Promise<void> {
  // Initialize SQLite
  initDatabase();
  initHealthTables();
  initWeatherTables();
  initGNSSTables();

  // Create Fastify with structured logging (Pino)
  const app = Fastify({
    logger: {
      level: LOG_LEVEL,
      ...(process.env.NODE_ENV !== 'production' && { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
    },
  });

  app.log.info('SQLite initialized (WAL mode)');

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim());
  await app.register(cors, {
    origin: process.env.NODE_ENV === 'production' ? allowedOrigins : true,
    credentials: true,
  });
  await app.register(compress);
  await app.register(helmet, { contentSecurityPolicy: false });

  // Default API rate limit
  await app.register(rateLimit, {
    max: RATE_LIMIT_API,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.ip,
  });

  // Custom error handler — prevent stack trace leaks
  app.setErrorHandler((error, req, reply) => {
    const status = (error as Error & { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error(error, 'unhandled error');
    }
    reply.status(status).send({ error: status >= 500 ? 'Internal Server Error' : (error as Error).message });
  });

  // Register REST routes
  await app.register(flightRoutes);
  await app.register(firHealthRoutes);
  await app.register(weatherRoutes);
  await app.register(gnssRoutes);
  // Operational routes — tighter rate limit
  await app.register(async (scope) => {
    scope.addHook('onRequest', async (req, reply) => {
      if (API_KEY) {
        const provided = req.headers['x-api-key'] || (req.query as Record<string, string>).apiKey;
        if (provided !== API_KEY) {
          return reply.code(401).send({ error: 'Unauthorized' });
        }
      }
    });
    await scope.register(rateLimit, { max: RATE_LIMIT_METRICS, timeWindow: '1 minute' });
    await scope.register(statsRoutes);
    await scope.register(metricsRoutes);
  });

  // Health check (unauthenticated, lightweight)
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }));

  // Serve frontend static files in production
  const publicDir = resolve(import.meta.dirname ?? '.', '..', 'public');
  if (existsSync(publicDir)) {
    await app.register(fastifyStatic, {
      root: publicDir,
      wildcard: false,
    });
    // SPA fallback: serve index.html for non-API routes
    app.setNotFoundHandler(async (_req, reply) => {
      return reply.sendFile('index.html');
    });
    app.log.info(`Serving static files from ${publicDir}`);
  }

  // Start HTTP server
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`HTTP listening on :${PORT}`);

  // Attach WebSocket to the underlying Node HTTP server
  const httpServer = app.server;
  initWebSocket(httpServer);

  // Start ADS-B data aggregator (await bootstrap before polling)
  void startAggregator();

  // Load global FIR boundary data
  loadFIRData().then(() => {
    // Start periodic health computation after FIR data is ready
    startHealthPoller();
    // Start weather data ingestion
    startWeatherScheduler();
    // Start GNSS anomaly computation
    startGNSSScheduler();
  });

  // Periodic trail cleanup
  const cleanupInterval = setInterval(() => {
    const removed = cleanupOldTrails();
    if (removed > 0) app.log.info({ removed }, 'cleaned old trail points');
    const healthRemoved = cleanupOldHealth();
    if (healthRemoved > 0) app.log.info({ removed: healthRemoved }, 'cleaned old health snapshots');
    const metarRemoved = cleanupOldMetar();
    const alertsRemoved = cleanupOldAlerts();
    if (metarRemoved + alertsRemoved > 0) app.log.info({ metarRemoved, alertsRemoved }, 'cleaned old weather data');
    const gnssRemoved = cleanupOldGNSS();
    if (gnssRemoved > 0) app.log.info({ removed: gnssRemoved }, 'cleaned old GNSS history');
  }, CLEANUP_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = async () => {
    app.log.info('Shutting down...');
    clearInterval(cleanupInterval);
    await stopAggregator();
    stopWeatherScheduler();
    stopGNSSScheduler();
    closeDatabase();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
