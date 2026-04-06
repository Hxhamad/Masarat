import { useMemo } from 'react';
import { Activity, Globe2, Layers, Moon, Search, Sun } from 'lucide-react';
import { useFilterStore } from '../../stores/filterStore';
import { useFIRStore } from '../../stores/firStore';
import { useUIStore } from '../../stores/uiStore';
import { useVisibleFlightStore } from '../../stores/visibleFlightStore';
import './Header.css';

export default function Header() {
  const { aircraftScope, searchQuery, setSearchQuery } = useFilterStore();
  const { theme, toggleTheme, setLayerPanelOpen } = useUIStore();
  const selectedFIRs = useFIRStore((s) => s.selectedFIRs);
  const visibleCount = useVisibleFlightStore((s) => s.visibleFlights.length);

  const scopeLabel = useMemo(() => {
    if (aircraftScope === 'all') {
      return 'All Airspace';
    }

    if (selectedFIRs.length === 0) {
      return 'Focused FIR View';
    }

    return `${selectedFIRs.length} FIR${selectedFIRs.length > 1 ? 's' : ''} Active`;
  }, [aircraftScope, selectedFIRs.length]);

  return (
    <header className="header">
      <div className="header__brand">
        <span className="header__logo">Masarat</span>
      </div>

      <div className="header__meta" aria-label="Session summary">
        <div className="header__meta-card">
          <span className="header__meta-label">Scope</span>
          <span className="header__meta-value">
            <Globe2 size={14} />
            {scopeLabel}
          </span>
        </div>
        <div className="header__meta-card">
          <span className="header__meta-label">Visible Tracks</span>
          <span className="header__meta-value">
            <Activity size={14} />
            {visibleCount.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="header__actions">
        <div className="header__search">
          <Search size={14} className="header__search-icon" />
          <input
            className="header__search-input"
            type="text"
            aria-label="Search by callsign, ICAO code, or registration"
            placeholder="Search callsign, ICAO, registration, or type"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button className="header__btn header__btn--primary" onClick={() => setLayerPanelOpen(true)} aria-label="Open map layers">
          <Layers size={16} />
          <span>Layers</span>
        </button>

        <button className="header__btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  );
}
