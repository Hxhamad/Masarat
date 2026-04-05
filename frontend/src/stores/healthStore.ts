import { create } from 'zustand';
import type { FIRHealthSummary, LeaderboardEntry, FIRHealthSnapshot } from '../types/health';

type ViewMode = 'flights' | 'health' | 'leaderboard';

interface HealthState {
  viewMode: ViewMode;
  /** Current health data keyed by FIR ID */
  healthByFIR: Map<string, FIRHealthSummary>;
  /** 24h history keyed by FIR ID */
  historyByFIR: Map<string, FIRHealthSnapshot[]>;
  /** Leaderboard data */
  leaderboard: LeaderboardEntry[];
  /** Loading flags */
  healthLoading: boolean;
  leaderboardLoading: boolean;
  /** Error message */
  error: string | null;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setHealthData: (firId: string, data: FIRHealthSummary) => void;
  setHistoryData: (firId: string, data: FIRHealthSnapshot[]) => void;
  setLeaderboard: (data: LeaderboardEntry[]) => void;
  setHealthLoading: (loading: boolean) => void;
  setLeaderboardLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useHealthStore = create<HealthState>((set) => ({
  viewMode: 'flights',
  healthByFIR: new Map(),
  historyByFIR: new Map(),
  leaderboard: [],
  healthLoading: false,
  leaderboardLoading: false,
  error: null,

  setViewMode: (viewMode) => set({ viewMode }),
  setHealthData: (firId, data) =>
    set((state) => {
      const next = new Map(state.healthByFIR);
      next.set(firId, data);
      return { healthByFIR: next };
    }),
  setHistoryData: (firId, data) =>
    set((state) => {
      const next = new Map(state.historyByFIR);
      next.set(firId, data);
      return { historyByFIR: next };
    }),
  setLeaderboard: (leaderboard) => set({ leaderboard }),
  setHealthLoading: (healthLoading) => set({ healthLoading }),
  setLeaderboardLoading: (leaderboardLoading) => set({ leaderboardLoading }),
  setError: (error) => set({ error }),
}));
