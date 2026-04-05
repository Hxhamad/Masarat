import { create } from 'zustand';
import type { ADSBFlight, AggregatorStats, ConnectionStatus, DataSource } from '../types/flight';

interface FlightServerBatch {
  flights?: ADSBFlight[];
  removed?: string[];
  stats?: AggregatorStats;
}

interface FlightState {
  flights: Map<string, ADSBFlight>;
  selectedFlight: string | null;
  stats: AggregatorStats;
  connectionStatus: ConnectionStatus;
  lastMessageAt: number;

  // Actions
  replaceFlights: (flights: ADSBFlight[]) => void;
  setFlights: (flights: ADSBFlight[]) => void;
  removeFlights: (icao24s: string[]) => void;
  applyServerBatch: (batch: FlightServerBatch) => void;
  selectFlight: (icao24: string | null) => void;
  setStats: (stats: AggregatorStats) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
}

export const useFlightStore = create<FlightState>((set) => ({
  flights: new Map(),
  selectedFlight: null,
  stats: {
    totalFlights: 0,
    dataSource: 'adsb-lol' as DataSource,
    lastUpdate: 0,
    messagesPerSecond: 0,
  },
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastMessageAt: 0,

  replaceFlights: (incoming) =>
    set((state) => {
      const next = new Map<string, ADSBFlight>();
      for (const flight of incoming) {
        next.set(flight.icao24, flight);
      }

      return {
        flights: next,
        selectedFlight: state.selectedFlight && next.has(state.selectedFlight) ? state.selectedFlight : null,
        lastMessageAt: Date.now(),
      };
    }),

  setFlights: (incoming) =>
    set((state) => {
      const next = new Map(state.flights);
      for (const f of incoming) {
        next.set(f.icao24, f);
      }
      return {
        flights: next,
        selectedFlight: state.selectedFlight && next.has(state.selectedFlight) ? state.selectedFlight : null,
        lastMessageAt: Date.now(),
      };
    }),

  removeFlights: (icao24s) =>
    set((state) => {
      const next = new Map(state.flights);
      for (const id of icao24s) {
        next.delete(id);
      }
      return {
        flights: next,
        selectedFlight: state.selectedFlight && next.has(state.selectedFlight) ? state.selectedFlight : null,
        lastMessageAt: Date.now(),
      };
    }),

  applyServerBatch: ({ flights = [], removed = [], stats }) =>
    set((state) => {
      if (flights.length === 0 && removed.length === 0 && !stats) {
        return state;
      }

      const nextFlights =
        flights.length > 0 || removed.length > 0 ? new Map(state.flights) : state.flights;

      if (removed.length > 0) {
        for (const id of removed) {
          nextFlights.delete(id);
        }
      }

      if (flights.length > 0) {
        for (const flight of flights) {
          nextFlights.set(flight.icao24, flight);
        }
      }

      return {
        flights: nextFlights,
        selectedFlight: state.selectedFlight && nextFlights.has(state.selectedFlight) ? state.selectedFlight : null,
        stats: stats ?? state.stats,
        lastMessageAt: Date.now(),
      };
    }),

  selectFlight: (icao24) => set({ selectedFlight: icao24 }),

  setStats: (stats) => set({ stats }),

  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
}));
