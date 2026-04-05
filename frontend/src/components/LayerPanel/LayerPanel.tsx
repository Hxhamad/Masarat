import { X } from 'lucide-react';
import { useLayerStore } from '../../stores/layerStore';
import './LayerPanel.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <div className="layer-panel__toggle">
      <span className="layer-panel__label">{label}</span>
      <button
        className={`layer-panel__switch ${on ? 'layer-panel__switch--on' : ''}`}
        onClick={onToggle}
        aria-pressed={on}
        aria-label={`Toggle ${label}`}
      />
    </div>
  );
}

export default function LayerPanel({ open, onClose }: Props) {
  const {
    weatherRadarEnabled, toggleWeatherRadar,
    weatherMetarEnabled, toggleWeatherMetar,
    weatherAlertsEnabled, toggleWeatherAlerts,
    weatherForecastEnabled, toggleWeatherForecast,
    gnssHeatmapEnabled, toggleGNSSHeatmap,
  } = useLayerStore();

  if (!open) return null;

  return (
    <>
      <div className="layer-panel-overlay" onClick={onClose} />
      <div className="layer-panel">
        <div className="layer-panel__header">
          <span className="layer-panel__title">Map Layers</span>
          <button className="layer-panel__close" onClick={onClose} aria-label="Close layer panel">
            <X size={14} />
          </button>
        </div>
        <div className="layer-panel__body">
          <div className="layer-panel__section-title">Weather</div>
          <Toggle on={weatherRadarEnabled} onToggle={toggleWeatherRadar} label="Radar Overlay" />
          <Toggle on={weatherMetarEnabled} onToggle={toggleWeatherMetar} label="METAR Stations" />
          <Toggle on={weatherAlertsEnabled} onToggle={toggleWeatherAlerts} label="SIGMETs / AIRMETs" />
          <Toggle on={weatherForecastEnabled} onToggle={toggleWeatherForecast} label="FIR Forecast" />

          <div className="layer-panel__section-title">Navigation Anomaly</div>
          <Toggle on={gnssHeatmapEnabled} onToggle={toggleGNSSHeatmap} label="GNSS Jamming Hex Layer" />
        </div>
      </div>
    </>
  );
}
