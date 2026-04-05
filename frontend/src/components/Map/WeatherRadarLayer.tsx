/**
 * WeatherRadarLayer — Renders RainViewer radar tiles on the Leaflet map.
 *
 * Consumes the RadarFrameCatalog from weatherStore and renders the selected
 * frame (or latest) as a tile overlay. Driven by layerStore toggles.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useLayerStore } from '../../stores/layerStore';
import { useWeatherStore } from '../../stores/weatherStore';
import { getMapInstance } from './mapRef';

export default function WeatherRadarLayer() {
  const enabled = useLayerStore((s) => s.weatherRadarEnabled);
  const selectedFrameTime = useLayerStore((s) => s.selectedRadarFrameTime);
  const catalog = useWeatherStore((s) => s.radarCatalog);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  useEffect(() => {
    const map = getMapInstance();
    if (!map || !enabled || !catalog || catalog.frames.length === 0) {
      // Remove layer when disabled
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
        tileLayerRef.current = null;
      }
      return;
    }

    // Pick the frame closest to selectedFrameTime, or latest
    let frame = catalog.frames[catalog.frames.length - 1];
    if (selectedFrameTime) {
      let closest = frame;
      let minDiff = Math.abs(frame.timestamp - selectedFrameTime);
      for (const f of catalog.frames) {
        const diff = Math.abs(f.timestamp - selectedFrameTime);
        if (diff < minDiff) {
          minDiff = diff;
          closest = f;
        }
      }
      frame = closest;
    }

    // Remove old tile layer
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }

    const tl = L.tileLayer(frame.tileUrlTemplate, {
      opacity: 0.5,
      zIndex: 200,
      maxZoom: 18,
    });
    tl.addTo(map);
    tileLayerRef.current = tl;

    return () => {
      if (tileLayerRef.current) {
        tileLayerRef.current.remove();
        tileLayerRef.current = null;
      }
    };
  }, [enabled, catalog, selectedFrameTime]);

  return null;
}
