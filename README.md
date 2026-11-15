# Lunar Landing Site Planner Blueprint

## System Overview

A zero-build, dependency-free static web application (`index.html`, `style.css`, `app.js`) paired with offline Python dataset generators (`tools/`) and precomputed JavaScript data bundles (`data/`). Given a lunar landing site (one of 20 curated sites or custom latitude/longitude coordinates), a UTC start time, a window length (`1`–`365` days), and a horizon model (`lola`, `lola15`, `flat15`, or `flat`), the application evaluates solar illumination (power) and Earth visibility (direct-to-Earth communications) using topocentric lunar ephemerides from JPL Horizons (`coord@301`) and 360-degree terrain horizon masks raymarched from NASA Moon Trek LRO LOLA DEM grids.

## Local Interface & Invariants

### Root Application (`index.html`, `style.css`, `app.js`)

- **DOM Entry Points (`index.html`)**:
  - `#splash` / `#splashVideo` / `#splashSkip`: Full-screen Moon video intro overlay (`assets/moon.mp4`, auto-dismisses after 15 s, on video end/error, or on click/skip).
  - `#gate` / `#controls`: Scenario configuration bar (`#siteSelect`, `#customCoords`, `#latInput`, `#lonInput`, `#startInput`, `#durationSelect`, `#horizonSelect`, `#loadBtn`, `#compareBtn`, `#status`).
  - `#scenarioView`: Active scenario header (`#scenTitle`, `#scenMeta`), metrics grid (`#metrics`), four `<canvas>` charts (`#elevChart`, `#domeChart`, `#horizonChart`, `#windowsChart`), time scrubber (`#scrub`, `#playBtn`, `#nowBtn`, `#scrubTime`, `#scrubSun`, `#scrubEarth`, `#scrubNextSet`, `#scrubNextESet`), and external deep links (`#qmLink`, `#mtLink`, `#hzLink`).
  - `#compareView`: Multi-scenario comparison table (`#compareTable`), overlaid solar elevation chart (`#compareChart`), and `#clearCompare` button.
  - Script loading order: synchronously loads `data/horizons.js` (`window.__LSP_HORIZONS`) followed by `app.js`, plus an embedded preview instrumentation IIFE (`<script data-pplx-inline-edit>`).
- **Helpers & Math (`app.js`)**:
  - `[app.js:$]`, `[app.js:SUN_C]`, `[app.js:EARTH_C]`, `[app.js:HORIZON_C]`, `[app.js:PALETTE]`, `[app.js:MON]`, `[app.js:pad]`: DOM selector, color constants, month lookup map, and zero-padding helper.
  - `[app.js:fmtUTC]`, `[app.js:fmtDay]`, `[app.js:fmtCountdown]`: UTC timestamp and duration formatters.
  - `[app.js:lerpAz]`, `[app.js:interp]`, `[app.js:crop]`, `[app.js:crossings]`: Shortest-arc azimuth interpolation, linear time-series interpolation (`{t0, step, az, el}`), window slicing, and horizon-relative rise/set crossing solver.
- **State & Configuration (`app.js`)**:
  - `[app.js:SITES]`, `[app.js:CACHE_START]`, `[app.js:CACHE_END]`, `[app.js:R_MOON]`: Curated 20-site catalog, cache window (`2025-01-01T00:00:00Z` to `2029-01-01T00:00:00Z`), and mean lunar radius (`1737400` m).
  - `[app.js:seriesCache]`, `[app.js:horizonCache]`, `[app.js:current]`, `[app.js:compares]`, `[app.js:scrubT]`, `[app.js:playing]`: In-memory runtime state.
- **Data Loading & Ephemeris (`app.js`)**:
  - `[app.js:status]`, `[app.js:loadSeriesFile]`, `[app.js:populateSelect]`, `[app.js:getSeries]`, `[app.js:horizonsURL]`, `[app.js:isoHM]`, `[app.js:parseHorizons]`, `[app.js:liveFetch]`: Dual-path ephemeris loader (dynamic `<script src="data/{key}.js">` for cached scenarios vs. `fetch()` to JPL Horizons with CORS proxy fallback).
- **Terrain Horizon & GeoTIFF DEM (`app.js`)**:
  - `[app.js:horizonMode]`, `[app.js:horizonAt]`, `[app.js:horizonDistAt]`, `[app.js:horizonLabel]`: Active horizon mask evaluator (`lola`, `lola15`, `flat15`, `flat`) and circular 360° interpolation.
  - `[app.js:parseGeoTiffF32]`, `[app.js:sampleGeoTile]`, `[app.js:fetchLolaTile]`, `[app.js:fetchLiveHorizon]`, `[app.js:getHorizon]`: Client-side uncompressed Float32 GeoTIFF parser, bilinear sampler, and 360-azimuth raymarcher (`250 m..15 km` near-field, `16 km..90 km` far-field, `2 m` observer mast height).
- **Metrics, Charts & UI (`app.js`)**:
  - `[app.js:computeStats]`, `[app.js:renderScenario]`, `[app.js:projectLunar]`, `[app.js:updateLinks]`, `[app.js:renderMetrics]`: Duty-cycle metrics, rise/set countdowns, polar/global coordinate projection, and external map link-outs.
  - `[app.js:setupCanvas]`, `[app.js:niceYRange]`, `[app.js:timeTicks]`, `[app.js:drawElevChart]`, `[app.js:drawDome]`, `[app.js:drawHorizonChart]`, `[app.js:drawWindows]`, `[app.js:drawAll]`, `[app.js:renderScrubReadout]`: HiDPI HTML5 `<canvas>` renderers and scrub readout updater.
  - `[app.js:scrubFromSlider]`, `[app.js:setScrub]`, `[app.js:togglePlay]`, `[app.js:step]`: Interactive scrubber and 60-second `requestAnimationFrame` playback loop.
  - `[app.js:compareKey]`, `[app.js:addCompare]`, `[app.js:saveCompares]`, `[app.js:restoreCompares]`, `[app.js:ensureSeries]`, `[app.js:renderCompare]`: In-memory multi-scenario comparison (up to 6 scenarios; persistence functions are no-op stubs and `ensureSeries` is unused).
  - `[app.js:loadScenario]`, `[app.js:init]`, `[app.js:initSplash]`: Application bootstrap (`DOMContentLoaded` -> `init()`) that immediately loads `shack` (Shackleton crater rim) for 30 days from the current UTC hour.
- **Root Invariants & Side Effects**:
  - `loadScenario()` snaps start timestamps to whole UTC hours (`3600e3` ms) and requires `lat` in `[-90, 90]` and `lon` in `[-180, 360]`.
  - `<script data-pplx-inline-edit>` (`index.html:144-584`) listens for `message` events from an allowlisted parent frame (`INLINE_EDIT_PICK`, `INLINE_EDIT_SCROLL_*`, `INLINE_EDIT_CAPTURE_REQUEST`) when `window !== window.top`.

## Subdirectories & System Boundaries

- `data`: [`./data/README.md`](./data/README.md) — Precomputed JPL Horizons Sun/Earth ephemeris bundles (`window.__LSP_DATA`) and 360° LRO LOLA DEM horizon profiles (`window.__LSP_HORIZONS`) for 20 curated lunar sites.
- `tools`: [`./tools/README.md`](./tools/README.md) — Offline Python dataset generators (`generate.py`, `generate_horizons.py`) and legacy JSON-to-JS migration script (`to_js.py`).
- `assets`: Static media assets (`assets/moon.mp4` splash screen video).

## Global Invariants

- The 20 curated `SITES`, cache time bounds (`CACHE_START = 2025-01-01T00:00:00Z`, `CACHE_END = 2029-01-01T00:00:00Z`), hourly sampling step (`3600` seconds), mean lunar radius (`1737400` m), and observer mast height (`2.0` m) must stay synchronized across `app.js`, `tools/generate.py`, `tools/generate_horizons.py`, and `data/*.js`.
- Observer coordinates follow the JPL Horizons lunar geodetic frame (`coord@301`), with azimuth `0° = North`, `90° = East`; spatial projection switches between South Polar Stereographic (`lat <= -60°`), North Polar Stereographic (`lat >= 60°`), and Global Equirectangular (`-60° < lat < 60°`).
- Cached scenarios must remain operable directly via `file://` using `<script>` injection (`window.__LSP_DATA` and `window.__LSP_HORIZONS`) without requiring `fetch()`.

## Global Side Effects

- Dynamic `<script src="data/{key}.js">` injection into `document.head` and mutations to `window.__LSP_DATA` and `window.__LSP_HORIZONS`.
- Live browser `fetch()` calls to JPL Horizons (`https://ssd.jpl.nasa.gov/api/horizons.api`) and fallback third-party CORS relays (`https://r.jina.ai/`, `https://api.allorigins.win/`, `https://corsproxy.io/`), plus live GeoTIFF `fetch()` calls to NASA Moon Trek ArcGIS ImageServers (`https://trek.nasa.gov/moon/trekarcgis/rest/services/`).
- Outbound `window.top.postMessage` responses emitted by `<script data-pplx-inline-edit>` in `index.html` when embedded in an allowlisted parent iframe.

## System Verification

- Run: `<test-command>`

---

## Project Notes & Usage

Built for the NASA Space Apps Challenge — "Rapid Lunar Site Evaluation" / the CLPS mission-planning gap between raw ephemeris/mapping tools (QuickMap, Moon Trek, JPL Horizons) and fast, comparable scenario assessment.

### Features

- **20 curated sites**: Apollo 11–17, Chang'e 3/4/5, SLIM, Chandrayaan-3, Blue Ghost 1, IM-1 Odysseus, Luna 25 target, and polar CLPS & Artemis targets (Mons Mouton, Shackleton rim, Malapert Massif, Nobile Rim, Cabeus, Peary), plus custom latitude/longitude coordinates.
- **Date flexibility**: any start time (UTC, snapped to whole hours) and window from 1 day to 1 year (`1`, `7`, `15`, `30`, `60`, `90`, `180`, `365` days).
- **Terrain horizon models**: switchable between precomputed/live 360° LRO LOLA DEM terrain (`lola`), LRO LOLA DEM with a `1.5°` operational floor (`lola15`), flat `1.5°` mask (`flat15`), and ideal `0°` sphere (`flat`).
- **Sun & Earth position visualization**:
  - Elevation-vs-time chart (`#elevChart`) with terrain obstruction overlay,
  - Sky-dome polar plot (`#domeChart`) showing clear vs. ridge-blocked sky tracks,
  - 360° terrain horizon panorama (`#horizonChart`) with peak-ridge distance callout,
  - Operational-windows timeline (`#windowsChart`: Sun up / Earth up / Both),
  - Time scrubber + 60-second animation playback (`#playBtn`).
- **Key metrics**: current Sun/Earth elevation & azimuth, time to next sunset/Earthset (or sunrise/Earthrise), peak Sun elevation, % of window sunlit, longest continuous daylight, Earth elevation range, % Earth-visible, solar power proxy on a level panel (`sin(el)`), full-operations overlap (sunlit AND Earth-visible), and terrain horizon min/mean/max + LOLA elevation.
- **Scenario comparison**: add up to 6 site+date scenarios in-memory, compare them in `#compareTable`, and overlay solar elevation curves in `#compareChart`.
- **Link-outs**: deep links to LROC QuickMap, Moon Trek, and raw JPL Horizons ephemeris.

### How it works

On open, a short Moon animation splash plays (15 s max, click to skip), revealing the site-selection controls and scenario view (`shack` 30-day default loads immediately in the background).

Ephemerides come from the [JPL Horizons system](https://ssd.jpl.nasa.gov/horizons/): the observer is a topocentric geodetic site on the Moon (`coord@301`), and Horizons returns apparent azimuth/elevation of the Sun and Earth (`QUANTITIES='4'`, DE441 ephemerides, light-time and aberration corrected, airless). Terrain horizon profiles are raymarched from concentric near-field (`±16 km`) and far-field (`±96 km`) LRO LOLA DEM GeoTIFF grids served by NASA Moon Trek.

Two data paths are chosen automatically:

1. **Precomputed cache (fast, offline)** — hourly Sun/Earth az/el for all 20 curated sites (`2025-01-01` → `2029-01-01`) generated by `tools/generate.py` as `data/{sid}_{sun|earth}.js` (`window.__LSP_DATA`), plus 360° LRO LOLA horizon masks generated by `tools/generate_horizons.py` in `data/horizons.js` (`window.__LSP_HORIZONS`). Works even when opened directly via `file://`.
2. **Live fetch (custom coordinates or dates outside 2025–2029)** — the browser queries JPL Horizons directly with fallback to public CORS relays (`r.jina.ai`, `api.allorigins.win`, `corsproxy.io`), and fetches Float32 GeoTIFF patches directly from NASA Moon Trek ImageServers (`LRO_LOLA_DEM_*`) to raymarch a live 360° horizon profile (falling back to a flat `0°` horizon if unavailable).

### Run locally

Static site — no build step, no package dependencies, and no server-side code:

```bash
python3 -m http.server 8000   # or open index.html directly via file://
# open http://localhost:8000
```

### Regenerate the datasets

```bash
python3 tools/generate.py           # writes data/{sid}_{sun|earth}.js (skips existing files)
python3 tools/generate_horizons.py  # writes data/horizons.js
```

### Limitations

- Live-fetch CORS relays (`r.jina.ai`, `api.allorigins.win`, `corsproxy.io`) are third-party and rate-limited; the precomputed 2025–2029 cache for curated sites works offline.
- LRO LOLA DEM raymarching uses concentric `128×128` GeoTIFF patches (`±16 km` and `±96 km`) with a `2 m` mast height; sub-pixel micro-topography (boulders, small craters within ~250 m) is not resolved.
- Comparison scenarios are stored in memory only (`saveCompares`/`restoreCompares` are no-op stubs) and reset on page reload.
- No thermal analysis, articulated solar array tracking, relay-satellite coverage, or Earth-based ground-station scheduling.

### Files

- `index.html`, `style.css`, `app.js` — client-side web application (vanilla JS, HTML5 Canvas).
- `assets/moon.mp4` — splash animation sourced from the Canadian Space Agency Moon exploration page (`https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/`).
- `data/{sid}_{sun|earth}.js` — precomputed ephemerides (`window.__LSP_DATA`).
- `data/horizons.js` — precomputed 360° LRO LOLA DEM terrain horizon profiles (`window.__LSP_HORIZONS`).
- `tools/generate.py` — JPL Horizons ephemeris generator.
- `tools/generate_horizons.py` — NASA Moon Trek LRO LOLA DEM horizon profile generator.
- `tools/to_js.py` — legacy JSON-to-JS conversion script (contains an unresolved `dir`/`data_dir` `NameError`).
