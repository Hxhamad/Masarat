# MASARAT Platform Technical Architecture

This document describes the current implemented system inside `masarat-platform/` as built in the repository on 2026-04-02. It is an as-built reference, not a project proposal. The source of truth is the live frontend and backend code.

## 1. Repository Layout

```text
masarat-platform/
  package.json
  backend/
    data/
      masarat.db
    src/
      db/
        sqlite.ts
      routes/
        flights.ts
        stats.ts
      services/
        adsbAggregator.ts
        cache.ts
        normalizer.ts
      ws/
        flightHandler.ts
      index.ts
      types.ts
  frontend/
    package.json
    vite.config.ts
    src/
      App.tsx
      main.tsx
      components/
        ADSBPanel/
        FIRSelectionModal/
        Header/
        InfoPanel/
        Map/
        StatusBar/
      hooks/
        useFIRFilter.ts
        useFilteredFlights.ts
        useWebSocket.ts
      lib/
        firFilterWorker.ts
        firService.ts
        utils.ts
      stores/
        filterStore.ts
        firStore.ts
        flightStore.ts
        uiStore.ts
      styles/
        index.css
        variables.css
      types/
        fir.ts
        flight.ts
```

## 2. Runtime Topology

MASARAT is a two-process application during development:

- Frontend: Vite development server on port `5173`
- Backend: Fastify HTTP server on port `3001`
- WebSocket transport: native `ws` attached to the same backend HTTP server on path `/ws`
- Vite proxy:
  - `/api` -> `http://localhost:3001`
  - `/ws` -> `ws://localhost:3001`

The browser runs a single-screen React application. There is no client router. The entire application is gated behind the FIR startup modal until at least one FIR has been selected.

## 3. Frontend Architecture

### 3.1 Boot Sequence

`frontend/src/main.tsx` mounts `App` inside `React.StrictMode`.

`frontend/src/App.tsx` executes the following sequence on every boot:

1. Calls `useWebSocket()` immediately.
2. Reads `firSetupComplete` from `useFIRStore`.
3. If FIR setup is incomplete, renders `FIRSelectionModal` as the only visible UI.
4. If FIR setup is complete, renders the full shell in this order:
   - `Header`
   - `FlightMap`
   - `FIRLayer`
   - `Legend`
   - `ADSBPanel`
   - `InfoPanel`
   - `StatusBar`

This means network hydration starts before the user reaches the main map, but the map and side panels remain blocked until FIR selection is complete.

### 3.2 Visual Shell And Layout Tokens

Shared CSS tokens live in `frontend/src/styles/variables.css`.

Important layout constants:

- `--header-height: 48px`
- `--status-bar-height: 28px`
- `--info-panel-width: 360px`
- ADS-B sidebar width: `280px`
- FIR startup modal width: `520px` with `max-width: 95vw`
- FIR modal scroll list max height: `320px`

The map container is absolutely positioned between the fixed header and fixed status bar. The info panel slides in from the right edge and the ADS-B panel is fixed at the upper-left under the header.

### 3.3 Top-Level UI Components

#### Header

`Header` exposes two control surfaces:

- A global text filter bound to `filterStore.searchQuery`
- A theme toggle bound to `uiStore.theme`

The search placeholder is `Search callsign, ICAO, reg...`.

#### FIRSelectionModal

`FIRSelectionModal` is a startup gate and management surface for monitored FIRs.

Behavior:

- Loads FIR geometry through `firStore.loadFIRs()` on mount
- Limits selection to `1..6` FIRs
- Filters the displayed FIR list by `id`, `name`, or `country`
- Caps rendered search results to `80` entries
- Calls `completeFIRSetup()` to unlock the application

#### ADSBPanel

`ADSBPanel` is the left sidebar list of aircraft currently visible after both general filtering and FIR filtering.

Behavior:

- Computes visible aircraft from `useFilteredFlights()` and `useFIRFilter()`
- Sorts selected aircraft first, then by callsign
- Limits rendered rows to `200` entries for UI cost control
- Embeds `FIRPanel` as the FIR management strip at the top

#### InfoPanel

`InfoPanel` is a right-side detail drawer for the selected aircraft.

Sections:

- `Identification`
- `Position`
- `Data`

It opens only when both `uiStore.infoPanelOpen` is true and `selectedFlight` resolves to a live flight in `flightStore.flights`.

#### StatusBar

`StatusBar` is a bottom strip showing transport and ingest status:

- WebSocket connection state
- Active backend data source
- Selected FIR IDs
- Current aircraft count from `flightStore.flights.size`
- Messages per second from backend stats
- Last update timestamp

### 3.4 Frontend State Model

The frontend uses four Zustand stores.

#### `flightStore`

Primary state:

- `flights: Map<string, ADSBFlight>`
- `selectedFlight: string | null`
- `stats: AggregatorStats`
- `connectionStatus: 'connected' | 'connecting' | 'disconnected'`

Mutations:

- `setFlights(incoming)` merges incoming flights into the existing map by `icao24`
- `removeFlights(ids)` deletes aircraft from the map
- `selectFlight(icao24)` updates the selected target
- `setStats(stats)` replaces the stats object
- `setConnectionStatus(status)` updates transport state

#### `filterStore`

Primary state:

- `searchQuery`
- `altitudeRange`, default `[0, 60000]`
- `activeTypes: Set<'airline' | 'private' | 'cargo' | 'military' | 'ground' | 'helicopter'>`

Filtering is inclusive by default and resets back to all types enabled.

#### `firStore`

Primary state:

- `features: FIRFeature[]`
- `loading`
- `selectedFIRs: string[]`
- `firSetupComplete`
- `firSearchQuery`

Persistence:

- Local storage key: `masarat_selected_firs`
- Maximum saved FIR IDs: `6`

If persisted FIR IDs exist on boot, `firSetupComplete` starts as `true`.

#### `uiStore`

Primary state:

- `theme: 'dark' | 'light'`
- `infoPanelOpen: boolean`

The theme toggle writes the current theme to `document.documentElement.dataset.theme` through `setAttribute('data-theme', next)`.

### 3.5 Network Ingress And Synchronization

`useWebSocket()` is the frontend ingress orchestrator.

Bootstrap behavior:

1. Calls `/api/flights` and `/api/stats` in parallel.
2. If `/api/flights` returns a non-empty `ac` array, calls `setFlights()` and marks the snapshot as loaded.
3. Repeats bootstrap every `1500ms` until both of the following are true:
   - A snapshot has been loaded
   - The WebSocket is open

WebSocket behavior:

- URL is derived from `window.location.host`
- Uses `ws:` or `wss:` based on the current page protocol
- On open, sets connection state to `connected` and triggers another REST snapshot load
- On close, sets connection state to `disconnected` and reconnects after `3000ms`
- On message:
  - `flight-update` -> `setFlights(msg.data)`
  - `flight-remove` -> `removeFlights(msg.data)`
  - `stats` -> `setStats(msg.data)`

The store merge model means REST snapshots and WebSocket deltas converge into the same in-memory flight map.

### 3.6 Filtering Pipeline

The visible aircraft pipeline is two-stage:

1. `useFilteredFlights()` applies generic filters from `filterStore`
2. `useFIRFilter()` applies mandatory spatial FIR filtering

`useFilteredFlights()` filters by:

- Type membership
- Altitude range
- Search match against `icao24`, `callsign`, `registration`, or `aircraftType`

`useFIRFilter()` filters by geometry:

- No selected FIRs -> returns `[]`
- `<= 500` flights -> inline filtering on the main thread
- `> 500` flights -> offloads work to `firFilterWorker.ts`

The worker path sends a minimal payload of aircraft IDs and coordinates plus selected FIR geometry and bounds. A bounding-box pre-check runs before exact `booleanPointInPolygon` tests.

Important implementation detail: while the worker is computing the first result for a large set, the hook temporarily returns the full incoming flight list.

### 3.7 FIR Data Subsystem

FIR geometry is loaded by `frontend/src/lib/firService.ts`.

Primary remote source:

- `https://raw.githubusercontent.com/maiuswong/World-FIR-Boundaries/main/firs.json`

Fallback remote source:

- `https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson`

Behavior:

- Features are normalized into the local `FIRFeature` shape
- Bounding boxes are precomputed and cached in `boundsCache`
- Concurrent callers share one in-flight fetch promise
- If the FIR dataset fails, country polygons are converted into pseudo-FIRs using IDs like `FR-FIR`

This subsystem is therefore tolerant to upstream failure, but the fallback geometry is country-shaped rather than aviation-airspace-shaped.

### 3.8 Map Renderer

`FlightMap` is a raw Leaflet integration rather than a React-Leaflet wrapper.

Initialization:

- Map center: `[50, 10]`
- Initial zoom: `5`
- `preferCanvas: true`
- CARTO dark tile layer: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png`
- Custom zoom control at top-right
- Minimal attribution in the lower-left corner

Marker model:

- Aircraft are rendered as `L.marker` instances
- Marker visuals use `L.divIcon`
- Icon HTML is generated by `createAircraftSvg(color, heading, selected)`
- Selected aircraft get a pulsing class `aircraft-icon--selected`

Update loop:

- Existing markers are matched by `icao24`
- Position updates animate with `requestAnimationFrame` when the visible set has `<= 750` aircraft
- Animation duration is `3400ms`
- Tiny deltas under `0.0001` degrees skip animation and set the new position immediately
- Each update also rebuilds the `divIcon` for heading, color, and selection state
- Each marker carries a popup whose HTML is built from the live flight object

Trail model:

- A dedicated Leaflet `LayerGroup` holds the selected-flight trail polyline
- A trail is rendered only when the selected aircraft has at least two stored trail points

Auto-fit behavior:

- The map fits to the union of selected FIR bounds only once, on first load, using cached FIR bounding boxes

## 4. Backend Architecture

### 4.1 Server Boot Sequence

`backend/src/index.ts` performs the following sequence:

1. Initializes SQLite
2. Creates a Fastify app with CORS and compression
3. Registers REST routes
4. Registers `/api/health`
5. Starts listening on `0.0.0.0:3001`
6. Attaches the WebSocket server to the existing HTTP server
7. Starts the ADS-B aggregator
8. Starts hourly trail cleanup
9. Installs `SIGINT` and `SIGTERM` shutdown handlers

### 4.2 HTTP Surface

Current REST routes:

- `GET /api/health`
  - Returns `{ status: 'ok', timestamp }`

- `GET /api/flights`
  - With no query bounds: returns all cached flights
  - With `south`, `west`, `north`, `east`: returns cache-filtered flights in bounds
  - Shape: `{ ac: ADSBFlight[], total: number }`

- `GET /api/flights/:icao24`
  - Returns a single flight if present in the cache
  - Hydrates `trail` from SQLite using a limit of `60` points

- `GET /api/stats`
  - Returns aggregator stats plus:
    - `cacheSize`
    - `uptime`

### 4.3 WebSocket Surface

The WebSocket server is initialized at `/ws` using the native `ws` package.

Per-connection behavior:

- Immediately sends a `flight-update` containing `flightCache.getAll()`
- Immediately sends a `stats` message containing `getStats()`

Broadcast behavior:

- The aggregator registers a callback through `setUpdateCallback()`
- On each snapshot application, connected clients may receive:
  - `flight-update` with all updated flights from the current poll result
  - `flight-remove` with stale aircraft IDs removed from the cache
  - `stats` with current ingest metrics

No per-client geographic subscription exists in the current WebSocket layer. Every client receives the same update stream.

### 4.4 Aggregator Pipeline

`backend/src/services/adsbAggregator.ts` is the ingest controller.

Configured source order:

1. `adsb-lol`
   - URL: `https://api.adsb.lol/v2/lat/46/lon/2/dist/1200`
   - Rate limit: `4000ms`
2. `airplanes-live`
   - URL: `https://api.airplanes.live/v2/point/46/2/1200`
   - Rate limit: `4000ms`
3. `opensky`
   - URL: `https://opensky-network.org/api/states/all`
   - Rate limit: `12000ms`

Fetch behavior:

- Each request uses `fetch()` with an `AbortController`
- Timeout per request: `8000ms`
- On failure, the aggregator switches to the next source and retries after `1000ms`
- When running on a fallback source, it schedules a return to the primary source after `60000ms`

Startup behavior:

- `startAggregator()` primes the cache first using OpenSky
- The normal poll loop then begins with the primary configured source

Snapshot application:

- Merges new flights into `flightCache`
- Preserves existing `trail` arrays already attached to cached flights
- Inserts trail points only when position changed by more than `0.001` degrees in latitude or longitude
- Evicts stale aircraft from the cache
- Updates `AggregatorStats`
- Broadcasts updates through the registered WebSocket callback

### 4.5 Data Normalization Boundary

`backend/src/services/normalizer.ts` converts external feed formats into the internal `ADSBFlight` model.

Supported feed families:

- readsb v2 JSON from `adsb.lol` and `airplanes.live`
- OpenSky state vectors

Normalization rules:

- Aircraft without latitude or longitude are discarded
- Invalid readsb hex IDs beginning with `~` are discarded
- OpenSky altitude is converted from meters to feet
- OpenSky speed is converted from meters per second to knots
- OpenSky vertical rate is converted from meters per second to feet per minute

Classification heuristics:

- `ground` when barometric altitude is `ground` or `0`
- `military` when `dbFlags & 1`
- `cargo` when callsign prefix matches known cargo operators such as `FDX`, `UPS`, `GTI`, `CLX`, `BOX`, or `ABW`
- `private` for low-numbered `A*` categories in readsb
- otherwise defaults to `airline`

Source classification heuristics:

- `mlat` when source type includes `mlat`
- `adsb` when source type includes `adsb`, `adsr`, or `adsc`
- otherwise `other`

### 4.6 Live Flight Cache

`backend/src/services/cache.ts` implements the active flight cache.

Characteristics:

- Backed by `Map<string, CacheEntry>`
- TTL: `120000ms`
- Capacity: `50000` aircraft
- Eviction at capacity removes the oldest key in insertion order
- `getAll()` lazily drops expired entries during iteration
- `getByBounds()` performs a rectangular latitude/longitude filter on cached flights
- `evictStale()` removes flights whose `timestamp` is older than the configured age window

This is an insertion-ordered map, not a true LRU cache.

### 4.7 SQLite Trail Persistence

`backend/src/db/sqlite.ts` manages trail persistence in `backend/data/masarat.db`.

Configuration:

- `journal_mode = WAL`
- `synchronous = NORMAL`
- `cache_size = -64000`
- `temp_store = MEMORY`

Schema:

- Table: `trail_history`
- Columns:
  - `icao24`
  - `latitude`
  - `longitude`
  - `altitude`
  - `timestamp`

Indexes:

- `idx_trail_icao24`
- `idx_trail_timestamp`
- `idx_trail_icao24_ts`

Operational behavior:

- Inserts are executed through a prepared statement
- Trail history reads return the newest `60` points for a given aircraft
- Background cleanup runs hourly from server boot
- Default retention is `86400000ms` or 24 hours

## 5. Shared Contracts

The frontend and backend share the same normalized `ADSBFlight` concept. The frontend mirrors the backend event and stats types.

Important `ADSBFlight` fields:

- Identity: `icao24`, `callsign`, `registration`, `aircraftType`
- Position: `latitude`, `longitude`, `altitude`, `heading`
- Motion: `groundSpeed`, `verticalRate`
- State: `source`, `category`, `isOnGround`, `lastSeen`, `timestamp`
- Classification: `type`
- History: `trail: TrailPoint[]`

WebSocket event types:

- `flight-update`
- `flight-remove`
- `stats`

## 6. Operational Constants

The current implementation has the following hard-coded limits and thresholds:

- Frontend port: `5173`
- Backend port: `3001`
- FIR selection cap: `6`
- FIR modal display cap: `80`
- ADS-B list display cap: `200`
- FIR worker threshold: `500` flights
- Marker animation threshold: `750` visible flights
- Marker animation duration: `3400ms`
- Worker bootstrap retry cadence in `useWebSocket()`: `1500ms`
- WebSocket reconnect delay: `3000ms`
- Aggregator fetch timeout: `8000ms`
- Failover retry delay: `1000ms`
- Return-to-primary delay: `60000ms`
- Cache TTL: `120000ms`
- Cache max size: `50000`
- Trail query limit: `60`
- Trail retention: `24h`
- Trail cleanup interval: `1h`

## 7. Current Implementation Constraints

These are factual constraints of the current implementation, not future design goals.

- FIR filtering is client-side. The backend does not understand selected FIR polygons.
- The WebSocket layer broadcasts a shared global update stream to every connected client.
- The primary and secondary readsb feeds are both hard-coded around a Europe-centered query, not dynamically derived from the selected FIRs.
- The FIR subsystem can degrade to country-shaped fallback regions when the primary FIR dataset is unavailable.
- `FlightMap` is configured with `preferCanvas: true`, but aircraft are not drawn as Canvas primitives; they are DOM-backed Leaflet markers using `divIcon`.
- The backend exposes `GET /api/flights/:icao24` with trail hydration, but the current frontend does not call that endpoint.
- `@tanstack/react-query` and `leaflet.markercluster` are present in `frontend/package.json` but are not part of the active runtime path in the current source tree.
- The root `masarat-platform/package.json` has `concurrently` installed, but it does not yet define a unified multi-process development script.

## 8. End-To-End Data Flow

The current end-to-end flow is:

1. Backend boots Fastify, SQLite, WebSocket, and the aggregator.
2. Aggregator primes from OpenSky, then polls the configured source order.
3. Feed payloads are normalized into `ADSBFlight[]`.
4. Normalized flights are merged into the in-memory cache and persisted to trail history when position changes.
5. Backend broadcasts updated flights and stats over WebSocket.
6. Frontend bootstraps via `/api/flights` and `/api/stats` while the WebSocket comes up.
7. Incoming snapshots and deltas merge into `flightStore.flights`.
8. Generic UI filters run first.
9. FIR spatial filtering runs second.
10. `FlightMap`, `ADSBPanel`, `InfoPanel`, and `StatusBar` all render from the resulting store state.

This is the current implemented architecture.