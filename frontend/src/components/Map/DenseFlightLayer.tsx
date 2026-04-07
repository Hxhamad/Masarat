/**
 * DenseFlightLayer — GPU-backed aircraft rendering for large traffic volumes.
 *
 * Uses deck.gl IconLayer so dense mode preserves aircraft silhouettes and
 * heading without falling back to one DOM marker per aircraft.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFlightStore } from '../../stores/flightStore';
import { useMapViewportStore } from '../../stores/mapViewportStore';
import { getMapInstance } from './mapRef';
import { displayCallsign, formatAltitude } from '../../lib/utils';
import type { ADSBFlight } from '../../types/flight';
import type { DeckOverlay as DeckOverlayType } from '@deck.gl-community/leaflet';

export const DENSE_FLIGHT_THRESHOLD = 400;
const VIEWPORT_PADDING_DEG = 0.75;

type RGBA = [number, number, number, number];

const AIRCRAFT_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">
    <path fill="white" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
  </svg>
`;

const AIRCRAFT_ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_ICON_SVG)}`;
const AIRCRAFT_ICON_MAPPING = {
  aircraft: {
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    anchorX: 32,
    anchorY: 32,
    mask: true,
  },
};

const TYPE_COLOR_VAR: Record<ADSBFlight['type'], string> = {
  airline: '--flight-airline',
  private: '--flight-private',
  cargo: '--flight-cargo',
  military: '--flight-military',
  ground: '--flight-ground',
  helicopter: '--flight-helicopter',
};

const TYPE_COLOR_CACHE = new Map<string, RGBA>();

function parseCssColor(value: string, alpha = 220): RGBA {
  const color = value.trim();
  if (color.startsWith('#')) {
    const normalized = color.length === 4
      ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
      : color;
    return [
      parseInt(normalized.slice(1, 3), 16),
      parseInt(normalized.slice(3, 5), 16),
      parseInt(normalized.slice(5, 7), 16),
      alpha,
    ];
  }

  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const [red = '0', green = '0', blue = '0'] = match[1].split(',').map((part) => part.trim());
    return [Number(red), Number(green), Number(blue), alpha];
  }

  return [0, 212, 255, alpha];
}

function resolveTypeColor(type: ADSBFlight['type']): RGBA {
  const cached = TYPE_COLOR_CACHE.get(type);
  if (cached) return cached;

  const cssVar = TYPE_COLOR_VAR[type];
  const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar);
  const color = parseCssColor(computed || '#00d4ff');
  TYPE_COLOR_CACHE.set(type, color);
  return color;
}

function isWithinViewport(flight: ADSBFlight, bounds: { minLat: number; minLng: number; maxLat: number; maxLng: number }): boolean {
  const minLat = bounds.minLat - VIEWPORT_PADDING_DEG;
  const maxLat = bounds.maxLat + VIEWPORT_PADDING_DEG;
  const minLng = bounds.minLng - VIEWPORT_PADDING_DEG;
  const maxLng = bounds.maxLng + VIEWPORT_PADDING_DEG;

  if (flight.latitude < minLat || flight.latitude > maxLat) {
    return false;
  }

  if (bounds.maxLng >= bounds.minLng) {
    return flight.longitude >= minLng && flight.longitude <= maxLng;
  }

  return flight.longitude >= minLng || flight.longitude <= maxLng;
}

export default function DenseFlightLayer() {
  const flights = useVisibleFlightStore((s) => s.visibleFlights);
  const selectedFlight = useFlightStore((s) => s.selectedFlight);
  const selectFlight = useFlightStore((s) => s.selectFlight);
  const bounds = useMapViewportStore((s) => s.bounds);
  const overlayRef = useRef<DeckOverlayType | null>(null);
  const previousOrderedIdsRef = useRef<string[] | null>(null);
  const denseFlights = useMemo(() => {
    if (!bounds) {
      return [];
    }
    return flights.filter((flight) => isWithinViewport(flight, bounds));
  }, [bounds, flights]);
  const isDense = denseFlights.length > DENSE_FLIGHT_THRESHOLD;
  const orderedIds = useMemo(() => denseFlights.map((flight) => flight.icao24), [denseFlights]);
  const canTransitionPositions = useMemo(() => {
    const previous = previousOrderedIdsRef.current;
    if (!previous || previous.length !== orderedIds.length) {
      return false;
    }

    for (let index = 0; index < orderedIds.length; index += 1) {
      if (orderedIds[index] !== previous[index]) {
        return false;
      }
    }

    return true;
  }, [orderedIds]);

  useEffect(() => {
    const map = getMapInstance();
    if (!map) return;
    const mapInstance = map;

    let cancelled = false;

    async function syncOverlay() {
      const overlay =
        overlayRef.current ??
        (await (async () => {
          const mod = await import('@deck.gl-community/leaflet');
          if (cancelled) return null;
          const created = new mod.DeckOverlay({ layers: [] });
          mapInstance.addLayer(created);
          overlayRef.current = created;
          return created;
        })());

      if (!overlay || cancelled) return;

      if (!isDense) {
        overlay.setProps({ layers: [] });
        return;
      }

      const { IconLayer } = await import('@deck.gl/layers');
      if (cancelled) return;

      overlay.setProps({
        layers: [
          new IconLayer<ADSBFlight>({
            id: 'dense-flights',
            data: denseFlights,
            pickable: true,
            autoHighlight: true,
            highlightColor: [255, 255, 255, 70],
            iconAtlas: AIRCRAFT_ICON_ATLAS,
            iconMapping: AIRCRAFT_ICON_MAPPING,
            getIcon: () => 'aircraft',
            getPosition: (flight: ADSBFlight) => [flight.longitude, flight.latitude],
            getAngle: (flight: ADSBFlight) => flight.heading,
            getColor: (flight: ADSBFlight) => {
              const [red, green, blue, alpha] = resolveTypeColor(flight.type);
              if (flight.icao24 === selectedFlight) {
                return [red, green, blue, 0] as RGBA;
              }
              return [red, green, blue, alpha] as RGBA;
            },
            getSize: (flight: ADSBFlight) => (flight.icao24 === selectedFlight ? 0 : 18),
            sizeUnits: 'pixels',
            sizeMinPixels: 12,
            sizeMaxPixels: 24,
            alphaCutoff: 0.05,
            billboard: true,
            transitions: {
              getPosition: { duration: canTransitionPositions ? 300 : 0 },
              getAngle: { duration: 150 },
            },
            onClick: (info: { object?: ADSBFlight }) => {
              if (info.object) {
                selectFlight(info.object.icao24);
              }
            },
          }),
        ],
        getTooltip: ({ object }: { object?: ADSBFlight }) => {
          if (!object) return null;
          return {
            html: `<div style="font-size:11px;line-height:1.5">
              <strong>${displayCallsign(object)}</strong><br/>
              ${formatAltitude(object.altitude)}<br/>
              ${Math.round(object.groundSpeed)} kt · ${Math.round(object.heading)}°
            </div>`,
            style: {
              backgroundColor: 'rgba(10,16,38,0.92)',
              color: '#f1f6ff',
              border: '1px solid rgba(157,179,226,0.18)',
              borderRadius: '16px',
              padding: '8px 10px',
              maxWidth: '200px',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 14px 30px rgba(2,6,23,0.32)',
            },
          };
        },
      });

      previousOrderedIdsRef.current = orderedIds;
    }

    void syncOverlay();

    return () => {
      cancelled = true;
    };
  }, [bounds, canTransitionPositions, denseFlights, isDense, orderedIds, selectFlight, selectedFlight]);

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
