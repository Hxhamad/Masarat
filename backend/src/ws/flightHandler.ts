import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import type { ADSBFlight, WSMessage } from '../types.js';
import { flightCache } from '../services/cache.js';
import { setUpdateCallback, getStats } from '../services/adsbAggregator.js';

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

    // Discard any incoming messages from clients
    ws.on('message', () => { /* noop */ });

    // Send initial snapshot
    const flights = flightCache.getAll();
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
      console.log(`[ws] Client disconnected (total: ${wss.clients.size})`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });
  });

  // Register aggregator callback to broadcast updates
  setUpdateCallback((flights: ADSBFlight[], removed: string[]) => {
    if (wss.clients.size === 0) return;

    const messages: string[] = [];

    if (flights.length > 0) {
      const updateMsg: WSMessage = {
        type: 'flight-update',
        data: flights,
      };
      messages.push(JSON.stringify(updateMsg));
    }

    if (removed.length > 0) {
      const removeMsg: WSMessage = {
        type: 'flight-remove',
        data: removed,
      };
      messages.push(JSON.stringify(removeMsg));
    }

    // Stats
    const statsMsg: WSMessage = {
      type: 'stats',
      data: getStats(),
    };
    messages.push(JSON.stringify(statsMsg));

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        for (const msg of messages) {
          client.send(msg);
        }
      }
    }
  });

  console.log('[ws] WebSocket server initialized on /ws');
}
