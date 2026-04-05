import { create } from 'zustand';
import type { GNSSFIRSummary, GNSSHistoryPoint, GNSSHexBin, GNSSHexBinsResponse } from '../types/gnss';

interface GNSSState {
  summaryByFIR: Map<string, GNSSFIRSummary>;
  historyByFIR: Map<string, GNSSHistoryPoint[]>;
  heatBins: GNSSHexBin[];
  heatBinResolution: number | null;
  inputFlightCount: number;
  cellCount: number;
  lastGeneratedAt: number | null;
  loading: boolean;
  error: string | null;
  lastFetch: number | null;

  setSummary: (firId: string, data: GNSSFIRSummary) => void;
  setSummaries: (items: GNSSFIRSummary[]) => void;
  setHistory: (firId: string, data: GNSSHistoryPoint[]) => void;
  setHeatBins: (response: GNSSHexBinsResponse) => void;
  setLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useGNSSStore = create<GNSSState>((set) => ({
  summaryByFIR: new Map(),
  historyByFIR: new Map(),
  heatBins: [],
  heatBinResolution: null,
  inputFlightCount: 0,
  cellCount: 0,
  lastGeneratedAt: null,
  loading: false,
  error: null,
  lastFetch: null,

  setSummary: (firId, data) =>
    set((s) => {
      const next = new Map(s.summaryByFIR);
      next.set(firId, data);
      return { summaryByFIR: next, lastFetch: Date.now() };
    }),

  setSummaries: (items) =>
    set((s) => {
      const next = new Map(s.summaryByFIR);
      for (const item of items) next.set(item.firId, item);
      return { summaryByFIR: next, lastFetch: Date.now() };
    }),

  setHistory: (firId, data) =>
    set((s) => {
      const next = new Map(s.historyByFIR);
      next.set(firId, data);
      return { historyByFIR: next };
    }),

  setHeatBins: (response) => set({
    heatBins: response.bins,
    heatBinResolution: response.resolution,
    inputFlightCount: response.inputFlightCount,
    cellCount: response.cellCount,
    lastGeneratedAt: response.generatedAt,
    lastFetch: Date.now(),
    error: null,
  }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}));
