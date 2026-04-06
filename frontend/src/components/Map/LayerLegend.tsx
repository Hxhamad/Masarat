/**
 * LayerLegend — Dynamic legend shown for active overlay layers.
 *
 * Only renders sections for layers that are currently enabled.
 */

import { useLayerStore } from '../../stores/layerStore';
import { useGNSSStore } from '../../stores/gnssStore';
import { useFIRStore } from '../../stores/firStore';
import { useWeatherStore } from '../../stores/weatherStore';
import './Legend.css';

function GNSSLegend() {
  const bins = useGNSSStore((s) => s.heatBins);
  const inputFlightCount = useGNSSStore((s) => s.inputFlightCount);
  const loading = useGNSSStore((s) => s.loading);

  const critical = bins.filter((b) => b.anomalyScore >= 60).length;
  const elevated = bins.filter((b) => b.anomalyScore >= 30 && b.anomalyScore < 60).length;
  const mild = bins.filter((b) => b.anomalyScore < 30).length;
  const totalCells = bins.length;

  const affectedFlights = totalCells > 0
    ? bins.reduce((sum, b) => sum + Math.round(b.flightCount * b.suspectedAffectedPct / 100), 0)
    : 0;

  return (
    <div className="layer-legend__section">
      <div className="layer-legend__title">GNSS Anomaly</div>

      {/* Gradient severity bar */}
      <div className="gnss-legend__bar-row">
        <span className="gnss-legend__bar-label">Low</span>
        <div className="gnss-legend__gradient" />
        <span className="gnss-legend__bar-label">Critical</span>
      </div>
      <div className="gnss-legend__scale">
        <span>0</span><span>30</span><span>60</span><span>100</span>
      </div>

      {/* Cell breakdown */}
      {totalCells > 0 ? (
        <>
          <div className="gnss-legend__cells">
            <span className="layer-legend__chip">
              <span className="legend-bar__dot" style={{ background: '#ef4444' }} />
              Critical ({critical})
            </span>
            <span className="layer-legend__chip">
              <span className="legend-bar__dot" style={{ background: '#f59e0b' }} />
              Elevated ({elevated})
            </span>
            <span className="layer-legend__chip">
              <span className="legend-bar__dot" style={{ background: '#22c55e' }} />
              Mild ({mild})
            </span>
          </div>
          <div className="gnss-legend__stats">
            {affectedFlights} suspected affected out of {inputFlightCount} flights
          </div>
        </>
      ) : (
        <div className="gnss-legend__stats">
          {loading ? 'Scanning viewport…' : 'No anomaly cells in viewport'}
        </div>
      )}

      <div className="gnss-legend__evidence-title">Evidence signals:</div>
      <div className="gnss-legend__evidence">
        <span>Nav Integrity</span>
        <span>MLAT Share</span>
        <span>Pos Dropouts</span>
        <span>Cross-Src</span>
      </div>
    </div>
  );
}

function MetarLegend() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const count = useWeatherStore((s) => s.metarByStation.size);

  return (
    <div className="layer-legend__section">
      <div className="layer-legend__title">METAR</div>
      {selectedFIRs.length === 0 ? (
        <div className="layer-legend__note layer-legend__note--warn">
          Select a FIR to see stations
        </div>
      ) : count === 0 ? (
        <div className="layer-legend__note">
          No stations loaded
        </div>
      ) : (
        <div className="layer-legend__items">
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#22c55e' }} /> VFR</span>
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#3b82f6' }} /> MVFR</span>
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#ef4444' }} /> IFR</span>
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#a855f7' }} /> LIFR</span>
        </div>
      )}
    </div>
  );
}

function AlertsLegend() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const count = useWeatherStore((s) => s.alerts.length);

  return (
    <div className="layer-legend__section">
      <div className="layer-legend__title">Alerts</div>
      {selectedFIRs.length === 0 ? (
        <div className="layer-legend__note layer-legend__note--warn">
          Select a FIR to see advisories
        </div>
      ) : count === 0 ? (
        <div className="layer-legend__note">
          No active advisories
        </div>
      ) : (
        <div className="layer-legend__items">
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#ef4444' }} /> Warning</span>
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#f59e0b' }} /> Caution</span>
          <span className="layer-legend__chip"><span className="legend-bar__dot" style={{ background: '#3b82f6' }} /> Info</span>
        </div>
      )}
    </div>
  );
}

export default function LayerLegend() {
  const radar = useLayerStore((s) => s.weatherRadarEnabled);
  const metar = useLayerStore((s) => s.weatherMetarEnabled);
  const alerts = useLayerStore((s) => s.weatherAlertsEnabled);
  const gnss = useLayerStore((s) => s.gnssHeatmapEnabled);

  const anyActive = radar || metar || alerts || gnss;
  if (!anyActive) return null;

  return (
    <div className="layer-legend">
      {metar && <MetarLegend />}
      {alerts && <AlertsLegend />}
      {gnss && <GNSSLegend />}
      {radar && (
        <div className="layer-legend__section">
          <div className="layer-legend__title">Radar</div>
          <div className="layer-legend__note">
            Precipitation overlay active
          </div>
        </div>
      )}
    </div>
  );
}
