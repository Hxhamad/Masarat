import { useEffect } from 'react';
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

  // METAR polling
  useEffect(() => {
    if (!metarEnabled || selectedFIRs.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function poll() {
      if (signal.aborted) return;
      store.getState().setMetarLoading(true);
      try {
        const all = await Promise.all(selectedFIRs.map((id) => fetchMetarByFIR(id, signal)));
        if (signal.aborted) return;
        store.getState().setMetar(all.flat());
      } catch {
        // ignore (includes AbortError)
      } finally {
        if (!signal.aborted) store.getState().setMetarLoading(false);
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), METAR_INTERVAL);
    return () => { controller.abort(); clearInterval(timer); };
  }, [metarEnabled, selectedFIRs]);

  // Alerts polling
  useEffect(() => {
    if (!alertsEnabled || selectedFIRs.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function poll() {
      if (signal.aborted) return;
      store.getState().setAlertsLoading(true);
      try {
        const items = await fetchAlerts(selectedFIRs, signal);
        if (signal.aborted) return;
        store.getState().setAlerts(items);
      } catch {
        // ignore (includes AbortError)
      } finally {
        if (!signal.aborted) store.getState().setAlertsLoading(false);
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), ALERT_INTERVAL);
    return () => { controller.abort(); clearInterval(timer); };
  }, [alertsEnabled, selectedFIRs]);

  // Radar polling (global — not FIR-scoped)
  useEffect(() => {
    if (!radarEnabled) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function poll() {
      if (signal.aborted) return;
      store.getState().setRadarLoading(true);
      try {
        const catalog = await fetchRadarFrames(signal);
        if (signal.aborted) return;
        store.getState().setRadarCatalog(catalog);
      } catch {
        // ignore (includes AbortError)
      } finally {
        if (!signal.aborted) store.getState().setRadarLoading(false);
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), RADAR_INTERVAL);
    return () => { controller.abort(); clearInterval(timer); };
  }, [radarEnabled]);
}
