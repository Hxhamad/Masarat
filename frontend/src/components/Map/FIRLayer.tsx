/**
 * FIRLayer — Always renders selected FIR boundary polygons on the Leaflet map.
 *
 * FIR boundaries are always visible — they define the monitored airspace.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useFIRStore } from '../../stores/firStore';
import { getFIRFeature } from '../../lib/firService';
import { getMapInstance } from './mapRef';

const SELECTED_STYLE: L.PathOptions = {
  color: '#00BFFF',
  weight: 2,
  opacity: 0.8,
  fillColor: '#00BFFF',
  fillOpacity: 0.06,
  dashArray: undefined,
};

export default function FIRLayer() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const geoJsonLayersRef = useRef<Map<string, L.GeoJSON>>(new Map());

  // Create / destroy layer group
  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;

    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
      geoJsonLayersRef.current.clear();
    };
  }, []);

  // Sync selected FIRs to map layers
  useEffect(() => {
    const map = getMapInstance();
    const group = layerGroupRef.current;
    if (!map || !group) return;

    const currentIds = new Set(selectedFIRs);
    const existingLayers = geoJsonLayersRef.current;

    // Remove deselected FIRs
    for (const [id, layer] of existingLayers) {
      if (!currentIds.has(id)) {
        group.removeLayer(layer);
        existingLayers.delete(id);
      }
    }

    // Add newly selected FIRs
    for (const id of selectedFIRs) {
      if (existingLayers.has(id)) continue;

      const feature = getFIRFeature(id);
      if (!feature) continue;

      const geoLayer = L.geoJSON(feature, {
        style: () => SELECTED_STYLE,
        interactive: false,
      });

      group.addLayer(geoLayer);
      existingLayers.set(id, geoLayer);
    }
  }, [selectedFIRs]);

  // This component renders nothing to the DOM — it drives Leaflet layers
  return null;
}
