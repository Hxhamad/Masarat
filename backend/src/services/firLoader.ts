/**
 * FIR GeoJSON Loader
 *
 * Fetches global FIR boundaries from open-source GeoJSON and precomputes
 * bounding boxes for fast coarse filtering.
 */

import * as turf from '@turf/turf';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FeatureCollection } from 'geojson';
import type { FIRFeature, FIREntry, FIRBounds } from '../types/fir.js';

interface FIRFileMetadata {
  airspaceType?: string;
  source?: string;
}

type FIRFile = FeatureCollection & { metadata?: FIRFileMetadata };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let firEntries: Map<string, FIREntry> = new Map();
let loaded = false;

// Local bundled FIR file (same one used by the frontend)
const LOCAL_FIR_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'data', 'firs.geojson');

const REMOTE_FIR_SOURCES = [
  'https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson',
];

const MIN_FIR_FEATURES = 50;
const MIN_FIR_COUNTRIES = 30;
const REQUIRED_COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Brazil',
  'Japan',
];

function computeBounds(feature: FIRFeature): FIRBounds {
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(feature);
  return { minLat, maxLat, minLng, maxLng };
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function resolveCountryName(value: unknown): string {
  const raw = safeString(value);
  if (!raw) return '';

  const normalized = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (normalized.length === 2) {
    try {
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      const name = regionNames.of(normalized);
      if (safeString(name)) return String(name);
    } catch {
      // Keep original value when region lookup is unavailable.
    }
  }

  return raw;
}

/** Reject non-FIR entries like LOCAL ATS units */
function isTrueFIR(name: string): boolean {
  const upper = name.toUpperCase();
  return !upper.includes('LOCAL ATS') && !upper.includes('LOCAL ADVISORY');
}

/** Normalise heterogeneous GeoJSON property names into our standard FIRProperties. */
function normalizeProperties(props: Record<string, unknown>): { id: string; name: string; country: string } {
  const id = safeString(props.id ?? props.ICAOCODE ?? props.icao ?? props.FIRname);
  const name = safeString(props.name ?? props.FIRname ?? props.NAME ?? id);
  const country = resolveCountryName(props.country ?? props.Country ?? props.STATE);
  return { id, name, country };
}

function hasVerifiedFIRMetadata(raw: FIRFile): boolean {
  return String(raw.metadata?.airspaceType ?? '').trim().toUpperCase() === 'FIR';
}

export async function loadFIRData(): Promise<void> {
  // Try local file first
  try {
    const raw = readFileSync(LOCAL_FIR_PATH, 'utf-8');
    const geojson = JSON.parse(raw) as FIRFile;
    if (!hasVerifiedFIRMetadata(geojson)) {
      throw new Error('Local FIR artifact is missing FIR verification metadata');
    }
    if (geojson.features && Array.isArray(geojson.features)) {
      parseFIRCollection(geojson);
      if (firEntries.size > 0) {
        const countries = new Set(Array.from(firEntries.values()).map((e) => e.feature.properties.country).filter(Boolean));
        const hasRequiredCountries = REQUIRED_COUNTRIES.every((country) => countries.has(country));
        if (firEntries.size < MIN_FIR_FEATURES || countries.size < MIN_FIR_COUNTRIES || !hasRequiredCountries) {
          const missing = REQUIRED_COUNTRIES.filter((c) => !countries.has(c));
          console.warn(
            `[fir] Local FIR artifact rejected: ${firEntries.size} features, ${countries.size} countries (need ${MIN_FIR_FEATURES}+ features, ${MIN_FIR_COUNTRIES}+ countries)` +
            (missing.length > 0 ? ` — missing: ${missing.join(', ')}` : ''),
          );
          firEntries = new Map();
        } else {
          loaded = true;
          console.log(`[fir] Loaded ${firEntries.size} FIR boundaries from local file`);
          return;
        }
      }
    }
  } catch (err) {
    console.warn(`[fir] Local FIR file unavailable or unverified, trying remote:`, (err as Error).message);
  }

  // Fallback to remote
  for (const url of REMOTE_FIR_SOURCES) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const geojson = (await res.json()) as FeatureCollection;

      if (!geojson.features || !Array.isArray(geojson.features)) {
        throw new Error('Invalid GeoJSON: no features array');
      }

      parseFIRCollectionCountryFallback(geojson);

      if (firEntries.size > 0) {
        loaded = true;
        console.warn(`[fir] FIR dataset unavailable; loaded ${firEntries.size} country-based fallback regions from ${url}`);
        return;
      }
    } catch (err) {
      console.warn(`[fir] Failed to load from ${url}:`, (err as Error).message);
    }
  }

  console.error('[fir] Could not load FIR data from any source');
}

function parseFIRCollection(geojson: FeatureCollection): void {
  firEntries = new Map();
  for (const raw of geojson.features) {
    const geomType = raw.geometry?.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') continue;
    const feature = raw as FIRFeature;
    const { id, name, country } = normalizeProperties(feature.properties as unknown as Record<string, unknown>);
    if (!id) continue;
    if (!isTrueFIR(name)) continue;

    feature.properties = { id, name, country };
    const bounds = computeBounds(feature);
    firEntries.set(id, { feature, bounds });
  }
}

/** Parse country-boundaries GeoJSON as coarse FIR regions (fallback) */
function parseFIRCollectionCountryFallback(geojson: FeatureCollection): void {
  firEntries = new Map();
  for (const raw of geojson.features) {
    const geomType = raw.geometry?.type;
    if (geomType !== 'Polygon' && geomType !== 'MultiPolygon') continue;

    const props = (raw.properties ?? {}) as Record<string, unknown>;
    const country = safeString(props.name ?? props.admin ?? props.name_long);
    if (!country) continue;

    const code = safeString(props.iso_a2 ?? props.postal ?? props.iso_a3 ?? `C${firEntries.size}`).toUpperCase();
    const id = `${code}-FIR`;
    const name = `${country} FIR`;

    const feature = raw as FIRFeature;
    feature.properties = { id, name, country };
    const bounds = computeBounds(feature);
    firEntries.set(id, { feature, bounds });
  }
}

export function isFIRDataLoaded(): boolean {
  return loaded;
}

export function getFIREntry(firId: string): FIREntry | undefined {
  return firEntries.get(firId);
}

export function getAllFIREntries(): FIREntry[] {
  return Array.from(firEntries.values());
}

export function getFIRFeature(firId: string): FIRFeature | undefined {
  return firEntries.get(firId)?.feature;
}

export function getAllFIRIds(): string[] {
  return Array.from(firEntries.keys());
}
