import { create } from 'zustand';
import type { FIRFeature } from '../types/fir';
import { fetchFIRFeatures } from '../lib/firService';

const MAX_SELECTED = 6;
const STORAGE_KEY = 'masarat_selected_firs';

/** Read persisted FIR selection from localStorage */
function loadPersistedFIRs(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.every((v: unknown) => typeof v === 'string')) {
      return arr.slice(0, MAX_SELECTED);
    }
  } catch { /* ignore */ }
  return [];
}

/** Save FIR selection to localStorage */
function persistFIRs(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch { /* ignore */ }
}

const initialFIRs = loadPersistedFIRs();

interface FIRState {
  /** All loaded FIR features */
  features: FIRFeature[];
  /** Loading state */
  loading: boolean;
  /** Currently selected FIR IDs (max 6) */
  selectedFIRs: string[];
  /** Whether user has completed initial FIR selection */
  firSetupComplete: boolean;
  /** Search query for FIR picker */
  firSearchQuery: string;

  // Actions
  loadFIRs: () => Promise<void>;
  toggleFIR: (firId: string) => void;
  removeFIR: (firId: string) => void;
  clearFIRs: () => void;
  completeFIRSetup: () => void;
  /** Re-open the FIR selection modal */
  reopenFIRSetup: () => void;
  setFIRSearchQuery: (query: string) => void;
}

export const useFIRStore = create<FIRState>((set, get) => ({
  features: [],
  loading: false,
  selectedFIRs: initialFIRs,
  firSetupComplete: initialFIRs.length > 0,
  firSearchQuery: '',

  loadFIRs: async () => {
    if (get().features.length > 0 || get().loading) return;
    set({ loading: true });
    const features = await fetchFIRFeatures();
    set({ features, loading: false });
  },

  toggleFIR: (firId: string) =>
    set((state) => {
      const idx = state.selectedFIRs.indexOf(firId);
      let next: string[];
      if (idx >= 0) {
        next = state.selectedFIRs.filter((id) => id !== firId);
      } else {
        if (state.selectedFIRs.length >= MAX_SELECTED) return state;
        next = [...state.selectedFIRs, firId];
      }
      persistFIRs(next);
      return { selectedFIRs: next };
    }),

  removeFIR: (firId: string) =>
    set((state) => {
      const next = state.selectedFIRs.filter((id) => id !== firId);
      persistFIRs(next);
      return { selectedFIRs: next };
    }),

  clearFIRs: () => {
    persistFIRs([]);
    set({ selectedFIRs: [] });
  },

  completeFIRSetup: () => set({ firSetupComplete: true }),

  reopenFIRSetup: () => set({ firSetupComplete: false }),

  setFIRSearchQuery: (firSearchQuery) => set({ firSearchQuery }),
}));
