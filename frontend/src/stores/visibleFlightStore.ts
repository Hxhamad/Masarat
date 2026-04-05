import { create } from 'zustand';
import type { ADSBFlight } from '../types/flight';

interface VisibleFlightState {
  visibleFlights: ADSBFlight[];
  setVisibleFlights: (flights: ADSBFlight[]) => void;
}

export const useVisibleFlightStore = create<VisibleFlightState>((set) => ({
  visibleFlights: [],
  setVisibleFlights: (visibleFlights) => set({ visibleFlights }),
}));
