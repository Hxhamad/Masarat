import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css';
import type { ADSBFlight } from '../../types/flight';
import { useFlightStore } from '../../stores/flightStore';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFIRStore } from '../../stores/firStore';
import { useMapViewportStore } from '../../stores/mapViewportStore';
import { getFIRBounds } from '../../lib/firService';
import { flightTypeColor, formatAltitude, formatSpeed, displayCallsign } from '../../lib/utils';
import { setMapInstance } from './mapRef';
import { DENSE_FLIGHT_THRESHOLD } from './DenseFlightLayer';
import { useSelectedFlightTrail } from '../../hooks/useSelectedFlightTrail';
import FIRDiagnostics from './FIRDiagnostics';

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

// SVG aircraft icon factory — cached by (color, heading-bucket, selected)
const iconCache = new Map<string, L.DivIcon>();

function bucketHeading(heading: number): number {
  return Math.round(heading / 10) * 10;
}

function getAircraftIconKey(color: string, heading: number, selected: boolean): string {
  return `${color}_${bucketHeading(heading)}_${selected ? 1 : 0}`;
}

function getAircraftIcon(color: string, heading: number, selected: boolean): L.DivIcon {
  const h = bucketHeading(heading);
  const key = getAircraftIconKey(color, heading, selected);
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      html: `<div class="aircraft-icon ${selected ? 'aircraft-icon--selected' : ''}" style="transform: rotate(${h}deg)">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>
  </div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      className: '',
    });
    iconCache.set(key, icon);
  }
  return icon;
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

function buildPopupHtml(flight: ADSBFlight): string {
  return `<div class="flight-popup-content">
    <div class="callsign">${displayCallsign(flight)}</div>
    <div class="row"><span class="label">ICAO</span><span>${flight.icao24.toUpperCase()}</span></div>
    ${flight.registration ? `<div class="row"><span class="label">Reg</span><span>${flight.registration}</span></div>` : ''}
    ${flight.aircraftType ? `<div class="row"><span class="label">Type</span><span>${flight.aircraftType}</span></div>` : ''}
    <div class="row"><span class="label">Alt</span><span>${formatAltitude(flight.altitude)}</span></div>
    <div class="row"><span class="label">Spd</span><span>${formatSpeed(flight.groundSpeed)}</span></div>
    <div class="row"><span class="label">Hdg</span><span>${Math.round(flight.heading)}°</span></div>
    <div class="row"><span class="label">V/S</span><span>${flight.verticalRate} fpm</span></div>
    ${flight.squawk ? `<div class="row"><span class="label">Sqk</span><span>${flight.squawk}</span></div>` : ''}
    <div class="row"><span class="label">Lat</span><span>${flight.latitude.toFixed(4)}</span></div>
    <div class="row"><span class="label">Lon</span><span>${flight.longitude.toFixed(4)}</span></div>
  </div>`;
}

export default function FlightMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const markerIconKeysRef = useRef<Map<string, string>>(new Map());
  const markerAnimationRef = useRef<Map<string, number>>(new Map());
  const trailLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFittedRef = useRef(false);
  const selectedFlight = useFlightStore((s: ReturnType<typeof useFlightStore.getState>) => s.selectedFlight);
  const selectFlight = useFlightStore((s: ReturnType<typeof useFlightStore.getState>) => s.selectFlight);
  const selectedFIRs = useFIRStore((s: ReturnType<typeof useFIRStore.getState>) => s.selectedFIRs);

  const flights = useVisibleFlightStore((s) => s.visibleFlights);
  const viewportKey = useMapViewportStore((s) => s.viewportKey);
  const selectedTrail = useSelectedFlightTrail();

  const cancelMarkerAnimation = useCallback((icao24: string) => {
    const frame = markerAnimationRef.current.get(icao24);
    if (frame) {
      cancelAnimationFrame(frame);
      markerAnimationRef.current.delete(icao24);
    }
  }, []);

  const animateMarkerPosition = useCallback(
    (icao24: string, marker: L.Marker, latitude: number, longitude: number) => {
      cancelMarkerAnimation(icao24);

      const start = marker.getLatLng();
      const deltaLat = latitude - start.lat;
      const deltaLng = longitude - start.lng;

      if (Math.abs(deltaLat) < 0.0001 && Math.abs(deltaLng) < 0.0001) {
        marker.setLatLng([latitude, longitude]);
        return;
      }

      const startTime = performance.now();
      const duration = 1200;

      const step = (now: number) => {
        const progress = Math.min((now - startTime) / duration, 1);
        marker.setLatLng([
          start.lat + deltaLat * progress,
          start.lng + deltaLng * progress,
        ]);

        if (progress < 1) {
          const frame = requestAnimationFrame(step);
          markerAnimationRef.current.set(icao24, frame);
        } else {
          markerAnimationRef.current.delete(icao24);
        }
      };

      const frame = requestAnimationFrame(step);
      markerAnimationRef.current.set(icao24, frame);
    },
    [cancelMarkerAnimation],
  );

  // Initialize map
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
      for (const frame of markerAnimationRef.current.values()) {
        cancelAnimationFrame(frame);
      }
      markerIconKeysRef.current.clear();
      markerAnimationRef.current.clear();
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

  // Update markers
  const updateMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const bounds = map.getBounds();
    const south = bounds.getSouth() - 0.5;
    const north = bounds.getNorth() + 0.5;
    const west = bounds.getWest() - 0.5;
    const east = bounds.getEast() + 0.5;
    const viewportFlights = flights.filter(
      (f) =>
        f.latitude >= south &&
        f.latitude <= north &&
        f.longitude >= west &&
        f.longitude <= east,
    );

    const isDense = viewportFlights.length > DENSE_FLIGHT_THRESHOLD;
    const shouldShowLabels = !isDense && map.getZoom() >= 7 && viewportFlights.length <= 140;
    const flightsToRender: ADSBFlight[] = isDense ? [] : [...viewportFlights];
    const skipAnimation = flightsToRender.length > 350;

    // Always include the selected flight even if outside viewport.
    if (
      selectedFlight &&
      !flightsToRender.some((f) => f.icao24 === selectedFlight)
    ) {
      const sel = flights.find((f) => f.icao24 === selectedFlight);
      if (sel) flightsToRender.push(sel);
    }

    const currentIds = new Set<string>();

    for (const flight of flightsToRender) {
      currentIds.add(flight.icao24);
      const color = flightTypeColor(flight.type);
      const isSelected = flight.icao24 === selectedFlight;
      const iconKey = getAircraftIconKey(color, flight.heading, isSelected);

      let marker = markersRef.current.get(flight.icao24);

      if (marker) {
        // Animate position updates only when the count is low enough.
        if (!skipAnimation) {
          animateMarkerPosition(flight.icao24, marker, flight.latitude, flight.longitude);
        } else {
          cancelMarkerAnimation(flight.icao24);
          marker.setLatLng([flight.latitude, flight.longitude]);
        }

        if (markerIconKeysRef.current.get(flight.icao24) !== iconKey) {
          marker.setIcon(getAircraftIcon(color, flight.heading, isSelected));
          markerIconKeysRef.current.set(flight.icao24, iconKey);
        }
      } else {
        // Create new marker
        marker = L.marker([flight.latitude, flight.longitude], {
          icon: getAircraftIcon(color, flight.heading, isSelected),
        });

        marker.on('click', () => {
          selectFlight(flight.icao24);
        });

        marker.addTo(map);
        markersRef.current.set(flight.icao24, marker);
        markerIconKeysRef.current.set(flight.icao24, iconKey);
      }

      // Popup — only bind lazily on first open; update content if already open
      const existingPopup = marker.getPopup();
      if (existingPopup && existingPopup.isOpen()) {
        existingPopup.setContent(buildPopupHtml(flight));
      } else if (!existingPopup) {
        marker.bindPopup(() => buildPopupHtml(flight), { className: 'flight-popup', closeButton: false });
      }

      // Tooltip — only rebind when permanent-label state changes to avoid DOM churn
      const wantPermanent = shouldShowLabels || flight.icao24 === selectedFlight;
      const existing = marker.getTooltip();
      if (!existing || (existing.options.permanent !== wantPermanent)) {
        marker.unbindTooltip();
        marker.bindTooltip(displayCallsign(flight), {
          permanent: wantPermanent,
          direction: 'top',
          offset: [0, -14],
          opacity: 0.95,
          className: 'flight-id-tooltip',
          sticky: !shouldShowLabels,
        });
      }
    }

    // Remove stale markers
    for (const [id, marker] of markersRef.current) {
      if (!currentIds.has(id)) {
        cancelMarkerAnimation(id);
        marker.remove();
        markersRef.current.delete(id);
        markerIconKeysRef.current.delete(id);
      }
    }
  }, [flights, selectedFlight, selectFlight, animateMarkerPosition, cancelMarkerAnimation]);

  useEffect(() => {
    updateMarkers();
    // viewportKey triggers re-render on pan/zoom so viewport-filtering picks up newly visible flights.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateMarkers, viewportKey]);

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
