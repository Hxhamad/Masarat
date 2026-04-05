import { useState } from 'react';
import { Search, Sun, Moon, Radar, Layers } from 'lucide-react';
import { useFilterStore } from '../../stores/filterStore';
import { useUIStore } from '../../stores/uiStore';
import LayerPanel from '../LayerPanel/LayerPanel';
import './Header.css';

export default function Header() {
  const { searchQuery, setSearchQuery } = useFilterStore();
  const { theme, toggleTheme } = useUIStore();
  const [layerPanelOpen, setLayerPanelOpen] = useState(false);

  return (
    <header className="header">
      <div className="header__brand">
        <Radar size={20} color="var(--accent)" />
        <span className="header__logo">MASARAT</span>
        <div className="header__divider" />
        <span className="header__subtitle">ADS-B Monitor</span>
      </div>

      <div className="header__actions">
        <div className="header__search">
          <Search size={14} className="header__search-icon" />
          <input
            className="header__search-input"
            type="text"
            aria-label="Search by callsign, ICAO code, or registration"
            placeholder="Search callsign, ICAO, reg..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <button className="header__btn" onClick={() => setLayerPanelOpen(true)} aria-label="Toggle map layers">
          <Layers size={16} />
        </button>

        <button className="header__btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      <LayerPanel open={layerPanelOpen} onClose={() => setLayerPanelOpen(false)} />
    </header>
  );
}
