import type {
  METARObservation,
  WeatherAlertSummary,
  RadarFrameCatalog,
  FIRForecastSummary,
} from '../types/weather';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchMetarByFIR(firId: string): Promise<METARObservation[]> {
  const data = await fetchJson<{ items: METARObservation[] }>(
    `/api/weather/metar?firId=${encodeURIComponent(firId)}`,
  );
  return data.items;
}

export async function fetchAlerts(firIds: string[]): Promise<WeatherAlertSummary[]> {
  const data = await fetchJson<{ items: WeatherAlertSummary[] }>(
    `/api/weather/alerts?firIds=${firIds.map(encodeURIComponent).join(',')}`,
  );
  return data.items;
}

export async function fetchRadarFrames(): Promise<RadarFrameCatalog> {
  const data = await fetchJson<{ catalog: RadarFrameCatalog }>(
    '/api/weather/radar/frames',
  );
  return data.catalog;
}

export async function fetchForecast(firId: string, hours = 24): Promise<FIRForecastSummary> {
  const data = await fetchJson<{ forecast: FIRForecastSummary }>(
    `/api/weather/forecast/fir/${encodeURIComponent(firId)}?hours=${hours}`,
  );
  return data.forecast;
}
