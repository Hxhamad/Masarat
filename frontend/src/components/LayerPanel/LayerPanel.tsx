import { X, Info } from 'lucide-react';
import { useLayerStore } from '../../stores/layerStore';
import { useFIRStore } from '../../stores/firStore';
import { useGNSSStore } from '../../stores/gnssStore';
import { useWeatherStore } from '../../stores/weatherStore';
import './LayerPanel.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Scope = 'global' | 'fir' | 'viewport';

interface LayerRowProps {
  on: boolean;
  onToggle: () => void;
  label: string;
  description: string;
  scope: Scope;
  hint?: string | null;
  disabled?: boolean;
}

const SCOPE_LABEL: Record<Scope, string> = {
  global: 'Global',
  fir: 'FIR',
  viewport: 'Viewport',
};

function LayerRow({ on, onToggle, label, description, scope, hint, disabled }: LayerRowProps) {
  return (
    <div className={`layer-panel__row ${disabled ? 'layer-panel__row--disabled' : ''}`}>
      <div className="layer-panel__toggle">
        <div className="layer-panel__info">
          <span className="layer-panel__label">{label}</span>
          <span className={`layer-panel__scope layer-panel__scope--${scope}`}>{SCOPE_LABEL[scope]}</span>
        </div>
        <button
          className={`layer-panel__switch ${on ? 'layer-panel__switch--on' : ''}`}
          onClick={disabled ? undefined : onToggle}
          aria-pressed={on}
          aria-label={`Toggle ${label}`}
          disabled={disabled}
        />
      </div>
      <span className="layer-panel__desc">{description}</span>
      {hint && on && (
        <span className="layer-panel__hint">
          <Info size={10} /> {hint}
        </span>
      )}
    </div>
  );
}

export default function LayerPanel({ open, onClose }: Props) {
  const {
    weatherRadarEnabled, toggleWeatherRadar,
    weatherMetarEnabled, toggleWeatherMetar,
    weatherAlertsEnabled, toggleWeatherAlerts,
    gnssHeatmapEnabled, toggleGNSSHeatmap,
  } = useLayerStore();

  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const gnssLoading = useGNSSStore((s) => s.loading);
  const gnssBins = useGNSSStore((s) => s.heatBins);
  const metarLoading = useWeatherStore((s) => s.metarLoading);
  const metarCount = useWeatherStore((s) => s.metarByStation.size);
  const alertsLoading = useWeatherStore((s) => s.alertsLoading);
  const alertsCount = useWeatherStore((s) => s.alerts.length);

  const noFIR = selectedFIRs.length === 0;

  const metarHint = noFIR
    ? 'Select a FIR to load METAR stations'
    : metarLoading ? 'Loading…' : metarCount === 0 ? 'No stations in selected FIR(s)' : null;

  const alertsHint = noFIR
    ? 'Select a FIR to load weather advisories'
    : alertsLoading ? 'Loading…' : alertsCount === 0 ? 'No active SIGMETs/AIRMETs' : null;

  const gnssHint = gnssLoading
    ? 'Loading…'
    : gnssBins.length === 0 ? 'No anomaly data in current viewport — try zooming in' : null;

  if (!open) return null;

  return (
    <>
      <div className="layer-panel-overlay" onClick={onClose} />
      <div className="layer-panel">
        <div className="layer-panel__header">
          <div className="layer-panel__headline">
            <span className="layer-panel__eyebrow">Overlay control</span>
            <span className="layer-panel__title">Map Layers</span>
          </div>
          <button className="layer-panel__close" onClick={onClose} aria-label="Close layer panel">
            <X size={14} />
          </button>
        </div>
        <div className="layer-panel__body">
          <div className="layer-panel__intro">
            Choose the live weather and surveillance context you want on the map. FIR-scoped layers only load where monitored coverage exists.
          </div>

          <section className="layer-panel__section">
            <div className="layer-panel__section-title">Weather overlays</div>
            <div className="layer-panel__section-copy">Atmospheric context for precipitation, stations, and advisory polygons.</div>
            <LayerRow
              on={weatherRadarEnabled} onToggle={toggleWeatherRadar}
              label="Radar Overlay" scope="global"
              description="Global precipitation imagery from RainViewer"
            />
            <LayerRow
              on={weatherMetarEnabled} onToggle={toggleWeatherMetar}
              label="METAR Stations" scope="fir"
              description="Airport weather observations — visibility, ceiling, wind"
              hint={metarHint}
            />
            <LayerRow
              on={weatherAlertsEnabled} onToggle={toggleWeatherAlerts}
              label="SIGMETs / AIRMETs" scope="fir"
              description="Significant weather advisories and alert polygons"
              hint={alertsHint}
            />
          </section>

          <section className="layer-panel__section">
            <div className="layer-panel__section-title">Navigation anomaly</div>
            <div className="layer-panel__section-copy">Viewport-driven surveillance confidence for suspected GNSS disruption.</div>
            <LayerRow
              on={gnssHeatmapEnabled} onToggle={toggleGNSSHeatmap}
              label="GNSS Jamming Hex Layer" scope="viewport"
              description="GPS/GNSS anomaly detection scored per H3 hex cell"
              hint={gnssHint}
            />
          </section>
        </div>
      </div>
    </>
  );
}
