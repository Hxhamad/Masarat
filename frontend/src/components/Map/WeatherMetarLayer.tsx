/**
 * WeatherMetarLayer — Renders METAR station markers on the Leaflet map.
 *
 * Markers are color-coded by flight category (VFR/MVFR/IFR/LIFR).
 * Clicking a marker shows a popup with observation details.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useLayerStore } from '../../stores/layerStore';
import { useWeatherStore } from '../../stores/weatherStore';
import { getMapInstance } from './mapRef';
import type { METARObservation, FlightCategory } from '../../types/weather';

const CATEGORY_COLORS: Record<FlightCategory, string> = {
  vfr: '#22c55e',
  mvfr: '#3b82f6',
  ifr: '#ef4444',
  lifr: '#a855f7',
};

const DEFAULT_COLOR = '#6b7280';

function getCategoryColor(cat?: FlightCategory): string {
  return cat ? CATEGORY_COLORS[cat] ?? DEFAULT_COLOR : DEFAULT_COLOR;
}

function makeIcon(color: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:1px solid rgba(255,255,255,0.5);"></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
    className: '',
  });
}

function buildPopup(obs: METARObservation): string {
  const lines = [
    `<strong>${obs.stationId}</strong>`,
    obs.rawText ? `<div style="font-size:10px;margin:4px 0;font-family:monospace;word-break:break-all;">${obs.rawText}</div>` : '',
    obs.flightCategory ? `<div>Category: <strong>${obs.flightCategory.toUpperCase()}</strong></div>` : '',
    obs.windDirectionDeg != null ? `<div>Wind: ${obs.windDirectionDeg}° @ ${obs.windSpeedKt ?? '?'} kt${obs.windGustKt ? ` G${obs.windGustKt}` : ''}</div>` : '',
    obs.visibilitySm != null ? `<div>Vis: ${obs.visibilitySm} SM</div>` : '',
    obs.ceilingFt != null ? `<div>Ceiling: ${obs.ceilingFt} ft</div>` : '',
    obs.temperatureC != null ? `<div>Temp: ${obs.temperatureC}°C / Dew: ${obs.dewpointC ?? '?'}°C</div>` : '',
    obs.altimeterInHg != null ? `<div>Altimeter: ${obs.altimeterInHg.toFixed(2)} inHg</div>` : '',
  ];
  return `<div class="metar-popup">${lines.filter(Boolean).join('')}</div>`;
}

export default function WeatherMetarLayer() {
  const enabled = useLayerStore((s) => s.weatherMetarEnabled);
  const metarByStation = useWeatherStore((s) => s.metarByStation);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup();
    }

    if (!enabled) {
      layerGroupRef.current.remove();
      return;
    }

    layerGroupRef.current.clearLayers();
    layerGroupRef.current.addTo(map);

    for (const obs of metarByStation.values()) {
      const color = getCategoryColor(obs.flightCategory);
      const marker = L.marker([obs.lat, obs.lon], { icon: makeIcon(color) });
      marker.bindPopup(buildPopup(obs), { className: 'metar-popup-container', maxWidth: 280 });
      layerGroupRef.current.addLayer(marker);
    }

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
      }
    };
  }, [enabled, metarByStation]);

  return null;
}
