import { useMemo } from 'react';
import { useHealthStore } from '../../stores/healthStore';
import { useFIRStore } from '../../stores/firStore';
import { useFIRHealth } from '../../hooks/useFIRHealth';
import { getFIRList } from '../../lib/firService';
import type { FIRHealthSummary, FIRHealthSnapshot } from '../../types/health';
import './HealthPanel.css';

function chiColor(chi: number): string {
  if (chi >= 75) return 'var(--status-ok)';
  if (chi >= 50) return 'var(--status-warn)';
  return 'var(--status-error)';
}

function chiLabel(chi: number): string {
  if (chi >= 85) return 'Excellent';
  if (chi >= 70) return 'Good';
  if (chi >= 50) return 'Fair';
  if (chi >= 30) return 'Poor';
  return 'Critical';
}

function ScoreGauge({ label, score, weight }: { label: string; score: number; weight: string }) {
  return (
    <div className="hp-gauge">
      <div className="hp-gauge__header">
        <span className="hp-gauge__label">{label}</span>
        <span className="hp-gauge__weight">{weight}</span>
      </div>
      <div className="hp-gauge__bar-bg">
        <div
          className="hp-gauge__bar-fill"
          style={{ width: `${score}%`, background: chiColor(score) }}
        />
      </div>
      <span className="hp-gauge__value" style={{ color: chiColor(score) }}>{score}</span>
    </div>
  );
}

function MiniSparkline({ history }: { history: FIRHealthSnapshot[] }) {
  if (history.length < 2) return <div className="hp-spark hp-spark--empty">No history yet</div>;

  const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const values = sorted.map(h => h.chi);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 1);
  const w = 200;
  const h = 40;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / (max - min)) * h;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg className="hp-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        points={points}
      />
    </svg>
  );
}

export default function HealthPanel() {
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const healthByFIR = useHealthStore((s) => s.healthByFIR);
  const historyByFIR = useHealthStore((s) => s.historyByFIR);
  const healthLoading = useHealthStore((s) => s.healthLoading);
  const error = useHealthStore((s) => s.error);

  useFIRHealth();

  // Show health for the first selected FIR
  const activeFIR = selectedFIRs[0] ?? '';
  const health: FIRHealthSummary | undefined = healthByFIR.get(activeFIR);
  const history = historyByFIR.get(activeFIR) ?? [];

  // Multi-FIR mini cards
  const firList = getFIRList();
  const otherFIRs = useMemo(
    () => selectedFIRs.slice(1).map(id => {
      const fir = firList.find(f => f.id === id);
      return { id, name: fir?.name ?? id, health: healthByFIR.get(id) };
    }),
    [selectedFIRs, healthByFIR, firList]
  );

  if (!activeFIR) {
    return (
      <div className="health-panel">
        <div className="hp-empty">Select an FIR to view health data</div>
      </div>
    );
  }

  if (healthLoading && !health) {
    return (
      <div className="health-panel">
        <div className="hp-loading">Loading health data…</div>
      </div>
    );
  }

  if (error && !health) {
    return (
      <div className="health-panel">
        <div className="hp-error">{error}</div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="health-panel">
        <div className="hp-empty">No health data available</div>
      </div>
    );
  }

  return (
    <div className="health-panel">
      {/* CHI Hero */}
      <div className="hp-hero">
        <div className="hp-hero__chi" style={{ color: chiColor(health.chi) }}>
          {health.chi}
        </div>
        <div className="hp-hero__meta">
          <div className="hp-hero__label" style={{ color: chiColor(health.chi) }}>
            {chiLabel(health.chi)}
          </div>
          <div className="hp-hero__fir">{health.firName || activeFIR}</div>
          <div className="hp-hero__country">{health.country}</div>
        </div>
      </div>

      {/* Pillar scores */}
      <div className="hp-scores">
        <ScoreGauge label="Safety" score={health.safetyScore} weight="30%" />
        <ScoreGauge label="Efficiency" score={health.efficiencyScore} weight="40%" />
        <ScoreGauge label="Fluidity" score={health.fluidityScore} weight="30%" />
      </div>

      {/* Stats strip */}
      <div className="hp-stats">
        <div className="hp-stat">
          <span className="hp-stat__value">{health.flightCount}</span>
          <span className="hp-stat__label">Aircraft</span>
        </div>
        <div className="hp-stat">
          <span className="hp-stat__value">{health.saturationPct}%</span>
          <span className="hp-stat__label">Saturation</span>
        </div>
        <div className="hp-stat">
          <span className="hp-stat__value">{health.co2EstimateKg.toLocaleString()}</span>
          <span className="hp-stat__label">CO₂ kg</span>
        </div>
      </div>

      {/* 24h trend */}
      <div className="hp-section">
        <div className="hp-section__title">24h Health Trend</div>
        <MiniSparkline history={history} />
      </div>

      {/* Top inefficient flights */}
      {health.topInefficient && health.topInefficient.length > 0 && (
        <div className="hp-section">
          <div className="hp-section__title">Top Inefficient Flights</div>
          <div className="hp-ineff-list">
            {health.topInefficient.map((f) => (
              <div key={f.icao24} className="hp-ineff-item">
                <span className="hp-ineff-item__cs">{f.callsign}</span>
                <span className="hp-ineff-item__kea">KEA {f.kea}x</span>
                <span className="hp-ineff-item__detour">+{f.detourKm} km</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other selected FIRs mini cards */}
      {otherFIRs.length > 0 && (
        <div className="hp-section">
          <div className="hp-section__title">Other Monitored FIRs</div>
          <div className="hp-mini-cards">
            {otherFIRs.map(({ id, name, health: h }) => (
              <div key={id} className="hp-mini-card">
                <span className="hp-mini-card__id">{name || id}</span>
                {h ? (
                  <span className="hp-mini-card__chi" style={{ color: chiColor(h.chi) }}>
                    {h.chi}
                  </span>
                ) : (
                  <span className="hp-mini-card__chi hp-mini-card__chi--loading">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
