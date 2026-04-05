/**
 * LayerLegend — Dynamic legend shown for active overlay layers.
 *
 * Only renders sections for layers that are currently enabled.
 */

import { useLayerStore } from '../../stores/layerStore';
import './Legend.css';

export default function LayerLegend() {
  const radar = useLayerStore((s) => s.weatherRadarEnabled);
  const metar = useLayerStore((s) => s.weatherMetarEnabled);
  const alerts = useLayerStore((s) => s.weatherAlertsEnabled);
  const gnss = useLayerStore((s) => s.gnssHeatmapEnabled);

  const anyActive = radar || metar || alerts || gnss;
  if (!anyActive) return null;

  return (
    <div className="layer-legend">
      {metar && (
        <div className="layer-legend__section">
          <div className="layer-legend__title">METAR</div>
          <div className="layer-legend__items">
            <span className="legend-bar__dot" style={{ background: '#22c55e' }} /> VFR
            <span className="legend-bar__dot" style={{ background: '#3b82f6', marginLeft: 8 }} /> MVFR
            <span className="legend-bar__dot" style={{ background: '#ef4444', marginLeft: 8 }} /> IFR
            <span className="legend-bar__dot" style={{ background: '#a855f7', marginLeft: 8 }} /> LIFR
          </div>
        </div>
      )}
      {alerts && (
        <div className="layer-legend__section">
          <div className="layer-legend__title">Alerts</div>
          <div className="layer-legend__items">
            <span className="legend-bar__dot" style={{ background: '#ef4444' }} /> Warning
            <span className="legend-bar__dot" style={{ background: '#f59e0b', marginLeft: 8 }} /> Caution
            <span className="legend-bar__dot" style={{ background: '#3b82f6', marginLeft: 8 }} /> Info
          </div>
        </div>
      )}
      {gnss && (
        <div className="layer-legend__section">
          <div className="layer-legend__title">GNSS Hex Layer</div>
          <div className="layer-legend__items">
            <span className="legend-bar__dot" style={{ background: '#ef4444' }} /> High (60+)
            <span className="legend-bar__dot" style={{ background: '#f59e0b', marginLeft: 8 }} /> Med (30-59)
            <span className="legend-bar__dot" style={{ background: '#22c55e', marginLeft: 8 }} /> Low (&lt;30)
          </div>
          <div className="layer-legend__items" style={{ fontSize: '10px' }}>
            Visible viewport only, shown when sample volume is sufficient
          </div>
        </div>
      )}
      {radar && (
        <div className="layer-legend__section">
          <div className="layer-legend__title">Radar</div>
          <div className="layer-legend__items" style={{ fontSize: '10px' }}>
            Precipitation overlay active
          </div>
        </div>
      )}
    </div>
  );
}
