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

async function start(): Promise<void> {
  // Initialize SQLite
  initDatabase();
  initHealthTables();
  initWeatherTables();
  initGNSSTables();
  console.log('[db] SQLite initialized (WAL mode)');

  // Create Fastify
  const app = Fastify({ logger: false });

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim());
  await app.register(cors, { origin: allowedOrigins });
  await app.register(compress);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  // Custom error handler — prevent stack trace leaks
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error.statusCode ?? 500;
    reply.status(status).send({ error: status >= 500 ? 'Internal Server Error' : error.message });
  });

  // Register REST routes
  await app.register(flightRoutes);
  await app.register(statsRoutes);
  await app.register(firHealthRoutes);
  await app.register(metricsRoutes);
  await app.register(weatherRoutes);
  await app.register(gnssRoutes);

  // Health check
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
    console.log(`[server] Serving static files from ${publicDir}`);
  }

  // Start HTTP server
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[server] HTTP listening on :${PORT}`);

  // Attach WebSocket to the underlying Node HTTP server
  const httpServer = app.server;
  initWebSocket(httpServer);

  // Start ADS-B data aggregator
  startAggregator();

  // Load global FIR boundary data
  loadFIRData().then(() => {
    // Start periodic health computation after FIR data is ready
    startHealthPoller();
    // Start weather data ingestion
    startWeatherScheduler();
    // Start GNSS anomaly computation
    startGNSSScheduler();
  });

  // Periodic trail cleanup every hour
  const cleanupInterval = setInterval(() => {
    const removed = cleanupOldTrails();
    if (removed > 0) console.log(`[db] Cleaned up ${removed} old trail points`);
    const healthRemoved = cleanupOldHealth();
    if (healthRemoved > 0) console.log(`[db] Cleaned up ${healthRemoved} old health snapshots`);
    const metarRemoved = cleanupOldMetar();
    const alertsRemoved = cleanupOldAlerts();
    if (metarRemoved + alertsRemoved > 0) console.log(`[db] Cleaned up ${metarRemoved} old METARs, ${alertsRemoved} old alerts`);
    const gnssRemoved = cleanupOldGNSS();
    if (gnssRemoved > 0) console.log(`[db] Cleaned up ${gnssRemoved} old GNSS history points`);
  }, 3_600_000);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[server] Shutting down...');
    clearInterval(cleanupInterval);
    stopAggregator();
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
