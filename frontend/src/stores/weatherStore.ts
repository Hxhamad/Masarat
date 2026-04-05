import { create } from 'zustand';
import type {
  METARObservation,
  WeatherAlertSummary,
  RadarFrameCatalog,
  FIRForecastSummary,
} from '../types/weather';

interface WeatherState {
  metarByStation: Map<string, METARObservation>;
  alerts: WeatherAlertSummary[];
  radarCatalog: RadarFrameCatalog | null;
  forecastByFIR: Map<string, FIRForecastSummary>;
  metarLoading: boolean;
  alertsLoading: boolean;
  radarLoading: boolean;
  forecastLoading: boolean;
  error: string | null;
  lastMetarFetch: number | null;
  lastAlertFetch: number | null;
  lastRadarFetch: number | null;

  setMetar: (items: METARObservation[]) => void;
  setAlerts: (items: WeatherAlertSummary[]) => void;
  setRadarCatalog: (catalog: RadarFrameCatalog) => void;
  setForecast: (firId: string, data: FIRForecastSummary) => void;
  setMetarLoading: (v: boolean) => void;
  setAlertsLoading: (v: boolean) => void;
  setRadarLoading: (v: boolean) => void;
  setForecastLoading: (v: boolean) => void;
  setError: (e: string | null) => void;
}

export const useWeatherStore = create<WeatherState>((set) => ({
  metarByStation: new Map(),
  alerts: [],
  radarCatalog: null,
  forecastByFIR: new Map(),
  metarLoading: false,
  alertsLoading: false,
  radarLoading: false,
  forecastLoading: false,
  error: null,
  lastMetarFetch: null,
  lastAlertFetch: null,
  lastRadarFetch: null,

  setMetar: (items) =>
    set(() => {
      const m = new Map<string, METARObservation>();
      for (const obs of items) m.set(obs.stationId, obs);
      return { metarByStation: m, lastMetarFetch: Date.now() };
    }),

  setAlerts: (alerts) => set({ alerts, lastAlertFetch: Date.now() }),

  setRadarCatalog: (radarCatalog) => set({ radarCatalog, lastRadarFetch: Date.now() }),

  setForecast: (firId, data) =>
    set((s) => {
      const next = new Map(s.forecastByFIR);
      next.set(firId, data);
      return { forecastByFIR: next };
    }),

  setMetarLoading: (metarLoading) => set({ metarLoading }),
  setAlertsLoading: (alertsLoading) => set({ alertsLoading }),
  setRadarLoading: (radarLoading) => set({ radarLoading }),
  setForecastLoading: (forecastLoading) => set({ forecastLoading }),
  setError: (error) => set({ error }),
}));
