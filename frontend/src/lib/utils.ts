import type { ADSBFlight } from '../types/flight';

/** Convert heading degrees to a CSS rotation for the aircraft icon */
export function headingToRotation(heading: number): string {
  return `rotate(${heading}deg)`;
}

/** Format altitude with thousands separator */
export function formatAltitude(alt: number): string {
  if (alt === 0) return 'GND';
  return `FL${Math.round(alt / 100)}`;
}

/** Format speed in knots */
export function formatSpeed(speed: number): string {
  return `${Math.round(speed)} kt`;
}

/** Short callsign display */
export function displayCallsign(flight: ADSBFlight): string {
  return flight.callsign || flight.icao24.toUpperCase();
}

/** Get CSS color variable for flight type */
export function flightTypeColor(type: ADSBFlight['type']): string {
  switch (type) {
    case 'airline': return 'var(--flight-airline)';
    case 'private': return 'var(--flight-private)';
    case 'cargo': return 'var(--flight-cargo)';
    case 'military': return 'var(--flight-military)';
    case 'ground': return 'var(--flight-ground)';
    case 'helicopter': return 'var(--flight-helicopter)';
    default: return 'var(--flight-airline)';
  }
}

/** Source badge color */
export function sourceColor(source: ADSBFlight['source']): string {
  switch (source) {
    case 'adsb': return 'var(--source-adsb)';
    case 'mlat': return 'var(--source-mlat)';
    default: return 'var(--source-other)';
  }
}

/** Time ago string */
export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}
