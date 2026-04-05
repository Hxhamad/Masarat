import { Trophy, Medal, AlertTriangle } from 'lucide-react';
import { useHealthStore } from '../../stores/healthStore';
import { useFIRHealth } from '../../hooks/useFIRHealth';
import './Leaderboard.css';

function chiColor(chi: number): string {
  if (chi >= 75) return 'var(--status-ok)';
  if (chi >= 50) return 'var(--status-warn)';
  return 'var(--status-error)';
}

function medalLabel(rank: number): React.ReactNode {
  if (rank === 1) return <Trophy size={14} color="var(--status-ok)" />;
  if (rank === 2) return <Medal size={14} color="var(--text-muted)" />;
  if (rank === 3) return <Medal size={14} color="#cd7f32" />;
  return `#${rank}`;
}

export default function Leaderboard() {
  const leaderboard = useHealthStore((s) => s.leaderboard);
  const loading = useHealthStore((s) => s.leaderboardLoading);
  const error = useHealthStore((s) => s.error);

  useFIRHealth();

  if (loading && leaderboard.length === 0) {
    return (
      <div className="leaderboard">
        <div className="lb-loading">Loading leaderboard…</div>
      </div>
    );
  }

  if (error && leaderboard.length === 0) {
    return (
      <div className="leaderboard">
        <div className="lb-error">{error}</div>
      </div>
    );
  }

  if (leaderboard.length === 0) {
    return (
      <div className="leaderboard">
        <div className="lb-empty">No FIR data available for comparison</div>
      </div>
    );
  }

  // Derived awards
  const mostEfficient = [...leaderboard].sort((a, b) => b.efficiencyScore - a.efficiencyScore)[0];
  const mostCongested = [...leaderboard].sort((a, b) => b.saturationPct - a.saturationPct)[0];

  return (
    <div className="leaderboard">
      {/* Awards strip */}
      <div className="lb-awards">
        {mostEfficient && (
          <div className="lb-award">
            <span className="lb-award__icon"><Trophy size={14} /></span>
            <span className="lb-award__title">Most Efficient</span>
            <span className="lb-award__fir">{mostEfficient.firName || mostEfficient.firId}</span>
            <span className="lb-award__value" style={{ color: 'var(--status-ok)' }}>
              {mostEfficient.efficiencyScore}%
            </span>
          </div>
        )}
        {mostCongested && (
          <div className="lb-award">
            <span className="lb-award__icon"><AlertTriangle size={14} /></span>
            <span className="lb-award__title">Most Congested</span>
            <span className="lb-award__fir">{mostCongested.firName || mostCongested.firId}</span>
            <span className="lb-award__value" style={{ color: 'var(--status-warn)' }}>
              {mostCongested.saturationPct}%
            </span>
          </div>
        )}
      </div>

      {/* Ranking table */}
      <div className="lb-table">
        <div className="lb-table__header">
          <span className="lb-col lb-col--rank">Rank</span>
          <span className="lb-col lb-col--fir">FIR</span>
          <span className="lb-col lb-col--chi">CHI</span>
          <span className="lb-col lb-col--flights">Flights</span>
          <span className="lb-col lb-col--eff">Eff.</span>
          <span className="lb-col lb-col--sat">Sat.</span>
          <span className="lb-col lb-col--co2">CO₂</span>
        </div>
        <div className="lb-table__body">
          {leaderboard.map((entry) => (
            <div key={entry.firId} className="lb-row">
              <span className="lb-col lb-col--rank">{medalLabel(entry.rank)}</span>
              <span className="lb-col lb-col--fir">
                <span className="lb-fir__id">{entry.firName || entry.firId}</span>
              </span>
              <span className="lb-col lb-col--chi" style={{ color: chiColor(entry.chi) }}>
                {entry.chi}
              </span>
              <span className="lb-col lb-col--flights">{entry.flightCount}</span>
              <span className="lb-col lb-col--eff">{entry.efficiencyScore}%</span>
              <span className="lb-col lb-col--sat">{entry.saturationPct}%</span>
              <span className="lb-col lb-col--co2">{entry.co2EstimateKg.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
