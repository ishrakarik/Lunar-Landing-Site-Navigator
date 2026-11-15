# ASTRA CARTO — Landing Page & Mission Planner UX Redesign

* **Author:** waseem
* **Date:** 2026-11-15

## Overview

**ASTRA CARTO** (*"Explore the Moon. Plan with Precision."*) is the visual and UX redesign of the existing NASA Space Apps Challenge Lunar Landing Site Planner (`index.html`, `style.css`, `app.js`). The application evaluates solar illumination, Earth direct-to-Earth visibility, local terrain obstruction, and overlapping operational windows across 20 curated lunar landing sites and custom coordinates using precomputed 2025–2029 JPL Horizons ephemerides, precomputed LRO LOLA DEM horizon masks, and optional live NASA/JPL web fetches.

The target users are mission analysts, students, educators, and non-specialist space enthusiasts exploring lunar landing trade-offs offline (`file://`) or on static hosting without build steps or external dependencies. The core value proposition of this redesign is replacing the auto-expiring splash gate and fragmented mission-control styling with two connected experiences:

1. A permanent, minimal, cinematic landing page powered by the existing `assets/moon.mp4` video and a single primary action (`Launch Mission Planner`).
2. A Refined Dark (deep navy, solar gold `#f2c14e`, Earth blue `#5aa9e6`) single-page Mission Planner workspace organized into five parts — **Mission Setup**, **Mission Overview**, **Visual Analysis**, **Sticky Mission Timeline**, and **Site Comparison** — with plain-English scientific tooltips and a return link to the landing page while preserving 100% of existing astronomical calculations, chart functionality, data contracts, in-memory scenario comparisons, and offline `file://` portability.

---

## Reviewer Status

All seven Goldfish brainstorming lenses inspected `index.html`, `style.css`, and `app.js` in fresh contexts against the anchored hypothesis:

| Reviewer | Lens / Persona Focus | Status |
| :--- | :--- | :--- |
| `egm-design` | System architecture, quota & resource economics | completed |
| `egm-codebase-details` | Observability, diagnostics & operational debuggability | completed |
| `egm-zoom-out` | Contrarian / YAGNI & code minimization | completed |
| `egm-comprehension` | UX ergonomics, cognitive friction & accessibility | completed |
| `egm-implementation-readiness` | Migration, backward compatibility & rollout safety | completed |
| `egm-structural` | Long-term maintainability & DOM/state structure | completed |
| `egm-inventive-catalyst` | Contradiction elimination & TRIZ transforms | completed |

---

## Proposed Direction & Architecture

### Scope 1: Independent Landing Page (`#splash`) & Return Navigation
* **Permanent View State**: Remove the `15000 ms` timeout (`app.js:1384`), click-anywhere dismissal (`app.js:1383`), and `video.onended = finish` (`app.js:1380`). Users enter the Mission Planner only by activating `"Launch Mission Planner"` (updating `#splashSkip`).
* **Looping Background & Video Failure Fallback**: Add `loop` to `#splashVideo` (`index.html:14`), plus a readability scrim behind foreground typography and `prefers-reduced-motion: reduce` support. Remove `video.onerror = finish` (`app.js:1381`) so a missing video or blocked autoplay never dismisses `#splash`; instead, reveal a deep-navy CSS/inline-SVG static lunar fallback backdrop while keeping `"Launch Mission Planner"` interactive and keyboard-focusable.
* **Non-Destructive View Toggle & Header Home Link**: Replace `splash.remove()` (`app.js:1377`) with reversible `[hidden]` view switching between `#splash` and the Mission Planner workspace. On launch, call `video.pause()` so background video decoding stops while canvases are active; include a subtle **ASTRA CARTO** logo/home control in the Mission Planner header so users can return to `#splash` (`video.play()` if available) without a page reload or loss of active `current` / `compares` in-memory state.
* **Minimal Content**: Display **ASTRA CARTO**, the tagline *"Explore the Moon. Plan with Precision."*, one concise product description, and `"Launch Mission Planner"`. Exclude extra marketing sections, feature grids, or multi-step onboarding copy.

### Scope 2: Mission Planner Workspace & Refined Dark Theme
* **Visual Language**: Deep navy primary canvas and tiered card/panel surfaces with crisp borders, gold (`#f2c14e`) for Solar telemetry/curves, blue (`#5aa9e6`) for Earth telemetry/curves, warm orange (`#e07a4f`) for LOLA terrain masks, and clean tabular-numeric typography in English only. Remove stale `#gate` prompt copy (`index.html:22`) that conflicts with initializing Shackleton Rim upon launch.
* **Synchronized Canvas Palette**: Read CSS custom properties from `:root` (`getComputedStyle(document.documentElement)`) inside `app.js` instead of hardcoding old slate hex strings (`#10151c`, `#2a3340`, `#3a4657`, `#232d3a`, `#55637a`, `#8b98a8`, `#4ecdc4`) inside Canvas 2D drawing routines (`app.js:11-12, 749-1128`).
* **Lazy Launch Initialization & Valid-Dimension Canvas Guard**: Do **not** call `loadScenario()` or run calculations while the user is on `#splash`. Instead, when the user clicks `"Launch Mission Planner"`:
  1. Reveal the Mission Planner workspace (`[hidden] = false`) and pause `#splashVideo`.
  2. Wait until the workspace layout is visible (`requestAnimationFrame`) with non-zero bounding boxes before drawing canvases (`setupCanvas()` guard against `W <= 0 || H <= 0` and `drawDome()` `R <= 0`).
  3. On first launch (`if (!current)`), initialize the default Shackleton Rim (`shack`) scenario via `loadScenario()`, loading its cached `data/*.js` ephemerides and `data/horizons.js` mask cleanly; on subsequent return visits from `#splash`, skip re-fetching and redraw (`drawAll()`, plus `renderCompare()` if populated) against the visible layout.
  4. Separate fetch `try/catch` from canvas rendering `try/catch` inside `loadScenario()` so layout issues never emit misleading JPL CORS error messages.
* **Five-Part Workspace Structure**:
  1. **Mission Setup**: Top workspace header (with subtle **ASTRA CARTO** return-to-landing logo/link) above `#controls`, housing `#siteSelect` (all 20 curated sites + Custom coordinates `#customCoords` [`#latInput`, `#lonInput`]), UTC `#startInput` (normalized for optional `HH:MM:SS` strings instead of brittle `slice` logic at `app.js:1314`), `#durationSelect`, `#horizonSelect`, `#loadBtn` (guarded against concurrent loads via monotonic request ID), and `#compareBtn` (showing confirmation and `N/6` status). Clearly note the `2025-01-01` to `2029-01-01 UTC` cached date envelope and distinguish immediate horizon-model re-rendering from `#loadBtn`-triggered scenario loads.
  2. **Mission Overview**: Active scenario heading (`#scenTitle`, `#scenMeta`, surfacing clear notice if a live LOLA DEM fetch fell back to `flat-fallback`) and all 9 existing metric cards in `#metrics` (`Sun elevation`, `Next sunset/sunrise`, `Peak Sun elevation`, `Sunlit %`, `Earth elevation`, `Earth visibility %`, `Solar power proxy`, `Sunlit AND Earth-visible %`, and `Local terrain horizon`).
  3. **Visual Analysis (`2+1+1` Permanently Expanded Full View)**: All four existing charts always visible inline with zero collapsible sections or view toggles:
     * **Top Row (`~65%` / `~35%`)**: `Elevation vs time` (`#elevChart`) alongside `Sky dome` (`#domeChart`) via CSS Grid (`grid-template-columns: minmax(0, 1.85fr) minmax(0, 1fr)` and `min-width: 0` on `.chartbox` cards so HiDPI backing stores do not prevent horizontal shrinking).
     * **Second Row (`100%`)**: `Local terrain horizon profile (360° LRO LOLA DEM)` (`#horizonChart`).
     * **Third Row (`100%`)**: `Operational windows over the selected date range` (`#windowsChart`).
     * **Responsive Tablet/Mobile Stack**: Transition cleanly from `2+1+1` to a single-column (`1+1+1+1`) layout below tablet width (`<= 960px`) so `#domeChart` corner legends and `belowNotes` (`app.js:935`) remain legible. Attach a `ResizeObserver` to chart wrappers to re-run `setupCanvas()` and chart redraws after layout changes.
  4. **Sticky / Docked Mission Timeline Bar**: Place `.scrubber` at the end of a sticky-scope container wrapping **Mission Overview** and **Visual Analysis**, styled with `position: sticky; bottom: 0; z-index: 20`, compact height (`~68–84px` desktop), and opaque/frosted navy backing. While scrolling through Overview and all 4 charts, `#scrub`, `#playBtn`, `#nowBtn`, `#scrubTime`, `#scrubSun`, `#scrubEarth`, `#scrubNextSet`, and `#scrubNextESet` remain accessible; upon reaching the bottom of Visual Analysis, the bar rests in flow above the active-site links and unsticks naturally before **Site Comparison**, never covering `#windowsChart` at rest or overlapping comparison rows. Set matching `scroll-padding-bottom` on the scrolling root and un-pin sticky behavior on short viewports (`<= 620px` height) or narrow mobile widths where a bottom bar would crowd charts.
  5. **Active-Site NASA Links & Site Comparison**:
     * Keep `.links` (`#qmLink`, `#mtLink`, `#hzLink`) in a compact, clearly labeled strip tied to the active mission scenario (`current`), positioned directly below **Visual Analysis** (below the resting `.scrubber` container) and above **Site Comparison** (`#compareView`), so external links remain accessible even when zero scenarios are compared (`#compareView.hidden = true`).
     * Preserve `#compareView` (`#compareTable`, `#compareChart`, `#clearCompare`) strictly **in-memory** (`saveCompares()` and `restoreCompares()` remain intentional no-ops, `app.js:1225-1227`), supporting up to 6 active-session scenarios without `localStorage`, storage exceptions, or `file://` issues, while explicitly displaying the active horizon model applied across table rows.

### Scope 4: Scientific Accessibility
* Preserve accurate English scientific terminology across all metrics, charts, and controls (`Solar Elevation`, `Earth Visibility`, `Azimuth`, `Solar Power Proxy (sin(elevation))`, `LRO LOLA DEM`).
* Add keyboard-focusable and hover/tap-friendly `ⓘ` trigger buttons (`.info-btn` scoped independently from global `button` CSS) on key metric cards, `#horizonSelect`, chart titles, and timeline telemetry terms, backed by persistent card shells (static labels/triggers built once; numeric `.v`/`.d` nodes updated via `textContent`) and a viewport-clamped popover layer outside `#metrics` and `.tablewrap` so tooltip open/focus state survives 60 FPS scrubbing and `▶ Play` animation without clipping.

---

## Analysis (Goldfish Multi-Lens Critique & Risk Mitigations)

### 1. Resolved Architecture Decisions from Goldfish Findings
* **In-Memory Scenario Comparisons Preserved**: Goldfish reviewers surfaced that `saveCompares()` / `restoreCompares()` (`app.js:1225-1227`) are currently empty stubs because sandboxed previews disallow web storage and `file://` storage behaves inconsistently. Attempting `localStorage` persistence would risk `SecurityError` in sandboxed iframes, `QuotaExceededError` on full ephemerides, or offline fetch failures in `ensureSeries()`. Keeping `compares` strictly in-memory honors the ground-truth codebase with zero new storage dependencies or `file://` risk.
* **Active-Site Links Decoupled from `#compareView`**: Because `#compareView` hides itself when `compares.length === 0` (`app.js:1243`), keeping `#qmLink`, `#mtLink`, and `#hzLink` outside `#compareView` ensures active-site NASA links remain visible immediately upon scenario load.
* **Launch-Time Scenario Loading Eliminates Hidden-Canvas `IndexSizeError`**: Deferring `loadScenario()` until `"Launch Mission Planner"` makes the workspace visible prevents `setupCanvas()` from returning `W = 0, H = 0` (`50×50` backing store with `drawDome()` computing negative radius `R = -26` and throwing `IndexSizeError`), eliminates false JPL CORS error messages behind `#splash`, and avoids running background calculations or unexpected live fetches while hovering on the landing page.

### 2. Contradiction Eliminations & Secondary Trade-offs (TRIZ Synthesis)
* **60 FPS Scrubbing Throughput vs. Persistent Accessible Tooltips (`ⓘ`)**:
  * *Contradiction*: Rebuilding `$("metrics").innerHTML` up to 60 times/sec in `renderMetrics()` (`app.js:692`) and running `computeStats()` twice per frame (`app.js:632, 1164`) destroys `ⓘ` hover/focus/popover state and wastes CPU across up to 8,760 samples.
  * *Resolution (`Segmentation + Preliminary Action + Extraction`)*: Construct the 9 card containers and static `ⓘ` buttons once per scenario/horizon change and mutate only cached `.v`, `.d`, and conditional card title `textContent` slots during scrubbing; precompute window-constant metrics once per scenario load/horizon switch and share the single per-frame lookup between `renderMetrics()` and `renderScrubReadout()`; render active tooltips in a persistent viewport-clamped popover outside `#metrics`.
  * *Secondary Trade-off*: Replaces a single `innerHTML` template string with explicit card-slot update logic and cache invalidation hooks on `loadScenario()` and `#horizonSelect` `change`.
* **Sticky Mission Timeline vs. Unobscured Charts & Dynamic Site Comparison Boundary**:
  * *Contradiction*: A mid-DOM `.scrubber` (`index.html:96-109`) cannot stick across `#horizonChart` and `#windowsChart`, whereas a permanent bottom overlay covers bottom chart axes unless bounded. Meanwhile `#compareView` is `hidden` when empty, invalidating JS scroll anchors tied to `#compareView`.
  * *Resolution (`Extraction + Segmentation + Dynamics`)*: Enclose `(Mission Overview + Visual Analysis)` in a parent wrapper whose last flow child is `.scrubber` with `position: sticky; bottom: 0` (using `overflow-x: clip`, never `overflow: hidden`, on ancestors); compact `.scrubber` into a low-profile control bar (`~68–84px` desktop) and un-stick dynamically on very short (`<= 620px`) or narrow mobile screens.
  * *Secondary Trade-off*: Compacting sticky readouts on narrow viewports condenses verbose terrain-ridge text in the bottom bar while retaining full detail text inside Mission Overview cards.
* **Permanent Landing Page vs. Video Failure Resilience & Hardware Resources**:
  * *Contradiction*: Removing timeouts and auto-dismissals keeps users trapped if `#splashVideo` fails unless cushioned, yet running a looping `<video>` behind live `<canvas>` playback wastes GPU/RAM.
  * *Resolution (`Segmentation + Inversion + Beforehand Cushioning`)*: Toggle `[hidden]` cleanly between `#splash` and the planner workspace, pause `#splashVideo` upon entry (resuming only when the user clicks the header home link to return), and detach `video.onerror` from `finish` so broken video swaps cleanly to a static dark-navy lunar backdrop inside `#splash`.
  * *Secondary Trade-off*: Keeping the paused `<video>` element in memory trades ~10–30 MB RAM for instant, reload-free return navigation to the landing page while preserving in-memory scenarios.

### 3. Additional Technical Risks Targeted During Design
* **Hardcoded Canvas Palette**: Unify canvas strokes/fills/backgrounds (`app.js:11-12, 749-1128`) with `:root` CSS custom properties so the Refined Dark navy theme extends cleanly inside every plot.
* **`datetime-local` Seconds Parsing (`app.js:1314`)**: Replace brittle `:00Z` index slicing with explicit UTC ISO parsing and clear feedback instead of silent fallback to `Date.now()` when seconds (`length === 19`) appear.
* **Async Load Cancellation & Playback Reset**: Cancel superseded `loadScenario()` fetches with a monotonic request ID (`AbortController`), pause active `playing`/`rafId` loops when loading a new scenario, surface explicit degraded-mode warnings when LOLA DEM falls back to `flat-fallback`, and show the `2025–2029 UTC` cache bounds clearly in setup and error text.

### Ideal Final Result (IFR)
**ASTRA CARTO** opens onto a standalone, zero-dependency lunar backdrop that handles video failures gracefully and never dismisses itself; clicking `"Launch Mission Planner"` enters an already laid-out deep-navy workspace where Shackleton Rim loads once from cache, 60 FPS scrubbing updates numeric card slots and all four `2+1+1` canvases smoothly without resetting tooltips or focus, the sticky timeline stays accessible across Overview/Analysis before resting cleanly above active NASA links and in-memory Site Comparison, and users can revisit the landing page via the header logo without losing session work.

---

## Critical Functional Preservation Requirements

1. **Sites & Custom Coordinates**: All 20 curated entries in `SITES` (`app.js:70-90`, preserving exact `SITES[].id`, `lon`, `lat`, `group`, `approx`) plus custom coordinate validation (`lat` `-90..90`, `lon` `-180..360`).
2. **Data & Global Contracts**: `data/horizons.js` (`window.__LSP_HORIZONS`), all 40 files in `data/<id>_{sun,earth}.js` (`window.__LSP_DATA`), `CACHE_START`..`CACHE_END` (`2025-01-01`..`2029-01-01`), classic `<script>` loading (`loadSeriesFile`), live JPL Horizons CORS-relay fallback (`liveFetch`), and NASA Trek LOLA GeoTIFF parsing (`fetchLiveHorizon` / `parseGeoTiffF32`).
3. **Horizon Models & Astronomical Math**: All 4 horizon modes (`lola`, `lola15`, `flat15`, `flat` on `#horizonSelect`), `interp()`, `crop()`, `crossings()`, `computeStats()`, `horizonAt()`, `horizonLabel()`, and `projectLunar()`.
4. **Metrics, Charts, In-Memory Comparisons & Links**: All 9 metrics in `#metrics`, all 4 scenario canvases (`#elevChart`, `#domeChart`, `#horizonChart`, `#windowsChart`) plus `#compareChart`, timeline playback (`togglePlay()`, 60 s full-window sweep), `#nowBtn`, `#scrub`, up to 6 in-memory scenario rows in `#compareTable` + `#clearCompare`, and active-site NASA links (`#qmLink`, `#mtLink`, `#hzLink`).
5. **Existing DOM IDs, Offline `file://` & Preview Compatibility**: Preserve existing control/output IDs (or cleanly alias `#gate` / `#splashSkip`), inline `data:image/svg+xml` favicon, clean relative paths without `?v=` query strings, zero external CDNs/fonts/packages/ES modules, and `<script data-pplx-inline-edit>` (`index.html:144-584`).

---

## Goals vs. Non-Goals

### In-Scope Goals
* Transform `#splash` into a permanent, looping-video landing page with **ASTRA CARTO** branding, tagline *"Explore the Moon. Plan with Precision."*, short product description, `"Launch Mission Planner"` CTA, static video-error fallback, and reload-free return navigation from the Mission Planner header.
* Defer Shackleton Rim scenario loading (`loadScenario()`) and canvas drawing until after `"Launch Mission Planner"` reveals the visible Mission Planner layout, with zero `50×50` / `IndexSizeError` hidden-canvas defects.
* Apply a Refined Dark theme (deep navy surfaces, gold Sun `#f2c14e`, blue Earth `#5aa9e6`, synchronized across CSS and Canvas 2D) across a 5-part workspace.
* Keep all 4 charts permanently visible and expanded (`Full View` only) in a `2+1+1` desktop grid transitioning to single-column below tablet width (`<= 960px`), monitored by `ResizeObserver`.
* Dock the compact Sticky Mission Timeline Bar across Mission Overview + Visual Analysis, resting cleanly above active-site NASA links and strictly in-memory Site Comparison.
* Add keyboard/hover/tap accessible `ⓘ` scientific glossary tooltips backed by persistent card DOM shells and shared `computeStats()` output.

### Out-of-Scope Non-Goals
* Introducing `localStorage`, `sessionStorage`, IndexedDB, or any persistent browser storage for scenario comparisons (`saveCompares()` and `restoreCompares()` remain no-ops).
* Preloading Shackleton Rim or running astronomical calculations while idle on the landing page.
* Adding a Compact View, collapsible chart accordions, or view-mode switches.
* Modifying astronomical formulas, planetary ephemeris datasets (`data/*`), Python tools (`tools/*`), horizon calculations, or live JPL/Trek query parameters.
* Adding marketing sections, accounts, external CDN fonts/icons, npm dependencies, or ES module imports that break `file://`.
* Changing the English-only interface policy.

---

## Alternatives Weighed

* **Compact View with Collapsible Chart Sections + View-Mode Toggle**: Rejected by author: all four scientific charts belong visible together for immediate visual correlation without extra expansion clicks, and eliminating collapsed chart containers avoids hidden-canvas dimension errors.
* **Static In-Flow Mission Timeline Below Charts**: Rejected by author: placing the timeline statically below stacked charts pushes **Mission Overview** and the top charts out of view during scrubbing and playback.
* **Strict `1+1+1+1` Single-Column Desktop Chart Stack**: Rejected by author: giving polar `#domeChart` a full desktop row creates wide empty margins around a circular plot and unnecessarily increases page height compared to pairing `#elevChart` (`~65%`) with `#domeChart` (`~35%`).
* **Auto-Dismissing Splash Screen (`15s` / Click-Anywhere / `video.onended` / `video.onerror`)**: Rejected by author: prevents **ASTRA CARTO** from serving as an intentional landing page and causes broken video files or timers to exit unexpectedly before user intent.
* **Adding `localStorage` Scenario Comparison Persistence**: Rejected by author: current comparisons are intentionally in-memory only (`app.js:1225-1227`); adding web storage introduces sandboxed iframe `SecurityError` risks, quota issues, stale re-hydration network dependencies, and inconsistent `file://` behavior without user need.
* **Placing Active-Site NASA Links Inside `#compareView`**: Rejected by author: `#compareView` stays hidden until a scenario is added to comparison (`app.js:1243`), and QuickMap / Moon Trek / JPL Horizons links describe the active mission scenario rather than comparison mode.
* **Eager Background Loading on the Landing Page**: Rejected by author: deferred loading until clicking `"Launch Mission Planner"` guarantees valid visible DOM dimensions before canvas sizing, prevents idle background compute, and ensures hidden-layout math cannot trigger misleading CORS error banners.

---

## Key Decisions & Staging for Next Steps

All major product and architectural decisions are locked in and ready to carry directly into `/egm-draft`:

1. **Identity & Landing Page Flow**: Permanent **ASTRA CARTO** landing page (*"Explore the Moon. Plan with Precision."*) with looping `moon.mp4` + static fallback; enters planner solely via `"Launch Mission Planner"`; pauses video on entry; provides subtle header brand/home link for reload-free return preserving in-memory session state.
2. **Deferred Boot & Canvas Safety**: No scenario preload while on landing page; clicking `"Launch Mission Planner"` reveals workspace first, checks/waits for valid layout geometry, initializes default Shackleton Rim (`shack`) cleanly via cached data loaders, and runs `drawAll()`.
3. **Charts & Workspace Structure**: Refined Dark deep-navy theme unified across CSS and Canvas 2D; **Full View only** in a responsive **`2+1+1`** desktop grid (`<= 960px` single-column fallback); compact **Sticky / Docked Mission Timeline Bar** spanning Overview + Analysis and stopping before active NASA links and `#compareView`.
4. **In-Memory Comparisons & Persistent Scientific Tooltips**: Strict in-memory `compares` (zero `localStorage`); active NASA links (`#qmLink`, `#mtLink`, `#hzLink`) directly below Visual Analysis; persistent card DOM shells with `textContent` scrub updates and viewport-clamped `ⓘ` popovers preserving hover/focus during 60 FPS playback.
