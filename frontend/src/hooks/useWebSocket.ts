import { useEffect, useRef } from 'react';
import { useFlightStore } from '../stores/flightStore';
import type { ADSBFlight, AggregatorStats, WSMessage } from '../types/flight';

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const WS_FLUSH_INTERVAL_MS = 33;

interface PendingServerBatch {
  updates: Map<string, ADSBFlight>;
  removed: Set<string>;
  stats: AggregatorStats | null;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingInitialSnapshot = useRef(true);
  const pendingBatch = useRef<PendingServerBatch>({
    updates: new Map<string, ADSBFlight>(),
    removed: new Set<string>(),
    stats: null,
  });
  const retriesRef = useRef(0);
  const replaceFlights = useFlightStore((s) => s.replaceFlights);
  const applyServerBatch = useFlightStore((s) => s.applyServerBatch);
  const setConnectionStatus = useFlightStore((s) => s.setConnectionStatus);

  useEffect(() => {
    let mounted = true;

    function clearPendingBatch(): void {
      pendingBatch.current.updates.clear();
      pendingBatch.current.removed.clear();
      pendingBatch.current.stats = null;
    }

    function flushPendingBatch(): void {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }

      const { updates, removed, stats } = pendingBatch.current;
      if (updates.size === 0 && removed.size === 0 && !stats) {
        return;
      }

      const flights = updates.size > 0 ? Array.from(updates.values()) : [];
      const removedIds = removed.size > 0 ? Array.from(removed) : [];

      clearPendingBatch();
      applyServerBatch({
        flights,
        removed: removedIds,
        stats: stats ?? undefined,
      });
    }

    function scheduleFlush(): void {
      if (flushTimer.current) {
        return;
      }

      flushTimer.current = setTimeout(() => {
        flushPendingBatch();
      }, WS_FLUSH_INTERVAL_MS);
    }

    function connect() {
      if (!mounted) return;
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      
      setConnectionStatus('connecting');
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        awaitingInitialSnapshot.current = true;
        clearPendingBatch();
        retriesRef.current = 0;
        setConnectionStatus('connected');
        console.log('[ws] Connected');
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        try {
          const msg: WSMessage = JSON.parse(event.data);
          switch (msg.type) {
            case 'flight-update':
              if (awaitingInitialSnapshot.current) {
                awaitingInitialSnapshot.current = false;
                clearPendingBatch();
                replaceFlights(msg.data);
                break;
              }

              if (msg.data.length > 0) {
                for (const flight of msg.data) {
                  pendingBatch.current.removed.delete(flight.icao24);
                  pendingBatch.current.updates.set(flight.icao24, flight);
                }
                scheduleFlush();
              }
              break;
            case 'flight-remove':
              if (msg.data.length > 0) {
                for (const icao24 of msg.data) {
                  pendingBatch.current.updates.delete(icao24);
                  pendingBatch.current.removed.add(icao24);
                }
                scheduleFlush();
              }
              break;
            case 'stats':
              pendingBatch.current.stats = msg.data;
              scheduleFlush();
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mounted) return;
        awaitingInitialSnapshot.current = true;
        clearPendingBatch();
        if (flushTimer.current) {
          clearTimeout(flushTimer.current);
          flushTimer.current = null;
        }
        setConnectionStatus('disconnected');
        retriesRef.current += 1;
        const jitter = Math.random() * 500;
        const delay = Math.min(BACKOFF_BASE * Math.pow(2, retriesRef.current - 1), BACKOFF_MAX) + jitter;
        console.log(`[ws] Disconnected, reconnecting in ${Math.round(delay)}ms (attempt ${retriesRef.current})`);
        reconnectTimer.current = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      clearPendingBatch();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [replaceFlights, applyServerBatch, setConnectionStatus]);
}
