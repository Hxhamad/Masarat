import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ADSBFlight, WSClientMessage } from '../types.js';
import { flightCache } from '../services/cache.js';
import { setUpdateCallback, getStats } from '../services/adsbAggregator.js';
import { spatialIndex } from '../services/h3SpatialIndex.js';
import {
  encodeFlightUpdate,
  encodeFlightRemove,
  encodeStats,
  type AircraftSnapshot,
  type StatsSnapshot,
} from '../proto/aircraftProto.js';

// ── ADSBFlight → AircraftSnapshot adapter ──

function toSnapshot(f: ADSBFlight): AircraftSnapshot {
  return {
    icao24: f.icao24,
    callsign: f.callsign,
    registration: f.registration,
    aircraftType: f.aircraftType,
    latitude: f.latitude,
    longitude: f.longitude,
    altitude: f.altitude,
    heading: f.heading,
    groundSpeed: f.groundSpeed,
    verticalRate: f.verticalRate,
    squawk: f.squawk,
    source: f.source,
    category: f.category,
    isOnGround: f.isOnGround,
    lastSeen: f.lastSeen,
    timestamp: f.timestamp,
    type: f.type,
    met: f.met,
  };
}

function toStatsSnapshot(s: ReturnType<typeof getStats>): StatsSnapshot {
  return {
    totalFlights: s.totalFlights,
    dataSource: s.dataSource,
    lastUpdate: s.lastUpdate,
    messagesPerSecond: s.messagesPerSecond,
  };
}

// ── Per-client H3 viewport subscription ──

interface ClientH3Subscription {
  // Raw viewport bounds (for display in logs / debugging)
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  // Pre-computed H3 cell set covering this viewport
  cells: Set<string>;
}

const clientSubscriptions = new WeakMap<WebSocket, ClientH3Subscription>();

function parseClientMessage(raw: string): WSClientMessage | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg === 'object' && typeof msg.type === 'string') {
      if (msg.type === 'subscribe' && msg.viewport &&
          typeof msg.viewport.minLat === 'number' &&
          typeof msg.viewport.maxLat === 'number' &&
          typeof msg.viewport.minLng === 'number' &&
          typeof msg.viewport.maxLng === 'number') {
        return msg as WSClientMessage;
      }
      if (msg.type === 'unsubscribe') {
        return msg as WSClientMessage;
      }
    }
  } catch { /* ignore */ }
  return null;
}

let wss: WebSocketServer;

export function getWsConnectionCount(): number {
  return wss ? wss.clients.size : 0;
}

const MAX_WS_CLIENTS = 50;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 * 1024 });

  wss.on('connection', (ws) => {
    // Connection cap
    if (wss.clients.size > MAX_WS_CLIENTS) {
      ws.close(1013, 'Too many connections');
      return;
    }

    console.log(`[ws] Client connected (total: ${wss.clients.size})`);

    ws.on('message', (data) => {
      const msg = parseClientMessage(String(data));
      if (!msg) return;

      if (msg.type === 'subscribe') {
        const vp = msg.viewport;

        // Pre-compute the H3 cell set for this client's viewport.
        // This is done once per viewport change (not per broadcast tick).
        const cells = spatialIndex.viewportToCells(
          vp.minLat,
          vp.minLng,
          vp.maxLat,
          vp.maxLng,
        );

        clientSubscriptions.set(ws, {
          minLat: vp.minLat,
          maxLat: vp.maxLat,
          minLng: vp.minLng,
          maxLng: vp.maxLng,
          cells,
        });

        // Send a viewport-scoped binary snapshot using H3 lookup
        const visibleIds = spatialIndex.getFlightsInCells(cells);
        if (visibleIds.size > 0) {
          const scoped: AircraftSnapshot[] = [];
          for (const id of visibleIds) {
            const f = flightCache.get(id);
            if (f) scoped.push(toSnapshot(f));
          }
          if (scoped.length > 0) {
            const buf = encodeFlightUpdate(scoped);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(buf, { binary: true });
            }
          }
        }
      } else if (msg.type === 'unsubscribe') {
        clientSubscriptions.delete(ws);
      }
    });

    // Send initial snapshot as binary protobuf (all flights, unfiltered)
    const allFlights = flightCache.getAll();
    const initBuf = encodeFlightUpdate(allFlights.map(toSnapshot));
    ws.send(initBuf, { binary: true });

    // Send stats as binary
    const statsBuf = encodeStats(toStatsSnapshot(getStats()));
    ws.send(statsBuf, { binary: true });

    ws.on('close', () => {
      clientSubscriptions.delete(ws);
      console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });
  });

  // Register aggregator callback to broadcast binary updates
  setUpdateCallback((flights: ADSBFlight[], removed: string[]) => {
    if (wss.clients.size === 0) return;

    // Pre-encode the stats buffer (same for all clients)
    const statsBuf = encodeStats(toStatsSnapshot(getStats()));

    // Pre-encode the remove buffer (same for all clients, if any)
    const removeBuf = removed.length > 0 ? encodeFlightRemove(removed) : null;

    // Pre-encode the global flight-update for clients WITHOUT a viewport subscription
    const globalBuf = flights.length > 0
      ? encodeFlightUpdate(flights.map(toSnapshot))
      : null;

    // Pre-compute each flight's H3 cell for efficient per-client filtering.
    // This avoids re-computing latLngToCell for each client.
    let flightCellMap: Map<string, string> | null = null;
    if (flights.length > 0) {
      flightCellMap = new Map<string, string>();
      for (const f of flights) {
        // Look up the cell from the spatial index (already computed in applySnapshot)
        const cell = spatialIndex.getCellForFlight(f.icao24);
        if (cell) {
          flightCellMap.set(f.icao24, cell);
        }
      }
    }

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      const sub = clientSubscriptions.get(client);

      if (sub && flights.length > 0 && flightCellMap) {
        // H3-scoped: only send flights whose cell intersects client's viewport cells
        const scoped: ADSBFlight[] = [];
        for (const f of flights) {
          const cell = flightCellMap.get(f.icao24);
          if (cell && sub.cells.has(cell)) {
            scoped.push(f);
          }
        }
        if (scoped.length > 0) {
          const scopedBuf = encodeFlightUpdate(scoped.map(toSnapshot));
          client.send(scopedBuf, { binary: true });
        }
      } else if (globalBuf) {
        // No viewport subscription — send everything
        client.send(globalBuf, { binary: true });
      }

      if (removeBuf) client.send(removeBuf, { binary: true });
      client.send(statsBuf, { binary: true });
    }
  });

  console.log('[ws] WebSocket server initialized on /ws (binary protobuf + H3 spatial filtering)');
}
