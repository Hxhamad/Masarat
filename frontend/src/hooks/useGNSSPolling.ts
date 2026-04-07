import { useEffect } from 'react';
import { useLayerStore } from '../stores/layerStore';
import { useGNSSStore } from '../stores/gnssStore';
import { useMapViewportStore } from '../stores/mapViewportStore';
import { fetchGNSSHexBins } from '../lib/gnssClient';

const GNSS_INTERVAL = 2 * 60_000; // 2 min
const VIEWPORT_DEBOUNCE_MS = 400;

function resolutionForZoom(zoom: number): number {
  if (zoom <= 3) return 2;
  if (zoom <= 5) return 3;
  if (zoom <= 7) return 4;
  if (zoom <= 9) return 5;
  if (zoom <= 11) return 6;
  return 7;
}

export function useGNSSPolling() {
  const enabled = useLayerStore((s) => s.gnssHeatmapEnabled);
  const bounds = useMapViewportStore((s) => s.bounds);
  const viewportKey = useMapViewportStore((s) => s.viewportKey);
  const zoom = useMapViewportStore((s) => s.zoom);
  const store = useGNSSStore;

  useEffect(() => {
    if (!enabled || !bounds) return;
    const activeBounds = bounds;

    const controller = new AbortController();
    const { signal } = controller;

    async function poll() {
      if (signal.aborted) return;
      store.getState().setLoading(true);
      try {
        const response = await fetchGNSSHexBins(activeBounds, resolutionForZoom(zoom), 2, signal);
        if (signal.aborted) return;
        store.getState().setHeatBins(response);
      } catch {
        if (!signal.aborted) {
          store.getState().setError('Unable to load GNSS viewport cells');
        }
      } finally {
        if (!signal.aborted) store.getState().setLoading(false);
      }
    }

    const debounce = setTimeout(() => { void poll(); }, VIEWPORT_DEBOUNCE_MS);
    const timer = setInterval(() => void poll(), GNSS_INTERVAL);
    return () => {
      controller.abort();
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [enabled, bounds, viewportKey, zoom]);
}
