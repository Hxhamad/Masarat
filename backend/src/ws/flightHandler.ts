import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ADSBFlight, WSMessage, WSClientMessage } from '../types.js';
import { flightCache } from '../services/cache.js';
import { setUpdateCallback, getStats } from '../services/adsbAggregator.js';

/** Strip trail arrays from flights before WS broadcast to reduce payload. */
function stripTrails(flights: ADSBFlight[]): ADSBFlight[] {
  return flights.map(({ trail, ...rest }) => ({ ...rest, trail: [] as ADSBFlight['trail'] }));
}

// ── Per-client viewport subscription ──

interface ClientViewport {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const VIEWPORT_PAD = 1; // degree padding so edge aircraft don't flicker

const clientViewports = new WeakMap<WebSocket, ClientViewport>();

function flightInViewport(f: ADSBFlight, vp: ClientViewport): boolean {
  return (
    f.latitude >= vp.minLat - VIEWPORT_PAD &&
    f.latitude <= vp.maxLat + VIEWPORT_PAD &&
    f.longitude >= vp.minLng - VIEWPORT_PAD &&
    f.longitude <= vp.maxLng + VIEWPORT_PAD
  );
}

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
  wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

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
        clientViewports.set(ws, vp);

        // Send a viewport-scoped snapshot so the client has entering flights
        const scoped = flightCache.getByBounds(
          vp.minLat - VIEWPORT_PAD,
          vp.minLng - VIEWPORT_PAD,
          vp.maxLat + VIEWPORT_PAD,
          vp.maxLng + VIEWPORT_PAD,
        );
        const snapMsg: WSMessage = { type: 'flight-update', data: stripTrails(scoped) };
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(snapMsg));
        }
      } else if (msg.type === 'unsubscribe') {
        clientViewports.delete(ws);
      }
    });

    // Send initial snapshot (trail stripped — clients fetch on-demand)
    const flights = stripTrails(flightCache.getAll());
    const initMsg: WSMessage = {
      type: 'flight-update',
      data: flights,
    };
    ws.send(JSON.stringify(initMsg));

    // Send stats
    const statsMsg: WSMessage = {
      type: 'stats',
      data: getStats(),
    };
    ws.send(JSON.stringify(statsMsg));

    ws.on('close', () => {
      clientViewports.delete(ws);
      console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });
  });

  // Register aggregator callback to broadcast updates
  setUpdateCallback((flights: ADSBFlight[], removed: string[]) => {
    if (wss.clients.size === 0) return;

    // Pre-serialize the stats message (same for all clients)
    const statsJson = JSON.stringify({ type: 'stats', data: getStats() } satisfies WSMessage);

    // Pre-serialize the remove message (same for all clients, if any)
    const removeJson = removed.length > 0
      ? JSON.stringify({ type: 'flight-remove', data: removed } satisfies WSMessage)
      : null;

    // Pre-serialize the global update for clients without a viewport subscription
    const globalUpdateJson = flights.length > 0
      ? JSON.stringify({ type: 'flight-update', data: stripTrails(flights) } satisfies WSMessage)
      : null;

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;

      const vp = clientViewports.get(client);

      if (vp && flights.length > 0) {
        // Scoped: only send flights within this client's viewport
        const scoped = flights.filter(f => flightInViewport(f, vp));
        if (scoped.length > 0) {
          client.send(JSON.stringify({
            type: 'flight-update',
            data: stripTrails(scoped),
          } satisfies WSMessage));
        }
      } else if (globalUpdateJson) {
        client.send(globalUpdateJson);
      }

      if (removeJson) client.send(removeJson);
      client.send(statsJson);
    }
  });

  console.log('[ws] WebSocket server initialized on /ws');
}
