/**
 * GNSSHeatmapLayer — Renders viewport-scoped GNSS anomaly H3 cells on the Leaflet map.
 *
 * Uses deck.gl's H3HexagonLayer through the Leaflet overlay bridge.
 */

import { useEffect, useRef } from 'react';
import { useLayerStore } from '../../stores/layerStore';
import { useGNSSStore } from '../../stores/gnssStore';
import { getMapInstance } from './mapRef';
import type { GNSSConfidence, GNSSHexBin } from '../../types/gnss';
import type { DeckOverlay as DeckOverlayType } from '@deck.gl-community/leaflet';

const SCORE_COLORS: Record<string, [number, number, number, number]> = {
  critical: [239, 68, 68, 210],
  elevated: [245, 158, 11, 185],
  mild: [34, 197, 94, 150],
  insufficient: [107, 114, 128, 95],
};

function scoreToColor(bin: GNSSHexBin): [number, number, number, number] {
  if (bin.confidence === 'insufficient-data') return SCORE_COLORS.insufficient;
  if (bin.anomalyScore >= 60) return SCORE_COLORS.critical;
  if (bin.anomalyScore >= 30) return SCORE_COLORS.elevated;
  return SCORE_COLORS.mild;
}

const CONFIDENCE_LABEL: Record<GNSSConfidence, string> = {
  'insufficient-data': 'Insufficient Data',
  low: 'Low Confidence',
  medium: 'Medium Confidence',
  high: 'High Confidence',
};

function buildTooltip(bin: GNSSHexBin): string {
  const lines = [
    `<strong>Cell ${bin.h3Index}</strong>`,
    `Anomaly Score: <strong>${bin.anomalyScore}</strong>/100`,
    `Confidence: <strong>${CONFIDENCE_LABEL[bin.confidence]}</strong>`,
    `Affected: ${bin.suspectedAffectedPct}% of ${bin.flightCount} flights`,
    '',
    '<em>Evidence:</em>',
    `Nav Integrity Data: ${bin.evidence.navIntegrityPresent ? 'Yes' : 'No'}`,
    `Elevated MLAT Share: ${bin.evidence.mlatShareElevated ? 'Yes' : 'No'}`,
    `Position Dropouts: ${bin.evidence.positionDropoutElevated ? 'Yes' : 'No'}`,
    `Cross-Source Agreement: ${bin.evidence.crossSourceAgreement ? 'Yes' : 'No'}`,
  ];
  return `<div style="font-size:11px;line-height:1.5;">${lines.join('<br/>')}</div>`;
}

export default function GNSSHeatmapLayer() {
  const enabled = useLayerStore((s) => s.gnssHeatmapEnabled);
  const bins = useGNSSStore((s) => s.heatBins);
  const overlayRef = useRef<DeckOverlayType | null>(null);

  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;
    const mapInstance = map;

    let cancelled = false;

    async function syncOverlay() {
      const overlay = overlayRef.current ?? await (async () => {
        const mod = await import('@deck.gl-community/leaflet');
        if (cancelled) return null;
        const created = new mod.DeckOverlay({ layers: [] });
        mapInstance.addLayer(created);
        overlayRef.current = created;
        return created;
      })();

      if (!overlay || cancelled) return;

      if (!enabled) {
        overlay.setProps({ layers: [] });
        return;
      }

      const { H3HexagonLayer } = await import('@deck.gl/geo-layers');
      if (cancelled) return;

      overlay.setProps({
        layers: [
          new H3HexagonLayer<GNSSHexBin>({
            id: 'gnss-h3-heatmap',
            data: bins,
            pickable: true,
            autoHighlight: true,
            highPrecision: 'auto',
            coverage: 0.92,
            extruded: false,
            filled: true,
            stroked: true,
            lineWidthMinPixels: 1,
            getHexagon: (d: GNSSHexBin) => d.h3Index,
            getFillColor: (d: GNSSHexBin) => scoreToColor(d),
            getLineColor: (d: GNSSHexBin) => {
              const [red, green, blue] = scoreToColor(d);
              return [red, green, blue, 255];
            },
          }),
        ],
        getTooltip: ({ object }: { object?: GNSSHexBin }) => {
          if (!object) return null;
          return {
            html: buildTooltip(object),
            style: {
              backgroundColor: 'rgba(8, 12, 18, 0.96)',
              color: '#e5edf5',
              border: '1px solid rgba(148, 163, 184, 0.25)',
              borderRadius: '8px',
              padding: '8px 10px',
              maxWidth: '260px',
            },
          };
        },
      });
    }

    void syncOverlay();

    return () => {
      cancelled = true;
    };
  }, [enabled, bins]);

  useEffect(() => {
    return () => {
      const map = getMapInstance();
      if (overlayRef.current && map) {
        map.removeLayer(overlayRef.current);
      }
      overlayRef.current = null;
    };
  }, []);

  return null;
}
