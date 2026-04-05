import { create } from 'zustand';

export type TimeMode = 'live' | 'recent-history';

interface LayerState {
  weatherRadarEnabled: boolean;
  weatherMetarEnabled: boolean;
  weatherAlertsEnabled: boolean;
  weatherForecastEnabled: boolean;
  gnssHeatmapEnabled: boolean;
  selectedRadarFrameTime: number | null;
  selectedTimeMode: TimeMode;

  toggleWeatherRadar: () => void;
  toggleWeatherMetar: () => void;
  toggleWeatherAlerts: () => void;
  toggleWeatherForecast: () => void;
  toggleGNSSHeatmap: () => void;
  setSelectedRadarFrameTime: (t: number | null) => void;
  setTimeMode: (mode: TimeMode) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  weatherRadarEnabled: false,
  weatherMetarEnabled: false,
  weatherAlertsEnabled: false,
  weatherForecastEnabled: false,
  gnssHeatmapEnabled: false,
  selectedRadarFrameTime: null,
  selectedTimeMode: 'live',

  toggleWeatherRadar: () => set((s) => ({ weatherRadarEnabled: !s.weatherRadarEnabled })),
  toggleWeatherMetar: () => set((s) => ({ weatherMetarEnabled: !s.weatherMetarEnabled })),
  toggleWeatherAlerts: () => set((s) => ({ weatherAlertsEnabled: !s.weatherAlertsEnabled })),
  toggleWeatherForecast: () => set((s) => ({ weatherForecastEnabled: !s.weatherForecastEnabled })),
  toggleGNSSHeatmap: () => set((s) => ({ gnssHeatmapEnabled: !s.gnssHeatmapEnabled })),
  setSelectedRadarFrameTime: (selectedRadarFrameTime) => set({ selectedRadarFrameTime }),
  setTimeMode: (selectedTimeMode) => set({ selectedTimeMode }),
}));
