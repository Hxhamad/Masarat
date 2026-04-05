/**
 * RainViewer Radar Service
 *
 * Fetches the public weather-maps.json catalog to discover available
 * radar frames. Tile URLs are composed on the frontend.
 */

import type { RadarFrameCatalog, RadarFrame } from '../types/weather.js';

const CATALOG_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const TIMEOUT_MS = 8_000;

/**
 * Fetch the current radar frame catalog from RainViewer.
 */
export async function fetchRadarCatalog(): Promise<RadarFrameCatalog | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(CATALOG_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as {
      version?: string;
      generated?: number;
      host?: string;
      radar?: {
        past?: Array<{ time: number; path: string }>;
        nowcast?: Array<{ time: number; path: string }>;
      };
    };

    if (!data.radar?.past || !data.host) return null;

    const frames: RadarFrame[] = [
      ...(data.radar.past ?? []),
      ...(data.radar.nowcast ?? []),
    ].map((f) => ({
      timestamp: f.time * 1000,
      tileUrlTemplate: `${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
    }));

    return {
      provider: 'rainviewer',
      generatedAt: (data.generated ?? Math.floor(Date.now() / 1000)) * 1000,
      frames,
    };
  } catch (err) {
    console.warn('[weather-radar] Failed to fetch catalog:', (err as Error).message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
