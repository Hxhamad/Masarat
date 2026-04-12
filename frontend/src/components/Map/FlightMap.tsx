/**
 * FlightMap — Leaflet base map with GPU-accelerated aircraft rendering.
 *
 * Architecture:
 *  - Leaflet handles the base tiles, zoom controls, and coordinate system
 *    (preserving FIR/weather/GNSS overlay compatibility via mapRef).
 *  - AircraftLayerController manages a deck.gl IconLayer on top of Leaflet
 *    entirely outside the React render cycle. Position/heading/color updates
 *    happen via imperative setProps() calls at 60fps.
 *  - This component never re-renders due to aircraft movement — only when
 *    the *identity* of visible flights changes does it poke the controller.
 *
 * The old DenseFlightLayer is no longer needed — this single layer handles
 * 0–50,000+ aircraft via WebGL instanced rendering.
 */

import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css';
import { useFlightStore } from '../../stores/flightStore';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFIRStore } from '../../stores/firStore';
import { useMapViewportStore } from '../../stores/mapViewportStore';
import { getFIRBounds } from '../../lib/firService';
import { flightTypeColor } from '../../lib/utils';
import { setMapInstance } from './mapRef';
import { useSelectedFlightTrail } from '../../hooks/useSelectedFlightTrail';
import { AircraftLayerController } from './AircraftLayerController';
import FIRDiagnostics from './FIRDiagnostics';
import type { ADSBFlight } from '../../types/flight';

type BaseLayerConfig = {
  name: string;
  url: string;
  attribution: string;
  options?: L.TileLayerOptions;
  aeronautical?: boolean;
};

function normalizeLongitude(lng: number): number {
  let normalized = lng;
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

const MAP_CENTER: L.LatLngExpression = [50, 10]; // Europe

const configuredAeronauticalTileUrl = (import.meta.env.VITE_AERONAUTICAL_TILE_URL ?? '').trim();
const configuredAeronauticalTileName = (import.meta.env.VITE_AERONAUTICAL_TILE_NAME ?? 'Aeronautical Chart').trim();
const configuredAeronauticalAttribution = (
  import.meta.env.VITE_AERONAUTICAL_TILE_ATTRIBUTION ?? 'Aeronautical chart data'
).trim();

function createBaseLayerConfigs(): BaseLayerConfig[] {
  const configs: BaseLayerConfig[] = [];

  // Standard dark basemap (FIR borders are always drawn on top by FIRLayer)
  configs.push({
    name: 'Standard + FIR Borders',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; <a href="https://carto.com">CARTO</a>',
    options: { maxZoom: 18, subdomains: 'abcd' },
  });

  // Aeronautical chart overlay (visible at higher zoom levels)
  if (configuredAeronauticalTileUrl) {
    configs.push({
      name: configuredAeronauticalTileName,
      url: configuredAeronauticalTileUrl,
      attribution: configuredAeronauticalAttribution,
      aeronautical: true,
      options: {
        maxZoom: 18,
      },
    });
  }

  return configs;
}

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AircraftLayerController | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFittedRef = useRef(false);

  const selectedFlight = useFlightStore((s) => s.selectedFlight);
  const selectFlight = useFlightStore((s) => s.selectFlight);
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);

  const flights = useVisibleFlightStore((s) => s.visibleFlights);
  const selectedTrail = useSelectedFlightTrail();

  // Initialize Leaflet map + AircraftLayerController
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: MAP_CENTER,
      zoom: 5,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
    });

    const attributionControl = L.control.attribution({ position: 'bottomleft', prefix: false });
    attributionControl.addTo(map);

    // Add zoom control to top-right
    L.control.zoom({ position: 'topright' }).addTo(map);

    const baseLayers = createBaseLayerConfigs();
    const baseLayerInstances = Object.fromEntries(
      baseLayers.map((config) => [
        config.name,
        L.tileLayer(config.url, {
          attribution: config.attribution,
          ...config.options,
        }),
      ]),
    ) as Record<string, L.TileLayer>;

    const defaultBaseLayer =
      baseLayers.find((config) => !config.aeronautical) ??
      baseLayers[0];

    baseLayerInstances[defaultBaseLayer.name].addTo(map);
    L.control.layers(baseLayerInstances, undefined, { position: 'topright', collapsed: false }).addTo(map);

    trailLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setMapInstance(map);

    // Create the imperative aircraft layer controller (lives outside React)
    const controller = new AircraftLayerController(map);
    controllerRef.current = controller;

    // Wire click handler to Zustand store
    controller.onSelect((icao24) => {
      useFlightStore.getState().selectFlight(icao24);
    });

    const updateViewport = () => {
      const bounds = map.getBounds();
      useMapViewportStore.getState().setViewport({
        minLat: Math.max(-90, bounds.getSouth()),
        minLng: normalizeLongitude(bounds.getWest()),
        maxLat: Math.min(90, bounds.getNorth()),
        maxLng: normalizeLongitude(bounds.getEast()),
      }, map.getZoom());
    };

    map.on('moveend zoomend', updateViewport);
    updateViewport();

    return () => {
      controller.destroy();
      controllerRef.current = null;
      map.off('moveend zoomend', updateViewport);
      useMapViewportStore.getState().clearViewport();
      setMapInstance(null);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Auto-fit map to selected FIR bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedFIRs.length === 0) return;
    if (hasFittedRef.current) return; // Only fit on first load

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let hasBounds = false;

    for (const firId of selectedFIRs) {
      const b = getFIRBounds(firId);
      if (!b) continue;
      hasBounds = true;
      if (b.minLat < minLat) minLat = b.minLat;
      if (b.maxLat > maxLat) maxLat = b.maxLat;
      if (b.minLng < minLng) minLng = b.minLng;
      if (b.maxLng > maxLng) maxLng = b.maxLng;
    }

    if (hasBounds) {
      map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [40, 40] });
      hasFittedRef.current = true;
    }
  }, [selectedFIRs]);

  // Push flight data to the imperative controller (bypasses React reconciliation)
  useEffect(() => {
    controllerRef.current?.setFlights(flights);
  }, [flights]);

  // Push selection state to the controller
  useEffect(() => {
    controllerRef.current?.setSelected(selectedFlight);
  }, [selectedFlight]);

  // Draw trail for selected flight (trail fetched on-demand via REST)
  useEffect(() => {
    const trailLayer = trailLayerRef.current;
    if (!trailLayer) return;
    trailLayer.clearLayers();

    if (!selectedFlight || selectedTrail.length < 2) return;

    const flight = flights.find((f) => f.icao24 === selectedFlight);
    if (!flight) return;

    const latlngs = selectedTrail.map((t) => [t.lat, t.lon] as L.LatLngExpression);
    L.polyline(latlngs, {
      color: flightTypeColor(flight.type),
      weight: 2,
      opacity: 0.7,
      dashArray: '6, 4',
      className: 'flight-trail',
    }).addTo(trailLayer);
  }, [selectedFlight, selectedTrail, flights]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      <FIRDiagnostics />
    </>
  );
}
