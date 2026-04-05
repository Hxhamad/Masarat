#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OPENAIP_API_URL = 'https://api.core.openaip.net/api/airspaces';
const DEFAULT_OUTPUT = 'frontend/public/data/firs.geojson';
const FIR_TYPE = 10;

function parseArgs(argv) {
  const args = {
    source: 'auto',
    input: null,
    output: DEFAULT_OUTPUT,
    limit: 200,
    maxPages: 250,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--source') {
      args.source = argv[index + 1] ?? args.source;
      index += 1;
    } else if (token === '--input') {
      args.input = argv[index + 1] ?? null;
      index += 1;
    } else if (token === '--output') {
      args.output = argv[index + 1] ?? args.output;
      index += 1;
    } else if (token === '--limit') {
      args.limit = Number(argv[index + 1] ?? args.limit);
      index += 1;
    } else if (token === '--max-pages') {
      args.maxPages = Number(argv[index + 1] ?? args.maxPages);
      index += 1;
    }
  }

  return args;
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isPolygonGeometry(geometry) {
  if (!geometry || typeof geometry !== 'object') return false;
  return geometry.type === 'Polygon' || geometry.type === 'MultiPolygon';
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
}

function featureTypeNumber(props) {
  const candidates = [props.type, props.airspaceType, props.categoryType];
  for (const candidate of candidates) {
    const num = Number(candidate);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function featureTypeText(props) {
  return [
    props.typeName,
    props.category,
    props.className,
    props.description,
    props.name,
  ]
    .map((value) => safeString(value).toLowerCase())
    .join(' ');
}

function isFIRFeature(feature) {
  const props = feature?.properties ?? {};
  const typeNumber = featureTypeNumber(props);
  if (typeNumber === FIR_TYPE) return true;

  const text = featureTypeText(props);
  return text.includes('flight information region') || /\bfir\b/.test(text);
}

function hashId(seed) {
  return createHash('sha1').update(seed).digest('hex').slice(0, 12).toUpperCase();
}

function resolveCountryName(value) {
  const raw = safeString(value);
  if (!raw) return '';

  const normalized = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (normalized.length === 2) {
    try {
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      const name = regionNames.of(normalized);
      if (safeString(name)) return String(name);
    } catch {
      // Ignore locale support issues and keep original value.
    }
  }

  return raw;
}

function normalizeFeature(rawFeature, index) {
  const props = rawFeature?.properties ?? {};
  const name =
    safeString(props.name) ||
    safeString(props.title) ||
    safeString(props.designator) ||
    safeString(props.identifier) ||
    `FIR ${index + 1}`;
  const countryCodeOrName =
    safeString(props.country) ||
    safeString(props.countryCode) ||
    safeString(props.isoCountry) ||
    safeString(props.state);
  const country = resolveCountryName(countryCodeOrName);

  const idCandidates = [
    props.id,
    props.icao,
    props.icaoCode,
    props.designator,
    props.identifier,
    props._id,
    rawFeature?.id,
  ];

  let id = '';
  for (const candidate of idCandidates) {
    const normalized = safeString(candidate).replace(/\s+/g, '').toUpperCase();
    if (normalized) {
      id = normalized;
      break;
    }
  }

  if (!id) {
    id = `FIR-${hashId(`${name}|${country}|${index}`)}`;
  }

  return {
    type: 'Feature',
    geometry: rawFeature.geometry,
    properties: {
      id,
      name,
      country,
    },
  };
}

function parseFeaturesFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
        return parsed.features;
      }
      if (parsed?.type === 'Feature') return [parsed];
    } catch {
      // Fall through to NDJSON parsing.
    }
  }

  const features = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const chunk = line.trim();
    if (!chunk) continue;
    try {
      const parsed = JSON.parse(chunk);
      if (parsed?.type === 'Feature') features.push(parsed);
    } catch {
      // Ignore malformed lines.
    }
  }

  return features;
}

async function loadFeaturesFromFile(inputPath) {
  const payload = await readFile(path.resolve(inputPath), 'utf-8');
  return parseFeaturesFromText(payload);
}

function extractAirspaceLinksFromHtml(html) {
  const hrefMatches = html.matchAll(/href="([^"]+)"/gi);
  const links = [];
  for (const match of hrefMatches) {
    const href = match[1].replace(/&amp;/g, '&');
    const lower = href.toLowerCase();
    const isSupportedAirspaceExport = /_asp\.(geojson|json|ndgeojson)(\?|$)/.test(lower);
    if (
      lower.includes('storage.googleapis.com') &&
      isSupportedAirspaceExport
    ) {
      links.push(href);
    }
  }

  return Array.from(new Set(links));
}

async function loadFeaturesFromExportsHtml(inputPath) {
  const html = await readFile(path.resolve(inputPath), 'utf-8');
  const links = extractAirspaceLinksFromHtml(html);
  if (links.length === 0) {
    throw new Error('No airspace export links found in the supplied HTML file');
  }

  const features = [];
  for (const [index, link] of links.entries()) {
    const response = await fetch(link);
    if (!response.ok) {
      console.warn(`[openAIP] Skipping export ${index + 1}/${links.length}: HTTP ${response.status}`);
      continue;
    }

    const payload = await response.text();
    const parsed = parseFeaturesFromText(payload);
    console.log(`[openAIP] Downloaded ${parsed.length} airspace features from export ${index + 1}/${links.length}`);
    features.push(...parsed);
  }

  return features;
}

async function loadFeaturesFromApi({ limit, maxPages }) {
  const apiKey = safeString(process.env.OPENAIP_API_KEY);
  if (!apiKey) {
    throw new Error('OPENAIP_API_KEY is required for API mode');
  }

  const features = [];
  let page = 1;
  let totalPages = Infinity;

  while (page <= totalPages && page <= maxPages) {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      type: String(FIR_TYPE),
    });
    const response = await fetch(`${OPENAIP_API_URL}?${params.toString()}`, {
      headers: {
        'x-openaip-api-key': apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed on page ${page}: HTTP ${response.status}`);
    }

    const json = await response.json();
    const items = toArray(json?.items);
    totalPages = Number(json?.totalPages ?? page) || page;
    console.log(`[openAIP] API page ${page}/${totalPages} -> ${items.length} airspaces`);

    for (const item of items) {
      if (!isPolygonGeometry(item?.geometry)) continue;
      features.push({
        type: 'Feature',
        geometry: item.geometry,
        properties: item,
      });
    }

    page += 1;
  }

  return features;
}

function buildCollection(rawFeatures) {
  const features = [];
  const seen = new Set();

  rawFeatures.forEach((feature, index) => {
    if (!isPolygonGeometry(feature?.geometry)) return;
    if (!isFIRFeature(feature)) return;

    const normalized = normalizeFeature(feature, index);

    // Filter out non-FIR entries (e.g. LOCAL ATS units that share type=10)
    const nameUpper = normalized.properties.name.toUpperCase();
    if (nameUpper.includes('LOCAL ATS') || nameUpper.includes('LOCAL ADVISORY')) return;

    const dedupeKey = `${normalized.properties.id}|${normalized.properties.name}`;
    if (seen.has(dedupeKey)) return;

    seen.add(dedupeKey);
    features.push(normalized);
  });

  const countries = new Set(features.map((f) => f.properties.country).filter(Boolean));
  console.log(`[openAIP] Built collection: ${features.length} FIR features, ${countries.size} countries`);

  return {
    type: 'FeatureCollection',
    metadata: {
      source: 'openAIP',
      airspaceType: 'FIR',
      generatedAt: new Date().toISOString(),
      featureCount: features.length,
      countryCount: countries.size,
    },
    features,
  };
}

async function writeCollection(outputPath, collection) {
  const target = path.resolve(outputPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(collection, null, 2)}\n`, 'utf-8');
  return target;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let rawFeatures = [];

  if (args.source === 'api') {
    rawFeatures = await loadFeaturesFromApi(args);
  } else if (args.source === 'file') {
    if (!args.input) throw new Error('--input is required in file mode');
    rawFeatures = await loadFeaturesFromFile(args.input);
  } else if (args.source === 'exports-html') {
    if (!args.input) throw new Error('--input is required in exports-html mode');
    rawFeatures = await loadFeaturesFromExportsHtml(args.input);
  } else {
    if (safeString(process.env.OPENAIP_API_KEY)) {
      rawFeatures = await loadFeaturesFromApi(args);
    } else if (args.input) {
      rawFeatures = args.input.toLowerCase().endsWith('.html')
        ? await loadFeaturesFromExportsHtml(args.input)
        : await loadFeaturesFromFile(args.input);
    } else {
      throw new Error('Provide OPENAIP_API_KEY or use --input with a downloaded Airspaces World file');
    }
  }

  const collection = buildCollection(rawFeatures);
  if (collection.features.length === 0) {
    throw new Error('No FIR features found. Use an authenticated API key or a real Airspaces World export filtered from openAIP.');
  }

  // Quality gate — matches runtime gates in firService.ts and firLoader.ts
  const MIN_FIR_FEATURES = 50;
  const MIN_FIR_COUNTRIES = 30;
  const REQUIRED_COUNTRIES = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Brazil', 'Japan'];

  const countries = new Set(collection.features.map((f) => f.properties.country).filter(Boolean));
  const missing = REQUIRED_COUNTRIES.filter((c) => !countries.has(c));

  if (collection.features.length < MIN_FIR_FEATURES) {
    console.error(`[openAIP] Quality gate FAILED: only ${collection.features.length} features (need ${MIN_FIR_FEATURES})`);
    process.exitCode = 1;
    return;
  }
  if (countries.size < MIN_FIR_COUNTRIES) {
    console.error(`[openAIP] Quality gate FAILED: only ${countries.size} countries (need ${MIN_FIR_COUNTRIES})`);
    process.exitCode = 1;
    return;
  }
  if (missing.length > 0) {
    console.error(`[openAIP] Quality gate FAILED: missing required countries: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  console.log(`[openAIP] Quality gate passed: ${collection.features.length} features, ${countries.size} countries`);

  const outputPath = await writeCollection(args.output, collection);
  console.log(`[openAIP] Wrote ${collection.features.length} FIR features to ${outputPath}`);
}

main().catch((error) => {
  console.error(`[openAIP] Import failed: ${error.message}`);
  process.exitCode = 1;
});