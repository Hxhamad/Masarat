import { useEffect, useRef } from 'react';
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
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!enabled || !bounds) return;
    const activeBounds = bounds;

    let timer: ReturnType<typeof setInterval> | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (!mountedRef.current) return;
      store.getState().setLoading(true);
      try {
        const response = await fetchGNSSHexBins(activeBounds, resolutionForZoom(zoom));
        if (!mountedRef.current) return;
        store.getState().setHeatBins(response);
      } catch {
        if (mountedRef.current) {
          store.getState().setError('Unable to load GNSS viewport cells');
        }
      } finally {
        if (mountedRef.current) store.getState().setLoading(false);
      }
    }

    debounce = setTimeout(() => { void poll(); }, VIEWPORT_DEBOUNCE_MS);
    timer = setInterval(() => void poll(), GNSS_INTERVAL);
    return () => {
      if (debounce) clearTimeout(debounce);
      if (timer) clearInterval(timer);
    };
  }, [enabled, bounds, viewportKey, zoom]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
}
