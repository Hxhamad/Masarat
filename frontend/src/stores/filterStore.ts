import { create } from 'zustand';

export type FlightTypeFilter = 'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter';
export type AircraftScope = 'all' | 'fir-only';

const SCOPE_STORAGE_KEY = 'masarat_aircraft_scope';

function loadScope(): AircraftScope {
  try {
    const v = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (v === 'all' || v === 'fir-only') return v;
  } catch { /* ignore */ }
  return 'all';
}

interface FilterState {
  searchQuery: string;
  altitudeRange: [number, number]; // feet
  activeTypes: Set<FlightTypeFilter>;
  aircraftScope: AircraftScope;

  setSearchQuery: (q: string) => void;
  setAltitudeRange: (range: [number, number]) => void;
  toggleType: (type: FlightTypeFilter) => void;
  setAircraftScope: (scope: AircraftScope) => void;
  resetFilters: () => void;
}

const ALL_TYPES: FlightTypeFilter[] = ['airline', 'private', 'cargo', 'military', 'ground', 'helicopter'];

export const useFilterStore = create<FilterState>((set) => ({
  searchQuery: '',
  altitudeRange: [0, 60_000],
  activeTypes: new Set(ALL_TYPES),
  aircraftScope: loadScope(),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setAltitudeRange: (altitudeRange) => set({ altitudeRange }),

  toggleType: (type) =>
    set((state) => {
      const next = new Set(state.activeTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { activeTypes: next };
    }),

  setAircraftScope: (aircraftScope) => {
    try { localStorage.setItem(SCOPE_STORAGE_KEY, aircraftScope); } catch { /* ignore */ }
    set({ aircraftScope });
  },

  resetFilters: () =>
    set({
      searchQuery: '',
      altitudeRange: [0, 60_000],
      activeTypes: new Set(ALL_TYPES),
    }),
}));
