import type { ADSBFlight, ReadsBAircraft, ReadsBResponse, OpenSkyResponse, OpenSkyStateVector } from '../types.js';

// ===== readsb v2 Normalizer (adsb.lol + airplanes.live) =====

function classifyAircraftType(ac: ReadsBAircraft): ADSBFlight['type'] {
  if (ac.alt_baro === 'ground' || ac.alt_baro === 0) return 'ground';
  if (ac.dbFlags && (ac.dbFlags & 1)) return 'military';
  // Heuristic: cargo carriers often have specific callsign prefixes
  const cs = (ac.flight || '').trim().toUpperCase();
  if (/^(FDX|UPS|GTI|CLX|BOX|ABW)/.test(cs)) return 'cargo';
  // Most remaining are airline; private jets are harder to classify without enrichment  
  if (ac.category && ac.category.startsWith('A') && parseInt(ac.category[1]) <= 1) return 'private';
  return 'airline';
}

function classifySource(ac: ReadsBAircraft): ADSBFlight['source'] {
  const t = ac.type || '';
  if (t.includes('mlat')) return 'mlat';
  if (t.includes('adsb') || t.includes('adsr') || t.includes('adsc')) return 'adsb';
  return 'other';
}

export function normalizeReadsB(response: ReadsBResponse): ADSBFlight[] {
  if (!response.ac || !Array.isArray(response.ac)) return [];
  
  const now = response.now || Date.now();
  const flights: ADSBFlight[] = [];

  for (const ac of response.ac) {
    // Skip aircraft without position
    if (ac.lat == null || ac.lon == null) continue;
    // Skip invalid hex
    if (!ac.hex || ac.hex.startsWith('~')) continue;

    const altBaro = ac.alt_baro;
    const altitude = altBaro === 'ground' ? 0 : (typeof altBaro === 'number' ? altBaro : 0);
    const isOnGround = altBaro === 'ground' || altitude === 0;

    // Build optional onboard-met from ReadsB fields
    const met: ADSBFlight['met'] =
      (ac.wd != null || ac.ws != null || ac.oat != null || ac.tat != null || ac.nav_qnh != null)
        ? {
            windDirectionDeg: ac.wd ?? undefined,
            windSpeedKt: ac.ws ?? undefined,
            oatC: ac.oat ?? undefined,
            tatC: ac.tat ?? undefined,
            qnhHpa: ac.nav_qnh ?? undefined,
          }
        : undefined;

    // Build optional nav quality — NIC/NACp/SIL/SDA left undefined
    // until a richer upstream source is added.
    const navQuality: ADSBFlight['navQuality'] = {
      positionSource: classifySource(ac),
      lastPositionAgeSec: ac.seen_pos ?? undefined,
    };

    flights.push({
      icao24: ac.hex.toLowerCase(),
      callsign: (ac.flight || '').trim(),
      registration: ac.r || '',
      aircraftType: ac.t || '',
      latitude: ac.lat,
      longitude: ac.lon,
      altitude,
      heading: ac.track ?? 0,
      groundSpeed: ac.gs ?? 0,
      verticalRate: ac.baro_rate ?? ac.geom_rate ?? 0,
      squawk: ac.squawk || '',
      source: classifySource(ac),
      category: ac.category || '',
      isOnGround,
      lastSeen: ac.seen ?? 0,
      timestamp: now,
      type: classifyAircraftType(ac),
      trail: [], // Trails populated from cache/DB
      navQuality,
      met,
    });
  }

  return flights;
}

// ===== OpenSky Normalizer (Fallback) =====

export function normalizeOpenSky(response: OpenSkyResponse): ADSBFlight[] {
  if (!response.states || !Array.isArray(response.states)) return [];

  const now = Date.now();
  const flights: ADSBFlight[] = [];

  for (const sv of response.states) {
    const [icao24, callsign, , , , lon, lat, baroAlt, onGround, velocity, track, vertRate, , , squawk, , posSource] = sv;

    // Skip without position
    if (lat == null || lon == null) continue;

    // Convert meters to feet (baro_altitude is in meters in OpenSky)
    const altitudeFt = baroAlt != null ? Math.round(baroAlt * 3.28084) : 0;
    // Convert m/s to knots
    const speedKt = velocity != null ? Math.round(velocity * 1.94384) : 0;
    // Convert m/s to ft/min
    const vRateFpm = vertRate != null ? Math.round(vertRate * 196.85) : 0;

    const source: ADSBFlight['source'] = posSource === 2 ? 'mlat' : posSource === 0 ? 'adsb' : 'other';

    flights.push({
      icao24: icao24.toLowerCase(),
      callsign: (callsign || '').trim(),
      registration: '',
      aircraftType: '',
      latitude: lat,
      longitude: lon,
      altitude: onGround ? 0 : altitudeFt,
      heading: track ?? 0,
      groundSpeed: speedKt,
      verticalRate: vRateFpm,
      squawk: squawk || '',
      source,
      category: '',
      isOnGround: onGround,
      lastSeen: 0,
      timestamp: now,
      type: onGround ? 'ground' : 'airline',
      trail: [],
    });
  }

  return flights;
}
