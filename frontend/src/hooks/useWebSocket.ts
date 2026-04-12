import { useEffect, useRef } from 'react';
import { useFlightStore } from '../stores/flightStore';
import { useMapViewportStore } from '../stores/mapViewportStore';
import type { ADSBFlight, AggregatorStats } from '../types/flight';
import { decodeMessage, type AircraftSnapshot } from '../../../shared/aircraftProto';

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const WS_FLUSH_INTERVAL_MS = 33;

interface PendingServerBatch {
  updates: Map<string, ADSBFlight>;
  removed: Set<string>;
  stats: AggregatorStats | null;
}

/** Convert a decoded AircraftSnapshot back into the ADSBFlight shape used by stores */
function snapshotToFlight(s: AircraftSnapshot): ADSBFlight {
  return {
    icao24: s.icao24,
    callsign: s.callsign,
    registration: s.registration,
    aircraftType: s.aircraftType,
    latitude: s.latitude,
    longitude: s.longitude,
    altitude: s.altitude,
    heading: s.heading,
    groundSpeed: s.groundSpeed,
    verticalRate: s.verticalRate,
    squawk: s.squawk,
    source: s.source,
    category: s.category,
    isOnGround: s.isOnGround,
    lastSeen: s.lastSeen,
    timestamp: s.timestamp,
    type: s.type,
    trail: [],
    met: s.met,
  };
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

    /**
     * Handle an incoming binary message from the server.
     * Decodes the protobuf-style Uint8Array and routes to the
     * appropriate store action.
     */
    function handleBinaryMessage(data: ArrayBuffer): void {
      const decoded = decodeMessage(data);
      if (!decoded) return;

      switch (decoded.type) {
        case 'flight-update': {
          const flights = decoded.data.map(snapshotToFlight);

          if (awaitingInitialSnapshot.current) {
            awaitingInitialSnapshot.current = false;
            clearPendingBatch();
            replaceFlights(flights);
            break;
          }

          if (flights.length > 0) {
            for (const flight of flights) {
              pendingBatch.current.removed.delete(flight.icao24);
              pendingBatch.current.updates.set(flight.icao24, flight);
            }
            scheduleFlush();
          }
          break;
        }
        case 'flight-remove': {
          if (decoded.data.length > 0) {
            for (const icao24 of decoded.data) {
              pendingBatch.current.updates.delete(icao24);
              pendingBatch.current.removed.add(icao24);
            }
            scheduleFlush();
          }
          break;
        }
        case 'stats': {
          pendingBatch.current.stats = decoded.data;
          scheduleFlush();
          break;
        }
      }
    }

    /**
     * Handle a text (JSON) message — fallback path for legacy/mixed mode.
     */
    function handleTextMessage(text: string): void {
      try {
        const msg = JSON.parse(text);
        switch (msg.type) {
          case 'flight-update':
            if (awaitingInitialSnapshot.current) {
              awaitingInitialSnapshot.current = false;
              clearPendingBatch();
              replaceFlights(msg.data);
              break;
            }
            if (msg.data.length > 0) {
              for (const flight of msg.data as ADSBFlight[]) {
                pendingBatch.current.removed.delete(flight.icao24);
                pendingBatch.current.updates.set(flight.icao24, flight);
              }
              scheduleFlush();
            }
            break;
          case 'flight-remove':
            if (msg.data.length > 0) {
              for (const icao24 of msg.data as string[]) {
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
        // Ignore malformed text messages
      }
    }

    function connect() {
      if (!mounted) return;
      
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      
      setConnectionStatus('connecting');
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer'; // Receive binary as ArrayBuffer for zero-copy decode
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted) return;
        awaitingInitialSnapshot.current = true;
        clearPendingBatch();
        retriesRef.current = 0;
        setConnectionStatus('connected');
        console.log('[ws] Connected (binary protobuf mode)');
      };

      ws.onmessage = (event) => {
        if (!mounted) return;

        if (event.data instanceof ArrayBuffer) {
          // Binary protobuf message
          handleBinaryMessage(event.data);
        } else if (typeof event.data === 'string') {
          // JSON fallback
          handleTextMessage(event.data);
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

  // Send viewport subscription to server when map viewport changes
  const bounds = useMapViewportStore((s) => s.bounds);
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !bounds) return;
    ws.send(JSON.stringify({
      type: 'subscribe',
      viewport: bounds,
    }));
  }, [bounds]);
}
