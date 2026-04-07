import type { GeoBounds, GNSSFIRSummary, GNSSHexBinsResponse, GNSSHistoryPoint } from '../types/gnss';

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchGNSSCurrent(firId: string): Promise<GNSSFIRSummary> {
  const data = await fetchJson<{ summary: GNSSFIRSummary }>(
    `/api/gnss/fir/${encodeURIComponent(firId)}/current`,
  );
  return data.summary;
}

export async function fetchGNSSHistory(firId: string, hours = 24): Promise<GNSSHistoryPoint[]> {
  const data = await fetchJson<{ history: GNSSHistoryPoint[] }>(
    `/api/gnss/fir/${encodeURIComponent(firId)}/history?hours=${hours}`,
  );
  return data.history;
}

export async function fetchGNSSSummaries(firIds: string[]): Promise<GNSSFIRSummary[]> {
  const res = await fetch('/api/gnss/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firIds }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json() as { results: GNSSFIRSummary[] };
  return data.results;
}

export async function fetchGNSSHexBins(
  bounds: GeoBounds,
  resolution: number,
  bucketMinutes = 2,
  signal?: AbortSignal,
): Promise<GNSSHexBinsResponse> {
  const params = new URLSearchParams({
    minLat: String(bounds.minLat),
    minLng: String(bounds.minLng),
    maxLat: String(bounds.maxLat),
    maxLng: String(bounds.maxLng),
    resolution: String(resolution),
    bucketMinutes: String(bucketMinutes),
  });
  return fetchJson<GNSSHexBinsResponse>(`/api/gnss/hexbins?${params.toString()}`, signal);
}
