import { useEffect, useRef } from 'react';
import { useLayerStore } from '../stores/layerStore';
import { useWeatherStore } from '../stores/weatherStore';
import { useFIRStore } from '../stores/firStore';
import { fetchMetarByFIR, fetchAlerts, fetchRadarFrames } from '../lib/weatherClient';

const METAR_INTERVAL = 5 * 60_000;
const ALERT_INTERVAL = 5 * 60_000;
const RADAR_INTERVAL = 10 * 60_000;

export function useWeatherPolling() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const metarEnabled = useLayerStore((s) => s.weatherMetarEnabled);
  const alertsEnabled = useLayerStore((s) => s.weatherAlertsEnabled);
  const radarEnabled = useLayerStore((s) => s.weatherRadarEnabled);

  const store = useWeatherStore;
  const mountedRef = useRef(true);

  // METAR polling
  useEffect(() => {
    if (!metarEnabled || selectedFIRs.length === 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (!mountedRef.current) return;
      store.getState().setMetarLoading(true);
      try {
        const all = await Promise.all(selectedFIRs.map(fetchMetarByFIR));
        if (!mountedRef.current) return;
        store.getState().setMetar(all.flat());
      } catch {
        // ignore
      } finally {
        if (mountedRef.current) store.getState().setMetarLoading(false);
      }
    }

    void poll();
    timer = setInterval(() => void poll(), METAR_INTERVAL);
    return () => { if (timer) clearInterval(timer); };
  }, [metarEnabled, selectedFIRs]);

  // Alerts polling
  useEffect(() => {
    if (!alertsEnabled || selectedFIRs.length === 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (!mountedRef.current) return;
      store.getState().setAlertsLoading(true);
      try {
        const items = await fetchAlerts(selectedFIRs);
        if (!mountedRef.current) return;
        store.getState().setAlerts(items);
      } catch {
        // ignore
      } finally {
        if (mountedRef.current) store.getState().setAlertsLoading(false);
      }
    }

    void poll();
    timer = setInterval(() => void poll(), ALERT_INTERVAL);
    return () => { if (timer) clearInterval(timer); };
  }, [alertsEnabled, selectedFIRs]);

  // Radar polling (global — not FIR-scoped)
  useEffect(() => {
    if (!radarEnabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (!mountedRef.current) return;
      store.getState().setRadarLoading(true);
      try {
        const catalog = await fetchRadarFrames();
        if (!mountedRef.current) return;
        store.getState().setRadarCatalog(catalog);
      } catch {
        // ignore
      } finally {
        if (mountedRef.current) store.getState().setRadarLoading(false);
      }
    }

    void poll();
    timer = setInterval(() => void poll(), RADAR_INTERVAL);
    return () => { if (timer) clearInterval(timer); };
  }, [radarEnabled]);

  // Cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
}
