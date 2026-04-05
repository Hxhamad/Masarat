import { create } from 'zustand';
import type { GeoBounds } from '../types/gnss';

function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function makeViewportKey(bounds: GeoBounds, zoom: number): string {
  return [
    roundCoord(bounds.minLat),
    roundCoord(bounds.minLng),
    roundCoord(bounds.maxLat),
    roundCoord(bounds.maxLng),
    zoom,
  ].join(':');
}

interface MapViewportState {
  bounds: GeoBounds | null;
  zoom: number;
  viewportKey: string;
  setViewport: (bounds: GeoBounds, zoom: number) => void;
  clearViewport: () => void;
}

export const useMapViewportStore = create<MapViewportState>((set) => ({
  bounds: null,
  zoom: 0,
  viewportKey: '',
  setViewport: (bounds, zoom) => set({
    bounds,
    zoom,
    viewportKey: makeViewportKey(bounds, zoom),
  }),
  clearViewport: () => set({ bounds: null, zoom: 0, viewportKey: '' }),
}));