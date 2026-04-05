import './Legend.css';

const items = [
  { label: 'Airline', color: 'var(--flight-airline)' },
  { label: 'Private', color: 'var(--flight-private)' },
  { label: 'Cargo', color: 'var(--flight-cargo)' },
  { label: 'Military', color: 'var(--flight-military)' },
  { label: 'Ground', color: 'var(--flight-ground)' },
  { label: 'Heli', color: 'var(--flight-helicopter)' },
];

export default function Legend() {
  return (
    <div className="legend-bar">
      {items.map((item) => (
        <div key={item.label} className="legend-bar__item">
          <span className="legend-bar__dot" style={{ background: item.color }} />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
