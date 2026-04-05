import { useHealthStore } from '../../stores/healthStore';
import { useFilterStore } from '../../stores/filterStore';
import './ViewTabs.css';

const defaultTabs = [
  { id: 'flights' as const, label: 'Flights' },
  { id: 'health' as const, label: 'FIR Health' },
  { id: 'leaderboard' as const, label: 'Leaderboard' },
];

export default function ViewTabs() {
  const aircraftScope = useFilterStore((s) => s.aircraftScope);
  const viewMode = useHealthStore((s) => s.viewMode);
  const setViewMode = useHealthStore((s) => s.setViewMode);
  const tabs = aircraftScope === 'all' ? defaultTabs.slice(0, 1) : defaultTabs;

  return (
    <div className="view-tabs" role="tablist" aria-label="View mode">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={viewMode === t.id}
          className={`view-tabs__tab ${viewMode === t.id ? 'view-tabs__tab--active' : ''}`}
          onClick={() => setViewMode(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
