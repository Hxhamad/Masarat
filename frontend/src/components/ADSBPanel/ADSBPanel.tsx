import { useEffect, useMemo } from 'react';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import { useFilterStore } from '../../stores/filterStore';
import { useFlightStore } from '../../stores/flightStore';
import { useUIStore } from '../../stores/uiStore';
import { useFIRStore } from '../../stores/firStore';
import { useHealthStore } from '../../stores/healthStore';
import { getFIRList } from '../../lib/firService';
import { flightTypeColor, formatAltitude, displayCallsign } from '../../lib/utils';
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
    <div className="adsb-panel">
      <FIRPanel />
      <ViewTabs />
      {effectiveViewMode === 'flights' && (
        <>
          <div className="adsb-panel__header">
            <span className="adsb-panel__fir-label">{headerLabel}</span>
            <span className="adsb-panel__count">{flights.length} aircraft</span>
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
                  <span className="adsb-panel__callsign">{displayCallsign(f)}</span>
                  <span className="adsb-panel__meta">
                    {formatAltitude(f.altitude)}
                    <br />
                    {f.aircraftType || f.icao24.toUpperCase()}
                    <br />
                    <span className="adsb-panel__coords">{f.latitude.toFixed(2)}° {f.longitude.toFixed(2)}°</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
      {effectiveViewMode === 'health' && <HealthPanel />}
      {effectiveViewMode === 'leaderboard' && <Leaderboard />}
    </div>
  );
}
