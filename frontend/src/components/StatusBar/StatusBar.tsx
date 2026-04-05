import { useState, useEffect } from 'react';
import { useFlightStore } from '../../stores/flightStore';
import { useFIRStore } from '../../stores/firStore';
import { useWeatherStore } from '../../stores/weatherStore';
import { useGNSSStore } from '../../stores/gnssStore';
import { useLayerStore } from '../../stores/layerStore';
import './StatusBar.css';

const STALE_THRESHOLD = 30_000; // 30s without a message = stale

function ageLabel(ts: number | null): string {
  if (!ts) return '--';
  const sec = Math.round((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m`;
}

export default function StatusBar() {
  const { stats, connectionStatus, flights, lastMessageAt } = useFlightStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const lastRadarFetch = useWeatherStore((s) => s.lastRadarFetch);
  const lastMetarFetch = useWeatherStore((s) => s.lastMetarFetch);
  const gnssLastFetch = useGNSSStore((s) => s.lastFetch);
  const radarEnabled = useLayerStore((s) => s.weatherRadarEnabled);
  const metarEnabled = useLayerStore((s) => s.weatherMetarEnabled);
  const gnssEnabled = useLayerStore((s) => s.gnssHeatmapEnabled);

  const [isStale, setIsStale] = useState(false);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastMessageAt > 0 && Date.now() - lastMessageAt > STALE_THRESHOLD) {
        setIsStale(true);
      } else {
        setIsStale(false);
      }
      forceUpdate((v) => v + 1);
    }, 5_000);
    return () => clearInterval(id);
  }, [lastMessageAt]);

  const dotClass = isStale && connectionStatus === 'connected'
    ? 'status-bar__dot status-bar__dot--stale'
    : `status-bar__dot status-bar__dot--${connectionStatus}`;

  const statusLabel = isStale && connectionStatus === 'connected'
    ? 'stale'
    : connectionStatus;

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <div className="status-bar__item">
          <span className={dotClass} />
          <span>{statusLabel}</span>
        </div>
        <div className="status-bar__item">
          <span className="status-bar__source">{stats.dataSource}</span>
        </div>
        {selectedFIRs.length > 0 && (
          <div className="status-bar__item">
            <span className="status-bar__fir-badge">FIR</span>
            <span className="status-bar__fir-codes">{selectedFIRs.join(' · ')}</span>
          </div>
        )}
      </div>

      <div className="status-bar__right">
        <div className="status-bar__item">
          <span>{flights.size} aircraft</span>
        </div>
        <div className="status-bar__item">
          <span>{stats.messagesPerSecond} msg/s</span>
        </div>
        {radarEnabled && (
          <div className="status-bar__item">
            <span className="status-bar__source">RAD</span>
            <span>{ageLabel(lastRadarFetch)}</span>
          </div>
        )}
        {metarEnabled && (
          <div className="status-bar__item">
            <span className="status-bar__source">MET</span>
            <span>{ageLabel(lastMetarFetch)}</span>
          </div>
        )}
        {gnssEnabled && (
          <div className="status-bar__item">
            <span className="status-bar__source">GNSS</span>
            <span>{ageLabel(gnssLastFetch)}</span>
          </div>
        )}
        <div className="status-bar__item">
          <span>{stats.lastUpdate ? new Date(stats.lastUpdate).toLocaleTimeString() : '--:--:--'}</span>
        </div>
      </div>
    </div>
  );
}
