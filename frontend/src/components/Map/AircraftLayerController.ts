/**
 * AircraftLayerController — Imperative GPU aircraft rendering engine.
 *
 * Manages a deck.gl IconLayer on top of a Leaflet map, completely outside
 * the React render cycle. Aircraft positions, headings, and colors are
 * updated via `deck.setProps()` at up to 60fps without triggering React
 * reconciliation.
 *
 * Designed for 50,000+ concurrent aircraft using WebGL instanced rendering.
 */

import type L from 'leaflet';
import type { ADSBFlight } from '../../types/flight';
import type { DeckOverlay as DeckOverlayType } from '@deck.gl-community/leaflet';
import { displayCallsign, formatAltitude } from '../../lib/utils';

// ── Types ──

type RGBA = [number, number, number, number];
type FlightEntry = ADSBFlight & { _idx: number };

// ── Constants ──

const AIRCRAFT_ICON_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24">
    <path fill="white" d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
  </svg>
`;

const AIRCRAFT_ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(AIRCRAFT_ICON_SVG)}`;
const AIRCRAFT_ICON_MAPPING = {
  aircraft: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: true },
};

// ── CSS variable color cache ──

const TYPE_COLOR_VAR: Record<string, string> = {
  airline: '--flight-airline',
  private: '--flight-private',
  cargo: '--flight-cargo',
  military: '--flight-military',
  ground: '--flight-ground',
  helicopter: '--flight-helicopter',
};

const colorCache = new Map<string, RGBA>();

function resolveTypeColor(type: string): RGBA {
  const cached = colorCache.get(type);
  if (cached) return cached;

  const cssVar = TYPE_COLOR_VAR[type] ?? '--flight-airline';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();

  let color: RGBA = [0, 212, 255, 220]; // fallback
  if (raw.startsWith('#')) {
    const hex = raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
    color = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      220,
    ];
  } else {
    const m = raw.match(/rgba?\(([^)]+)\)/i);
    if (m) {
      const [r = '0', g = '0', b = '0'] = m[1].split(',').map(s => s.trim());
      color = [Number(r), Number(g), Number(b), 220];
    }
  }

  colorCache.set(type, color);
  return color;
}

// ── Selected flight highlight color ──

const SELECTED_HIGHLIGHT: RGBA = [255, 255, 255, 255];
const SELECTED_SIZE = 22;
const DEFAULT_SIZE = 16;

// ══════════════════════════════════════════════════════════
// AircraftLayerController
// ══════════════════════════════════════════════════════════

export class AircraftLayerController {
  private map: L.Map;
  private overlay: DeckOverlayType | null = null;
  private initPromise: Promise<void>;

  // Mutable data table — updated imperatively, never triggers React
  private dataTable: FlightEntry[] = [];
  private indexByIcao = new Map<string, number>();

  // Selection state
  private selectedIcao: string | null = null;
  private onSelectCallback: ((icao24: string) => void) | null = null;

  // Animation
  private rafId: number | null = null;
  private dirty = false;
  private generation = 0;

  // Lazy-loaded constructor for IconLayer
  private IconLayerClass: typeof import('@deck.gl/layers').IconLayer | null = null;

  constructor(map: L.Map) {
    this.map = map;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const [deckMod, layersMod] = await Promise.all([
      import('@deck.gl-community/leaflet'),
      import('@deck.gl/layers'),
    ]);

    this.IconLayerClass = layersMod.IconLayer;

    this.overlay = new deckMod.DeckOverlay({
      layers: [],
      getTooltip: this.getTooltip.bind(this),
    });

    this.map.addLayer(this.overlay);
    this.startAnimationLoop();
  }

  // ── Public API ──

  /**
   * Set the complete flight dataset. Called from the React component
   * via useEffect — but only pokes the data table, never causes re-render.
   */
  setFlights(flights: ADSBFlight[]): void {
    this.generation++;
    const gen = this.generation;

    // Rebuild index
    this.indexByIcao.clear();
    this.dataTable.length = flights.length;

    for (let i = 0; i < flights.length; i++) {
      const f = flights[i] as FlightEntry;
      f._idx = i;
      this.dataTable[i] = f;
      this.indexByIcao.set(f.icao24, i);
    }

    // Mark dirty so the next rAF tick picks it up
    this.dirty = true;

    // If generation changed mid-loop, don't clobber
    if (gen !== this.generation) return;
  }

  /** Update selected flight — causes a re-render with highlight */
  setSelected(icao24: string | null): void {
    if (this.selectedIcao === icao24) return;
    this.selectedIcao = icao24;
    this.dirty = true;
  }

  /** Register the click handler (wired to useFlightStore.selectFlight) */
  onSelect(cb: (icao24: string) => void): void {
    this.onSelectCallback = cb;
  }

  /** Tear down — call on component unmount */
  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.overlay) {
      this.map.removeLayer(this.overlay);
      this.overlay = null;
    }
    this.dataTable = [];
    this.indexByIcao.clear();
  }

  // ── Animation loop ──

  private startAnimationLoop(): void {
    const tick = () => {
      if (this.dirty) {
        this.dirty = false;
        this.pushLayer();
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private pushLayer(): void {
    if (!this.overlay || !this.IconLayerClass) return;

    const selectedIcao = this.selectedIcao;
    const data = this.dataTable;

    // Build a NEW array reference to trigger deck.gl's data diff
    // (deck.gl skips layer updates if data reference is identical)
    const snapshot = data.slice();

    const layer = new this.IconLayerClass<FlightEntry>({
      id: 'aircraft-layer',
      data: snapshot,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 50],
      iconAtlas: AIRCRAFT_ICON_ATLAS,
      iconMapping: AIRCRAFT_ICON_MAPPING,

      getIcon: () => 'aircraft',

      getPosition: (d: FlightEntry) => [d.longitude, d.latitude],

      getAngle: (d: FlightEntry) => -d.heading,

      getColor: (d: FlightEntry): RGBA => {
        if (d.icao24 === selectedIcao) return SELECTED_HIGHLIGHT;
        return resolveTypeColor(d.type);
      },

      getSize: (d: FlightEntry) => (d.icao24 === selectedIcao ? SELECTED_SIZE : DEFAULT_SIZE),

      sizeUnits: 'pixels' as const,
      sizeMinPixels: 10,
      sizeMaxPixels: 28,
      alphaCutoff: 0.05,
      billboard: true,

      // Smooth transitions when the data array order is stable
      transitions: {
        getPosition: { duration: 800, type: 'interpolation' },
        getAngle: { duration: 400 },
      },

      onClick: (info: { object?: FlightEntry }) => {
        if (info.object && this.onSelectCallback) {
          this.onSelectCallback(info.object.icao24);
        }
      },

      // Performance: enable WebGL instancing extension
      _subLayerProps: {
        'icon-layer-icons': {
          parameters: {
            depthTest: false,
          },
        },
      },

      updateTriggers: {
        getColor: selectedIcao,
        getSize: selectedIcao,
      },
    });

    this.overlay.setProps({ layers: [layer] });
  }

  // ── Tooltip ──

  private getTooltip({ object }: { object?: FlightEntry }): { html: string; style: Record<string, string> } | null {
    if (!object) return null;
    return {
      html: `<div style="font-size:11px;line-height:1.5">
        <strong>${displayCallsign(object)}</strong><br/>
        ${formatAltitude(object.altitude)}<br/>
        ${Math.round(object.groundSpeed)} kt · ${Math.round(object.heading)}°
        ${object.type !== 'airline' ? `<br/><em>${object.type}</em>` : ''}
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
  }
}
