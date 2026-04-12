/**
 * wsBenchmark.ts — WebSocket ingestion + broadcast performance benchmark.
 *
 * Simulates 50,000 aircraft being ingested through the normalization pipeline,
 * then measures:
 *  1. Binary serialization throughput (encode 50k snapshots)
 *  2. WebSocket broadcast latency   (time to receive encoded buffer)
 *  3. HTTP /api/health latency      (autocannon baseline)
 *
 * Run: npm run bench:ws
 * CI:  NODE_OPTIONS='--max-old-space-size=4096' tsx src/bench/wsBenchmark.ts
 */

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { performance } from 'node:perf_hooks';
import {
  encodeFlightUpdate,
  decodeMessage,
  type AircraftSnapshot,
} from '../proto/aircraftProto.js';
import { H3SpatialIndex } from '../services/h3SpatialIndex.js';

// ── Constants ──

const FLIGHT_COUNT = 50_000;
const WS_PORT = 9877;
const WARMUP_ROUNDS = 3;
const BENCH_ROUNDS = 10;

// ── Generate synthetic aircraft data ──

function generateFlights(count: number): AircraftSnapshot[] {
  const flights: AircraftSnapshot[] = new Array(count);
  const types: AircraftSnapshot['type'][] = ['airline', 'private', 'cargo', 'military', 'ground', 'helicopter'];
  const sources: AircraftSnapshot['source'][] = ['adsb', 'mlat', 'other'];

  for (let i = 0; i < count; i++) {
    flights[i] = {
      icao24: i.toString(16).padStart(6, '0'),
      callsign: `TST${i}`,
      registration: `N${i}`,
      aircraftType: i % 3 === 0 ? 'B738' : i % 3 === 1 ? 'A320' : 'E170',
      latitude: -90 + Math.random() * 180,
      longitude: -180 + Math.random() * 360,
      altitude: Math.random() * 45000,
      heading: Math.random() * 360,
      groundSpeed: Math.random() * 600,
      verticalRate: (Math.random() - 0.5) * 6000,
      squawk: (1200 + i % 100).toString(8).padStart(4, '0'),
      source: sources[i % 3],
      category: 'A3',
      isOnGround: i % 50 === 0,
      lastSeen: Math.floor(Math.random() * 10),
      timestamp: Date.now(),
      type: types[i % 6],
    };
  }
  return flights;
}

// ── Benchmark helpers ──

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function p99(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.99)];
}

// ══════════════════════════════════════════════════════════
// Benchmark 1: Binary serialization throughput
// ══════════════════════════════════════════════════════════

function benchEncode(flights: AircraftSnapshot[]): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BENCHMARK 1: Binary Serialization (${FLIGHT_COUNT.toLocaleString()} flights)`);
  console.log(`${'═'.repeat(60)}`);

  // Warmup
  for (let i = 0; i < WARMUP_ROUNDS; i++) {
    encodeFlightUpdate(flights);
  }

  const times: number[] = [];
  let bufSize = 0;

  for (let i = 0; i < BENCH_ROUNDS; i++) {
    const start = performance.now();
    const buf = encodeFlightUpdate(flights);
    const elapsed = performance.now() - start;
    times.push(elapsed);
    bufSize = buf.byteLength;
  }

  // JSON baseline
  const jsonTimes: number[] = [];
  let jsonSize = 0;
  for (let i = 0; i < BENCH_ROUNDS; i++) {
    const start = performance.now();
    const json = JSON.stringify({ type: 'flight-update', data: flights });
    const elapsed = performance.now() - start;
    jsonTimes.push(elapsed);
    jsonSize = new TextEncoder().encode(json).byteLength;
  }

  console.log(`\n  Binary encode:`);
  console.log(`    Median:     ${median(times).toFixed(2)} ms`);
  console.log(`    P99:        ${p99(times).toFixed(2)} ms`);
  console.log(`    Payload:    ${formatBytes(bufSize)}`);
  console.log(`\n  JSON.stringify baseline:`);
  console.log(`    Median:     ${median(jsonTimes).toFixed(2)} ms`);
  console.log(`    P99:        ${p99(jsonTimes).toFixed(2)} ms`);
  console.log(`    Payload:    ${formatBytes(jsonSize)}`);
  console.log(`\n  Ratio:        ${((bufSize / jsonSize) * 100).toFixed(1)}% of JSON size`);
  console.log(`  Speedup:      ${(median(jsonTimes) / median(times)).toFixed(1)}x faster`);
}

// ══════════════════════════════════════════════════════════
// Benchmark 2: H3 Spatial Index performance
// ══════════════════════════════════════════════════════════

function benchH3Index(flights: AircraftSnapshot[]): void {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BENCHMARK 2: H3 Spatial Index (${FLIGHT_COUNT.toLocaleString()} flights)`);
  console.log(`${'═'.repeat(60)}`);

  const idx = new H3SpatialIndex();

  // Index all flights
  const indexStart = performance.now();
  for (const f of flights) {
    idx.update(f.icao24, f.latitude, f.longitude);
  }
  const indexTime = performance.now() - indexStart;

  console.log(`\n  Index build:  ${indexTime.toFixed(2)} ms (${idx.size} flights → ${idx.cellCount} cells)`);

  // Viewport query: Europe-sized region
  const queryTimes: number[] = [];
  for (let i = 0; i < BENCH_ROUNDS; i++) {
    const start = performance.now();
    const visible = idx.getFlightsInViewport(35.0, -10.0, 60.0, 30.0);
    const elapsed = performance.now() - start;
    queryTimes.push(elapsed);
    if (i === 0) {
      console.log(`  Viewport hit: ${visible.size} flights in Europe region`);
    }
  }

  console.log(`  Query median: ${median(queryTimes).toFixed(2)} ms`);
  console.log(`  Query P99:    ${p99(queryTimes).toFixed(2)} ms`);
}

// ══════════════════════════════════════════════════════════
// Benchmark 3: End-to-end WebSocket broadcast latency
// ══════════════════════════════════════════════════════════

async function benchWebSocket(flights: AircraftSnapshot[]): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BENCHMARK 3: WebSocket Broadcast E2E Latency`);
  console.log(`${'═'.repeat(60)}`);

  // Pre-encode the buffer
  const buf = encodeFlightUpdate(flights);

  return new Promise<void>((resolve) => {
    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
      // On message from client, echo the pre-encoded buffer back
      ws.on('message', () => {
        ws.send(buf, { binary: true });
      });
    });

    httpServer.listen(WS_PORT, () => {
      const client = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws`);
      client.binaryType = 'arraybuffer';

      const latencies: number[] = [];
      let round = 0;

      client.on('open', () => {
        // Start first roundtrip
        round++;
        client.send('ping');
      });

      client.on('message', (data: ArrayBuffer) => {
        const t0 = performance.now();
        // Decode the buffer to simulate full frontend processing
        const decoded = decodeMessage(new Uint8Array(data as ArrayBuffer));
        const decodeTime = performance.now() - t0;

        if (decoded && decoded.type === 'flight-update') {
          latencies.push(decodeTime);
        }

        round++;
        if (round <= WARMUP_ROUNDS + BENCH_ROUNDS) {
          client.send('ping');
        } else {
          // Done — report results
          const benchLatencies = latencies.slice(WARMUP_ROUNDS); // discard warmup

          console.log(`\n  Buffer size:      ${formatBytes(buf.byteLength)}`);
          console.log(`  Flights decoded:  ${FLIGHT_COUNT.toLocaleString()}`);
          console.log(`  Decode median:    ${median(benchLatencies).toFixed(2)} ms`);
          console.log(`  Decode P99:       ${p99(benchLatencies).toFixed(2)} ms`);
          console.log(`  Decode throughput:${(FLIGHT_COUNT / median(benchLatencies) * 1000).toFixed(0)} flights/sec`);

          client.close();
          wss.close();
          httpServer.close(() => resolve());
        }
      });
    });
  });
}

// ══════════════════════════════════════════════════════════
// Benchmark 4: HTTP /api/health baseline (autocannon)
// ══════════════════════════════════════════════════════════

async function benchHTTP(): Promise<void> {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  BENCHMARK 4: HTTP Health Endpoint (autocannon)`);
  console.log(`${'═'.repeat(60)}`);

  // Dynamic import — autocannon ships as CJS; handle both default and named export shapes
  let runAutocannon: (opts: Record<string, unknown>) => Promise<{
    requests: { average: number };
    latency: { average: number; p99: number };
    throughput: { average: number };
  }>;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = await import('autocannon' as string) as any;
    runAutocannon = typeof mod.default === 'function' ? mod.default : mod;
  } catch {
    console.log('\n  ⚠ autocannon not installed — skipping HTTP benchmark');
    console.log('    Install: npm i -D autocannon');
    return;
  }

  const httpServer = createServer((req, res) => {
    if (req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = WS_PORT + 1;

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  const result = await runAutocannon({
    url: `http://127.0.0.1:${port}/api/health`,
    connections: 10,
    duration: 5,
    pipelining: 1,
  });

  console.log(`\n  Connections:  10`);
  console.log(`  Duration:     5s`);
  console.log(`  Requests/sec: ${result.requests.average.toFixed(0)}`);
  console.log(`  Latency avg:  ${result.latency.average.toFixed(2)} ms`);
  console.log(`  Latency p99:  ${result.latency.p99.toFixed(2)} ms`);
  console.log(`  Throughput:   ${formatBytes(result.throughput.average)}/sec`);

  httpServer.close();
}

// ══════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log(`\n╔${'═'.repeat(58)}╗`);
  console.log(`║  MASARAT WebSocket Performance Benchmark                 ║`);
  console.log(`║  Simulating ${FLIGHT_COUNT.toLocaleString()} aircraft                         ║`);
  console.log(`║  Node.js ${process.version} / V8 ${process.versions.v8}              ║`);
  console.log(`╚${'═'.repeat(58)}╝`);

  const flights = generateFlights(FLIGHT_COUNT);

  benchEncode(flights);
  benchH3Index(flights);
  await benchWebSocket(flights);
  await benchHTTP();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ALL BENCHMARKS COMPLETE`);
  console.log(`${'═'.repeat(60)}\n`);

  // CI gate: fail if any critical metric is too slow
  const buf = encodeFlightUpdate(flights);
  const decodeStart = performance.now();
  decodeMessage(buf);
  const decodeMs = performance.now() - decodeStart;

  if (decodeMs > 200) {
    console.error(`❌ FAIL: Decode latency ${decodeMs.toFixed(2)}ms exceeds 200ms threshold`);
    process.exit(1);
  }

  console.log(`✅ PASS: Decode latency ${decodeMs.toFixed(2)}ms within 200ms threshold`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
