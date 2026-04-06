/**
 * FIRPanel — FIR management UI embedded in the sidebar.
 */

import { MapPin, X, Settings } from 'lucide-react';
import { useFIRStore } from '../../stores/firStore';
import { useFilterStore } from '../../stores/filterStore';
import type { AircraftScope } from '../../stores/filterStore';
import { getFIRList } from '../../lib/firService';
import './FIRPanel.css';

export default function FIRPanel() {
  const { selectedFIRs, removeFIR, reopenFIRSetup } = useFIRStore();
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const setAircraftScope = useFilterStore((s) => s.setAircraftScope);

  return (
    <div className="fir-panel">
      <div className="fir-panel__header">
        <span className="fir-panel__title">Monitored FIRs</span>
        <button className="fir-panel__icon-btn" onClick={reopenFIRSetup} aria-label="Edit monitored FIRs">
          <Settings size={13} />
        </button>
      </div>

      <div className="fir-panel__body">
        {selectedFIRs.length > 0 && (
          <div className="fir-panel__chips">
            {selectedFIRs.map((id) => {
              const fir = getFIRList().find((f) => f.id === id);
              return (
                <span key={id} className="fir-panel__chip">
                  <MapPin size={10} className="fir-panel__chip-icon" />
                  <span className="fir-panel__chip-text">{fir ? fir.name : id}</span>
                  {selectedFIRs.length > 1 && (
                    <button
                      className="fir-panel__chip-remove"
                      onClick={() => removeFIR(id)}
                      aria-label={`Remove ${fir ? fir.name : id}`}
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        <div className="fir-panel__scope">
          {(['fir-only', 'all'] as AircraftScope[]).map((scope) => (
            <button
              key={scope}
              className={`fir-panel__scope-btn${aircraftScope === scope ? ' fir-panel__scope-btn--active' : ''}`}
              onClick={() => setAircraftScope(scope)}
              aria-pressed={aircraftScope === scope}
            >
              {scope === 'all' ? 'All Aircraft' : 'FIR Only'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
