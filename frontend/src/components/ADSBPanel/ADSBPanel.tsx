import { useEffect, useMemo, useRef, useCallback } from 'react';
import { GripVertical } from 'lucide-react';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFilterStore } from '../../stores/filterStore';
import { useFlightStore } from '../../stores/flightStore';
import { useUIStore } from '../../stores/uiStore';
import { useFIRStore } from '../../stores/firStore';
import { useHealthStore } from '../../stores/healthStore';
import { getFIRList } from '../../lib/firService';
import { displayCallsign, flightTypeColor, formatAltitude, formatSpeed } from '../../lib/utils';
import type { ADSBFlight } from '../../types/flight';
import FIRPanel from './FIRPanel';
import ViewTabs from '../ViewTabs/ViewTabs';
import HealthPanel from '../HealthPanel/HealthPanel';
import Leaderboard from '../Leaderboard/Leaderboard';
import './ADSBPanel.css';

const DISPLAY_LIMIT = 200;
const callsignCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

interface RankedFlight {
  flight: ADSBFlight;
  sortKey: string;
}

function insertRankedFlight(list: RankedFlight[], candidate: RankedFlight, limit: number): void {
  if (limit <= 0) {
    return;
  }

  if (list.length === limit && callsignCollator.compare(candidate.sortKey, list[list.length - 1].sortKey) >= 0) {
    return;
  }

  let low = 0;
  let high = list.length;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (callsignCollator.compare(candidate.sortKey, list[mid].sortKey) < 0) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }

  list.splice(low, 0, candidate);
  if (list.length > limit) {
    list.pop();
  }
}

export default function ADSBPanel() {
  const flights = useVisibleFlightStore((s) => s.visibleFlights);
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const { selectedFlight, selectFlight } = useFlightStore();
  const { setInfoPanelOpen } = useUIStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const viewMode = useHealthStore((s) => s.viewMode);
  const setViewMode = useHealthStore((s) => s.setViewMode);

  /* ── Drag & resize refs ── */
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const resize = useRef({ active: false, startX: 0, startY: 0, baseW: 0, baseH: 0 });

  const onDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const d = drag.current;
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    d.baseX = rect.left;
    d.baseY = rect.top;
    d.startX = e.clientX;
    d.startY = e.clientY;
    d.active = true;

    const onMove = (ev: PointerEvent) => {
      if (!d.active) return;
      const x = d.baseX + ev.clientX - d.startX;
      const y = d.baseY + ev.clientY - d.startY;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.bottom = 'auto';
      el.style.right = 'auto';
    };
    const onUp = () => {
      d.active = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = resize.current;
    const el = panelRef.current;
    if (!el) return;
    r.baseW = el.offsetWidth;
    r.baseH = el.offsetHeight;
    r.startX = e.clientX;
    r.startY = e.clientY;
    r.active = true;

    const onMove = (ev: PointerEvent) => {
      if (!r.active) return;
      const w = Math.max(260, r.baseW + ev.clientX - r.startX);
      const h = Math.max(200, r.baseH + ev.clientY - r.startY);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
      el.style.bottom = 'auto';
    };
    const onUp = () => {
      r.active = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, []);

  const handleSelect = (icao24: string) => {
    selectFlight(icao24);
    setInfoPanelOpen(true);
  };

  useEffect(() => {
    if (aircraftScope === 'all' && viewMode !== 'flights') {
      setViewMode('flights');
    }
  }, [aircraftScope, viewMode, setViewMode]);

  // Build the FIR header label
  const firLabel = useMemo(() => {
    const firList = getFIRList();
    const names = selectedFIRs.map((id) => {
      const f = firList.find((fir) => fir.id === id);
      return f?.id ?? id;
    });
    return names.join(' · ');
  }, [selectedFIRs]);

  const effectiveViewMode = aircraftScope === 'all' ? 'flights' : viewMode;
  const headerLabel = aircraftScope === 'all' ? 'All Aircraft' : firLabel;
  const headerEyebrow = aircraftScope === 'all' ? 'Global traffic scope' : 'Focused FIR traffic';

  const display = useMemo(() => {
    let selected: ADSBFlight | null = null;
    const ranked: RankedFlight[] = [];
    const limit = selectedFlight ? DISPLAY_LIMIT - 1 : DISPLAY_LIMIT;

    for (const flight of flights) {
      if (selectedFlight && flight.icao24 === selectedFlight) {
        selected = flight;
        continue;
      }

      insertRankedFlight(
        ranked,
        {
          flight,
          sortKey: displayCallsign(flight),
        },
        limit,
      );
    }

    const topFlights = ranked.map((entry) => entry.flight);
    return selected ? [selected, ...topFlights] : topFlights;
  }, [flights, selectedFlight]);

  return (
    <div className="adsb-panel" ref={panelRef}>
      {/* Drag handle */}
      <div className="adsb-panel__drag-handle" onPointerDown={onDragPointerDown} title="Drag to move">
        <GripVertical size={14} />
        <span>Panel</span>
      </div>
      <FIRPanel />
      <ViewTabs />
      {effectiveViewMode === 'flights' && (
        <>
          <div className="adsb-panel__header">
            <div className="adsb-panel__heading">
              <span className="adsb-panel__eyebrow">{headerEyebrow}</span>
              <span className="adsb-panel__fir-label">{headerLabel}</span>
            </div>
            <div className="adsb-panel__count">
              <span className="adsb-panel__count-value">{flights.length.toLocaleString()}</span>
              <span className="adsb-panel__count-label">tracked</span>
            </div>
          </div>
          <div className="adsb-panel__list" role="listbox" aria-label="Aircraft list">
            {display.length === 0 ? (
              <div className="adsb-panel__empty">No aircraft match filters</div>
            ) : (
              display.map((f) => (
                <div
                  key={f.icao24}
                  role="option"
                  tabIndex={0}
                  aria-selected={f.icao24 === selectedFlight}
                  className={`adsb-panel__item ${f.icao24 === selectedFlight ? 'adsb-panel__item--selected' : ''}`}
                  onClick={() => handleSelect(f.icao24)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(f.icao24);
                    }
                  }}
                >
                  <span
                    className="adsb-panel__type-dot"
                    style={{ background: flightTypeColor(f.type) }}
                    aria-label={`Type: ${f.type || 'unknown'}`}
                  />
                  <div className="adsb-panel__item-main">
                    <div className="adsb-panel__item-top">
                      <span className="adsb-panel__callsign">{displayCallsign(f)}</span>
                      <span className="adsb-panel__altitude">{formatAltitude(f.altitude)}</span>
                    </div>
                    <div className="adsb-panel__item-bottom">
                      <span className="adsb-panel__aircraft">{f.aircraftType || f.icao24.toUpperCase()}</span>
                      <span className="adsb-panel__coords">{f.latitude.toFixed(2)}° {f.longitude.toFixed(2)}°</span>
                    </div>
                  </div>
                  <div className="adsb-panel__meta">
                    <span className="adsb-panel__speed">{formatSpeed(f.groundSpeed)}</span>
                    <span className="adsb-panel__type">{f.type}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
      {effectiveViewMode === 'health' && <HealthPanel />}
      {effectiveViewMode === 'leaderboard' && <Leaderboard />}
      {/* Resize handle */}
      <div className="adsb-panel__resize-handle" onPointerDown={onResizePointerDown} title="Drag to resize" />
    </div>
  );
}
