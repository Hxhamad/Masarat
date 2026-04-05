/**
 * FIRDiagnostics — Map overlay showing health badges for selected FIRs.
 *
 * Renders as a Leaflet DivOverlay at each FIR's centroid with:
 *  - CHI score (color-coded)
 *  - Flight count
 *  - Saturation %
 *
 * Uses the shared mapRef and healthStore; renders nothing when
 * no health data is available.
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { getMapInstance } from './mapRef';
import { useFilterStore } from '../../stores/filterStore';
import { useHealthStore } from '../../stores/healthStore';
import { useFIRStore } from '../../stores/firStore';
import { getFIRBounds } from '../../lib/firService';

function chiColor(chi: number): string {
  if (chi >= 75) return '#22c55e';
  if (chi >= 50) return '#eab308';
  return '#ef4444';
}

export default function FIRDiagnostics() {
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const healthByFIR = useHealthStore((s) => s.healthByFIR);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    const map = getMapInstance();

    // Clear previous
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!map || aircraftScope === 'all') return;

    selectedFIRs.forEach((firId) => {
      const health = healthByFIR.get(firId);
      const bounds = getFIRBounds(firId);
      if (!health || !bounds) return;

      const lat = (bounds.minLat + bounds.maxLat) / 2;
      const lng = (bounds.minLng + bounds.maxLng) / 2;

      const color = chiColor(health.chi);
      const html = `<div class="fir-diag-badge" style="border-color: ${color}">
        <span class="fir-diag-badge__chi" style="color: ${color}">${health.chi}</span>
        <span class="fir-diag-badge__label">${health.firName || firId}</span>
        <span class="fir-diag-badge__stat">${health.flightCount} flights · ${health.saturationPct}% sat</span>
      </div>`;

      const icon = L.divIcon({
        html,
        className: 'fir-diag-marker',
        iconSize: [120, 48],
        iconAnchor: [60, 24],
      });

      const marker = L.marker([lat, lng], { icon, interactive: false, zIndexOffset: -1000 });
      marker.addTo(map);
      markersRef.current.push(marker);
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [aircraftScope, selectedFIRs, healthByFIR]);

  return null;
}
