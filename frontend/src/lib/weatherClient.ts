import type {
  METARObservation,
  WeatherAlertSummary,
  RadarFrameCatalog,
  FIRForecastSummary,
} from '../types/weather';

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchMetarByFIR(firId: string, signal?: AbortSignal): Promise<METARObservation[]> {
  const data = await fetchJson<{ items: METARObservation[] }>(
    `/api/weather/metar?firId=${encodeURIComponent(firId)}`,
    signal,
  );
  return data.items;
}

export async function fetchAlerts(firIds: string[], signal?: AbortSignal): Promise<WeatherAlertSummary[]> {
  const data = await fetchJson<{ items: WeatherAlertSummary[] }>(
    `/api/weather/alerts?firIds=${firIds.map(encodeURIComponent).join(',')}`,
    signal,
  );
  return data.items;
}

export async function fetchRadarFrames(signal?: AbortSignal): Promise<RadarFrameCatalog> {
  const data = await fetchJson<{ catalog: RadarFrameCatalog }>(
    '/api/weather/radar/frames',
    signal,
  );
  return data.catalog;
}

export async function fetchForecast(firId: string, hours = 24, signal?: AbortSignal): Promise<FIRForecastSummary> {
  const data = await fetchJson<{ forecast: FIRForecastSummary }>(
    `/api/weather/forecast/fir/${encodeURIComponent(firId)}?hours=${hours}`,
    signal,
  );
  return data.forecast;
}
