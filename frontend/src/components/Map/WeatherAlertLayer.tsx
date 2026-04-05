/**
 * WeatherAlertLayer — Renders SIGMET/G-AIRMET/CWA polygons on the Leaflet map.
 *
 * Severity-coded styling: warning = red, caution = amber, info = blue.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useLayerStore } from '../../stores/layerStore';
import { useWeatherStore } from '../../stores/weatherStore';
import { getMapInstance } from './mapRef';
import type { WeatherAlertSummary, AlertSeverity } from '../../types/weather';

const SEVERITY_STYLES: Record<AlertSeverity, L.PathOptions> = {
  warning: { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2 },
  caution: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.10, weight: 2 },
  info: { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1 },
};

function buildPopup(alert: WeatherAlertSummary): string {
  return `<div>
    <strong>${alert.title}</strong>
    <div style="font-size:11px;margin-top:4px;">
      ${alert.productType.toUpperCase()} · ${alert.severity.toUpperCase()}
    </div>
    ${alert.summary ? `<div style="font-size:10px;margin-top:4px;max-height:120px;overflow:auto;font-family:monospace;">${alert.summary.slice(0, 400)}</div>` : ''}
  </div>`;
}

export default function WeatherAlertLayer() {
  const enabled = useLayerStore((s) => s.weatherAlertsEnabled);
  const alerts = useWeatherStore((s) => s.alerts);
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

    for (const alert of alerts) {
      if (!alert.geometry) continue;

      const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info;
      const geoLayer = L.geoJSON(alert.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon, {
        style: () => style,
      });
      geoLayer.bindPopup(buildPopup(alert), { maxWidth: 300 });
      layerGroupRef.current.addLayer(geoLayer);
    }

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
      }
    };
  }, [enabled, alerts]);

  return null;
}
