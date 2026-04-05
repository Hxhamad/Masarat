import { X } from 'lucide-react';
import { useFlightStore } from '../../stores/flightStore';
import { useUIStore } from '../../stores/uiStore';
import { formatAltitude, formatSpeed } from '../../lib/utils';
import './InfoPanel.css';

export default function InfoPanel() {
  const { flights, selectedFlight, selectFlight } = useFlightStore();
  const { infoPanelOpen, setInfoPanelOpen } = useUIStore();

  const flight = selectedFlight ? flights.get(selectedFlight) : null;
  const isOpen = infoPanelOpen && !!flight;

  const close = () => {
    selectFlight(null);
    setInfoPanelOpen(false);
  };

  return (
    <aside className={`info-panel ${isOpen ? 'info-panel--open' : ''}`}>
      <div className="info-panel__header">
        <span className="info-panel__title">
          {flight?.callsign || flight?.icao24.toUpperCase() || 'Aircraft'}
        </span>
        <button className="info-panel__close" onClick={close}>
          <X size={16} />
        </button>
      </div>

      {flight ? (
        <div className="info-panel__body">
          <div className="info-panel__section">
            <div className="info-panel__section-title">Identification</div>
            <div className="info-panel__row">
              <span className="info-panel__label">ICAO</span>
              <span className="info-panel__value">{flight.icao24.toUpperCase()}</span>
            </div>
            {flight.callsign && (
              <div className="info-panel__row">
                <span className="info-panel__label">Callsign</span>
                <span className="info-panel__value">{flight.callsign}</span>
              </div>
            )}
            {flight.registration && (
              <div className="info-panel__row">
                <span className="info-panel__label">Registration</span>
                <span className="info-panel__value">{flight.registration}</span>
              </div>
            )}
            {flight.aircraftType && (
              <div className="info-panel__row">
                <span className="info-panel__label">Aircraft</span>
                <span className="info-panel__value">{flight.aircraftType}</span>
              </div>
            )}
          </div>

          <div className="info-panel__section">
            <div className="info-panel__section-title">Position</div>
            <div className="info-panel__row">
              <span className="info-panel__label">Altitude</span>
              <span className="info-panel__value">{formatAltitude(flight.altitude)}</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">Speed</span>
              <span className="info-panel__value">{formatSpeed(flight.groundSpeed)}</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">Heading</span>
              <span className="info-panel__value">{Math.round(flight.heading)}°</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">V/S</span>
              <span className="info-panel__value">{flight.verticalRate} fpm</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">Lat</span>
              <span className="info-panel__value">{flight.latitude.toFixed(4)}</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">Lon</span>
              <span className="info-panel__value">{flight.longitude.toFixed(4)}</span>
            </div>
          </div>

          <div className="info-panel__section">
            <div className="info-panel__section-title">Data</div>
            {flight.squawk && (
              <div className="info-panel__row">
                <span className="info-panel__label">Squawk</span>
                <span className="info-panel__value">{flight.squawk}</span>
              </div>
            )}
            <div className="info-panel__row">
              <span className="info-panel__label">Source</span>
              <span className="info-panel__value">{flight.source.toUpperCase()}</span>
            </div>
            <div className="info-panel__row">
              <span className="info-panel__label">Type</span>
              <span className="info-panel__value">{flight.type}</span>
            </div>
          </div>

          {flight.met && (flight.met.windDirectionDeg != null || flight.met.oatC != null || flight.met.qnhHpa != null) && (
            <div className="info-panel__section">
              <div className="info-panel__section-title">Onboard Weather</div>
              {flight.met.windDirectionDeg != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">Wind</span>
                  <span className="info-panel__value">{flight.met.windDirectionDeg}° @ {flight.met.windSpeedKt ?? '?'} kt</span>
                </div>
              )}
              {flight.met.oatC != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">OAT</span>
                  <span className="info-panel__value">{flight.met.oatC}°C</span>
                </div>
              )}
              {flight.met.tatC != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">TAT</span>
                  <span className="info-panel__value">{flight.met.tatC}°C</span>
                </div>
              )}
              {flight.met.qnhHpa != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">QNH</span>
                  <span className="info-panel__value">{flight.met.qnhHpa} hPa</span>
                </div>
              )}
            </div>
          )}

          {flight.navQuality && (
            <div className="info-panel__section">
              <div className="info-panel__section-title">Nav Quality</div>
              {flight.navQuality.positionSource && (
                <div className="info-panel__row">
                  <span className="info-panel__label">Pos Src</span>
                  <span className="info-panel__value">{flight.navQuality.positionSource.toUpperCase()}</span>
                </div>
              )}
              {flight.navQuality.lastPositionAgeSec != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">Pos Age</span>
                  <span className="info-panel__value">{flight.navQuality.lastPositionAgeSec}s</span>
                </div>
              )}
              {flight.navQuality.nacp != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">NACp</span>
                  <span className="info-panel__value">{flight.navQuality.nacp}</span>
                </div>
              )}
              {flight.navQuality.nic != null && (
                <div className="info-panel__row">
                  <span className="info-panel__label">NIC</span>
                  <span className="info-panel__value">{flight.navQuality.nic}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="info-panel__empty">Select an aircraft to view details</div>
      )}
    </aside>
  );
}
