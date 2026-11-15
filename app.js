/* ASTRA CARTO — Explore the Moon. Plan with Precision.
 * Sun/Earth azimuth+elevation for lunar landing sites, from JPL Horizons.
 * Vanilla JS, no dependencies. Cached hourly data 2025-2029 for curated sites;
 * live Horizons fetch (via CORS relay) for custom coordinates / other dates.
 */
"use strict";

/* ---------------- helpers ---------------- */

const $ = (id) => document.getElementById(id);
const SUN_C = "#f2c14e", EARTH_C = "#5aa9e6", HORIZON_C = "#e07a4f";
const PALETTE = ["#f2c14e", "#5aa9e6", "#e0774f", "#8bd450", "#c792ea", "#4ecdc4"];

function getThemeTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name) || "").trim() || fb;
  return {
    bgElevated: v("--bg-elevated", "#0b1220"),
    line: v("--line", "#233352"),
    lineSoft: v("--line-soft", "#19253d"),
    muted: v("--muted", "#8da2c0"),
    text: v("--text", "#e6edf7"),
    sun: v("--sun", SUN_C),
    earth: v("--earth", EARTH_C),
    horizon: v("--horizon", HORIZON_C),
    ok: v("--ok", "#7ec850"),
    accent: v("--accent", "#5aa9e6"),
  };
}
const MON = { Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11 };
const pad = (n) => String(n).padStart(2, "0");

function fmtUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
function fmtDay(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
}
function fmtCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return (d ? d + "d " : "") + h + "h " + m + "m";
}
function lerpAz(a, b, f) {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * f;
}
/* interpolate a series {t0,step,az[],el[]} at time t (unix sec) */
function interp(s, t) {
  const n = s.az.length;
  const i = (t - s.t0) / s.step;
  if (i < 0 || i > n - 1) return null;
  if (i >= n - 1) return { az: s.az[n-1], el: s.el[n-1] };
  const i0 = Math.floor(i), f = i - i0;
  return {
    az: lerpAz(s.az[i0], s.az[i0+1], f),
    el: s.el[i0] + (s.el[i0+1] - s.el[i0]) * f,
  };
}
function crop(s, t0s, t1s) {
  const i0 = Math.max(0, Math.floor((t0s - s.t0) / s.step));
  const i1 = Math.min(s.az.length - 1, Math.ceil((t1s - s.t0) / s.step));
  return { t0: s.t0 + i0 * s.step, step: s.step,
           az: s.az.slice(i0, i1 + 1), el: s.el.slice(i0, i1 + 1) };
}

const D2R = Math.PI / 180;

/* 0° lon -> +X axis, north pole -> +Y, 90°E -> -Z (matches equirectangular UVs). */
function latLonToVec(lat, lon, r = 1) {
  const la = lat * D2R, lo = lon * D2R;
  return {
    x:  r * Math.cos(la) * Math.cos(lo),
    y:  r * Math.sin(la),
    z: -r * Math.cos(la) * Math.sin(lo),
  };
}

function vecToLatLon(p) {
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, p.y / len))) / D2R,
    lon: Math.atan2(-p.z / len, p.x / len) / D2R,
  };
}

function siteBasis(lat, lon) {
  const la = lat * D2R, lo = lon * D2R;
  const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
  return {
    U: { x:  cl * co, y: sl, z: -cl * so },
    N: { x: -sl * co, y: cl, z:  sl * so },
    E: { x: -so,      y: 0,  z: -co },
  };
}

function localAzElToSelenographic(siteLat, siteLon, azDeg, elDeg) {
  const b = siteBasis(siteLat, siteLon);
  const az = azDeg * D2R, el = elDeg * D2R;
  const ce = Math.cos(el), se = Math.sin(el);
  const ca = Math.cos(az), sa = Math.sin(az);
  const x = ce * (ca * b.N.x + sa * b.E.x) + se * b.U.x;
  const y = ce * (ca * b.N.y + sa * b.E.y) + se * b.U.y;
  const z = ce * (ca * b.N.z + sa * b.E.z) + se * b.U.z;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

function selenographicToLocalAzEl(siteLat, siteLon, v) {
  const b = siteBasis(siteLat, siteLon);
  const uDot = Math.max(-1, Math.min(1, v.x * b.U.x + v.y * b.U.y + v.z * b.U.z));
  const nDot = v.x * b.N.x + v.y * b.N.y + v.z * b.N.z;
  const eDot = v.x * b.E.x + v.y * b.E.y + v.z * b.E.z;
  const az = ((Math.atan2(eDot, nDot) / D2R) % 360 + 360) % 360;
  const el = Math.asin(uDot) / D2R;
  return { az: Math.round(az * 100) / 100, el: Math.round(el * 1000) / 1000 };
}
/* horizon-relative elevation crossings: [{t (sec), up}] */
function crossings(s, horFn) {
  const out = [];
  const h = horFn || (() => 0);
  for (let i = 0; i < s.el.length - 1; i++) {
    const a = s.el[i] - h(s.az[i]);
    const b = s.el[i+1] - h(s.az[i+1]);
    if ((a > 0) !== (b > 0)) {
      const f = a / (a - b);
      out.push({ t: s.t0 + (i + f) * s.step, up: b > 0 });
    }
  }
  return out;
}

/* ---------------- state ---------------- */

/* Curated sites & cache bounds (embedded so the app works from file:// too). */
const SITES = [
  { id: "ap11",    name: "Apollo 11 - Mare Tranquillitatis",     group: "Apollo landing sites", lon: 23.47,  lat: 0.67,  approx: false },
  { id: "ap12",    name: "Apollo 12 - Oceanus Procellarum",      group: "Apollo landing sites", lon: -23.42, lat: -3.01, approx: false },
  { id: "ap14",    name: "Apollo 14 - Fra Mauro",                group: "Apollo landing sites", lon: -17.47, lat: -3.64, approx: false },
  { id: "ap15",    name: "Apollo 15 - Hadley-Apennine",          group: "Apollo landing sites", lon: 3.63,   lat: 26.13, approx: false },
  { id: "ap16",    name: "Apollo 16 - Descartes Highlands",      group: "Apollo landing sites", lon: 15.50,  lat: -8.97, approx: false },
  { id: "ap17",    name: "Apollo 17 - Taurus-Littrow",           group: "Apollo landing sites", lon: 30.77,  lat: 20.19, approx: false },
  { id: "ce3",     name: "Chang'e 3 - Mare Imbrium",             group: "Robotic landings",     lon: -19.35, lat: 44.12, approx: false },
  { id: "ce4",     name: "Chang'e 4 - Von Karman (far side)",    group: "Robotic landings",     lon: 177.99, lat: -45.46, approx: false },
  { id: "ce5",     name: "Chang'e 5 - Oceanus Procellarum",      group: "Robotic landings",     lon: 51.92,  lat: 43.06, approx: false },
  { id: "slim",    name: "SLIM - Shioli crater",                 group: "Robotic landings",     lon: 25.32,  lat: -13.16, approx: false },
  { id: "ch3",     name: "Chandrayaan-3 - Shiv Shakti Point",    group: "Robotic landings",     lon: -32.35, lat: -69.37, approx: false },
  { id: "bg1",     name: "Blue Ghost 1 - Mare Crisium",          group: "Robotic landings",     lon: 59.5,   lat: 18.1,  approx: true },
  { id: "im1",     name: "IM-1 Odysseus - Malapert A",           group: "Robotic landings",     lon: 1.4,    lat: -80.1, approx: true },
  { id: "l25",     name: "Luna 25 target - Boguslawsky",         group: "Robotic landings",     lon: 43.2,   lat: -69.8, approx: true },
  { id: "mm",      name: "Mons Mouton (VIPER/IM-2 region)",      group: "South pole targets",   lon: 30.91,  lat: -85.45, approx: true },
  { id: "shack",   name: "Shackleton crater rim (Artemis III candidate)", group: "South pole targets", lon: 129.4, lat: -89.55, approx: true },
  { id: "mmassif", name: "Malapert Massif",                       group: "South pole targets",   lon: -0.5,   lat: -86.0, approx: true },
  { id: "noble",   name: "Nobile Rim",                           group: "South pole targets",   lon: 31.1,   lat: -85.6, approx: true },
  { id: "cabeus",  name: "Cabeus crater",                        group: "South pole targets",   lon: -33.3,  lat: -84.9, approx: true },
  { id: "peary",   name: "Peary crater rim (north pole)",        group: "North pole target",    lon: 33.0,   lat: 88.6,  approx: true },
];
const CACHE_START = Date.parse("2025-01-01T00:00:00Z") / 1000;
const CACHE_END = Date.parse("2029-01-01T00:00:00Z") / 1000;

const seriesCache = {};        // site.id -> {sun, earth}
const horizonCache = {};       // key -> {elevM, el, distKm, source}
let current = null;            // active scenario
let compares = [];             // [{site, startMs, dur, series, horizon}] (in-memory only)
let scrubT = 0;                // current scrub time (ms)
let playing = false, rafId = null, playT0 = 0, scrubAtPlay = 0;
let loadSeq = 0;               // monotonic request counter for async scenario loads
let metricNodes = null;        // cached DOM slots for 60 FPS metric updates without innerHTML thrash

/* ---------------- data loading ---------------- */

function status(msg, err) {
  const el = $("status");
  el.textContent = msg || "";
  el.classList.toggle("err", !!err);
}

/* Load an ephemeris file as a <script> tag (works from file:// and http(s)). */
function loadSeriesFile(key) {
  if (!window.__LSP_DATA) window.__LSP_DATA = {};
  if (window.__LSP_DATA[key]) return Promise.resolve(window.__LSP_DATA[key]);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "data/" + key + ".js";
    s.onload = () => window.__LSP_DATA[key] ? resolve(window.__LSP_DATA[key])
                                            : reject(new Error("data file empty: " + key));
    s.onerror = () => reject(new Error("cannot load data/" + key + ".js"));
    document.head.appendChild(s);
  });
}

function populateSelect() {
  const sel = $("siteSelect");
  const groups = {};
  for (const s of SITES) (groups[s.group] = groups[s.group] || []).push(s);
  for (const g of Object.keys(groups)) {
    const og = document.createElement("optgroup");
    og.label = g;
    for (const s of groups[g]) {
      const o = document.createElement("option");
      o.value = s.id; o.textContent = s.name + (s.approx ? " (approx.)" : "");
      og.appendChild(o);
    }
    sel.appendChild(og);
  }
  const oc = document.createElement("option");
  oc.textContent = "Custom coordinates…"; oc.value = "custom";
  sel.appendChild(oc);
  sel.value = "shack";
}

async function synthesizeCustomSeriesFromCache(site, t0s, t1s) {
  let base = seriesCache.ap11;
  if (!base && window.__LSP_CACHE && window.__LSP_CACHE.ap11) {
    base = window.__LSP_CACHE.ap11;
  }
  if (!base) {
    const [sun, earth] = await Promise.all([
      loadSeriesFile("ap11_sun"),
      loadSeriesFile("ap11_earth"),
    ]);
    base = { sun, earth };
    seriesCache.ap11 = base;
  }
  const ref = SITES.find(s => s.id === "ap11") || { lat: 0.67, lon: 23.47 };
  const transform = (raw) => {
    const s = crop(raw, t0s, t1s);
    const n = s.el.length;
    const az = new Array(n), el = new Array(n);
    for (let i = 0; i < n; i++) {
      const vec = localAzElToSelenographic(ref.lat, ref.lon, s.az[i], s.el[i]);
      const loc = selenographicToLocalAzEl(site.lat, site.lon, vec);
      az[i] = loc.az;
      el[i] = loc.el;
    }
    return { t0: s.t0, step: s.step, az, el };
  };
  return { sun: transform(base.sun), earth: transform(base.earth), source: "selenographic-cache" };
}

async function getSeries(site, startMs, endMs) {
  const t0s = startMs / 1000, t1s = endMs / 1000;
  const useCache = site.id !== "custom" && t0s >= CACHE_START && t1s <= CACHE_END;
  if (useCache) {
    if (!seriesCache[site.id]) {
      const [sun, earth] = await Promise.all([
        loadSeriesFile(site.id + "_sun"),
        loadSeriesFile(site.id + "_earth"),
      ]);
      seriesCache[site.id] = { sun, earth };
    }
    const c = seriesCache[site.id];
    return { sun: crop(c.sun, t0s, t1s), earth: crop(c.earth, t0s, t1s), source: "cache" };
  }
  if (site.id === "custom" && t0s >= CACHE_START && t1s <= CACHE_END) {
    let timer = null;
    try {
      const live = Promise.all([
        liveFetch(10, site.lon, site.lat, startMs, endMs),
        liveFetch(399, site.lon, site.lat, startMs, endMs),
      ]);
      const [sun, earth] = await Promise.race([
        live,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("live Horizons timeout")), 3500);
        }),
      ]);
      if (timer) clearTimeout(timer);
      return { sun, earth, source: "live" };
    } catch (e) {
      if (timer) clearTimeout(timer);
      return synthesizeCustomSeriesFromCache(site, t0s, t1s);
    }
  }
  const [sun, earth] = await Promise.all([
    liveFetch(10, site.lon, site.lat, startMs, endMs),
    liveFetch(399, site.lon, site.lat, startMs, endMs),
  ]);
  return { sun, earth, source: "live" };
}

/* Build a Horizons API query URL (topocentric site on the Moon, az/el, hourly). */
function horizonsURL(target, lon, lat, startMs, endMs) {
  const lonE = Math.round((((lon % 360) + 360) % 360) * 10000) / 10000;
  const p = new URLSearchParams();
  p.set("format", "text");
  p.set("COMMAND", `'${target}'`);
  p.set("OBJ_DATA", "'NO'");
  p.set("MAKE_EPHEM", "'YES'");
  p.set("EPHEM_TYPE", "'OBSERVER'");
  p.set("CENTER", "'coord@301'");
  p.set("COORD_TYPE", "'GEODETIC'");
  p.set("SITE_COORD", `'${lonE},${lat},0'`);
  p.set("START_TIME", `'${isoHM(startMs)}'`);
  p.set("STOP_TIME", `'${isoHM(endMs)}'`);
  p.set("STEP_SIZE", "'1h'");
  p.set("QUANTITIES", "'4'");
  p.set("ANG_FORMAT", "'DEG'");
  p.set("CSV_FORMAT", "'YES'");
  p.set("TIME_DIGITS", "'MINUTES'");
  return "https://ssd.jpl.nasa.gov/api/horizons.api?" + p.toString().replace(/\+/g, "%20");
}
function isoHM(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/* Parse a Horizons CSV ephemeris body into {t0,step,az,el}. */
function parseHorizons(text) {
  const m = text.match(/\$\$SOE\r?\n([\s\S]*?)\$\$EOE/);
  if (!m) throw new Error("Horizons returned no table (check date range / connection)");
  const rows = [];
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const f = line.split(",");
    if (f.length < 5) continue;
    const dm = f[0].trim().match(/^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d{2}):(\d{2})/);
    if (!dm) continue;
    const t = Date.UTC(+dm[1], MON[dm[2]], +dm[3], +dm[4], +dm[5]) / 1000;
    const az = parseFloat(f[3]), el = parseFloat(f[4]);
    if (isNaN(t) || isNaN(az) || isNaN(el)) continue;
    rows.push([t, az, el]);
  }
  if (rows.length < 2) throw new Error("empty ephemeris table");
  return {
    t0: rows[0][0], step: 3600,
    az: rows.map(r => Math.round(r[1] * 100) / 100),
    el: rows.map(r => Math.round(r[2] * 1000) / 1000),
  };
}

/* Live fetch: direct first (blocked by CORS in most browsers), then public relays. */
async function liveFetch(target, lon, lat, startMs, endMs) {
  const url = horizonsURL(target, lon, lat, startMs, endMs);
  const attempts = [
    url,
    "https://r.jina.ai/" + url,
    "https://api.allorigins.win/raw?url=" + encodeURIComponent(url),
    "https://corsproxy.io/?url=" + encodeURIComponent(url),
  ];
  let lastErr = null;
  for (const u of attempts) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout ? AbortSignal.timeout(60000) : undefined });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const text = await r.text();
      return parseHorizons(text);
    } catch (e) { lastErr = e; }
  }
  throw new Error("live Horizons fetch failed: " + (lastErr ? lastErr.message : "unknown"));
}

/* ---------------- terrain horizon (LRO LOLA DEM) ---------------- */

/** Active horizon model id: "lola" | "lola15" | "flat15" | "flat". */
function horizonMode() {
  const el = $("horizonSelect");
  return el ? el.value : "lola";
}

/** Circular linear interpolation of active horizon mask (deg) at azimuth (deg). */
function horizonAt(sc, azDeg) {
  const mode = horizonMode();
  if (mode === "flat") return 0;
  if (mode === "flat15") return 1.5;
  const arr = sc && sc.horizon && sc.horizon.el;
  if (!arr || arr.length !== 360) return mode === "lola15" ? 1.5 : 0;
  const a = ((azDeg % 360) + 360) % 360;
  const i0 = Math.floor(a);
  const i1 = (i0 + 1) % 360;
  const v = arr[i0] + (a - i0) * (arr[i1] - arr[i0]);
  return mode === "lola15" ? Math.max(v, 1.5) : v;
}

/** Interpolated ridge distance (km) from LOLA DEM at azimuth (deg), or null. */
function horizonDistAt(sc, azDeg) {
  const arr = sc && sc.horizon && sc.horizon.distKm;
  if (!arr || arr.length !== 360 || horizonMode().startsWith("flat")) return null;
  const a = ((azDeg % 360) + 360) % 360;
  const i0 = Math.floor(a);
  const i1 = (i0 + 1) % 360;
  return arr[i0] + (a - i0) * (arr[i1] - arr[i0]);
}

/** Human-readable description of active horizon model on this scenario. */
function horizonLabel(sc) {
  const mode = horizonMode();
  if (mode === "flat") return "smooth sphere (0° ideal)";
  if (mode === "flat15") return "flat 1.5° operational mask";
  const hasDem = sc && sc.horizon && sc.horizon.source !== "flat-fallback";
  if (!hasDem) return mode === "lola15" ? "1.5° mask (DEM unavailable)" : "0° fallback (DEM unavailable)";
  const base = sc.horizon.source === "lola-cache" ? "LRO LOLA DEM (precomputed)" : "LRO LOLA DEM (live)";
  return mode === "lola15" ? base + " + 1.5° floor" : base;
}

/** Parse uncompressed Float32 GeoTIFF (strips or tiles) with alignment-safe DataView reads. */
function parseGeoTiffF32(buf, lonShiftDeg = 0) {
  const view = new DataView(buf);
  if (view.byteLength < 8) throw new Error("truncated TIFF");
  const bom = view.getUint16(0, false);
  const le = bom === 0x4949 ? true : bom === 0x4D4D ? false : null;
  if (le === null || view.getUint16(2, le) !== 42) throw new Error("invalid TIFF header");
  const ifdOff = view.getUint32(4, le);
  const nEntries = view.getUint16(ifdOff, le);
  const tags = {};

  const readNums = (type, count, valOff) => {
    const sz = type === 3 ? 2 : (type === 4 ? 4 : (type === 12 ? 8 : 0));
    if (!sz) return null;
    const base = count * sz <= 4 ? valOff : view.getUint32(valOff, le);
    const out = new Array(count);
    for (let i = 0; i < count; i++) {
      const p = base + i * sz;
      out[i] = type === 3 ? view.getUint16(p, le)
        : type === 4 ? view.getUint32(p, le) : view.getFloat64(p, le);
    }
    return out;
  };

  for (let i = 0; i < nEntries; i++) {
    const off = ifdOff + 2 + i * 12;
    const tag = view.getUint16(off, le);
    const type = view.getUint16(off + 2, le);
    const count = view.getUint32(off + 4, le);
    const vals = readNums(type, count, off + 8);
    if (vals) tags[tag] = vals;
  }

  const width = tags[256] && tags[256][0], height = tags[257] && tags[257][0];
  const comp = tags[259] ? tags[259][0] : 1;
  const scale = tags[33550], tie = tags[33922];
  if (!width || !height || comp !== 1 || !scale || !tie) {
    throw new Error("unsupported GeoTIFF layout");
  }
  const data = new Float32Array(width * height);
  data.fill(NaN);

  const readF32 = (off) => {
    const v = view.getFloat32(off, le);
    return Number.isFinite(v) && v > -20000 ? v : NaN;
  };

  if (tags[273]) {
    const offsets = tags[273], rps = tags[278] ? tags[278][0] : height;
    for (let s = 0; s < offsets.length; s++) {
      const r0 = s * rps, r1 = Math.min(height, r0 + rps);
      let p = offsets[s];
      for (let r = r0; r < r1; r++) {
        for (let c = 0; c < width; c++, p += 4) data[r * width + c] = readF32(p);
      }
    }
  } else if (tags[324] && tags[322] && tags[323]) {
    const tw = tags[322][0], th = tags[323][0], offsets = tags[324];
    const across = Math.ceil(width / tw);
    for (let t = 0; t < offsets.length; t++) {
      const tx = (t % across) * tw, ty = Math.floor(t / across) * th;
      let p = offsets[t];
      for (let r = 0; r < th; r++) {
        const gy = ty + r;
        for (let c = 0; c < tw; c++, p += 4) {
          const gx = tx + c;
          if (gx < width && gy < height) data[gy * width + gx] = readF32(p);
        }
      }
    }
  } else {
    throw new Error("missing TIFF pixel offsets");
  }

  const dx = scale[0], dy = scale[1];
  const xmin = tie[3] - tie[0] * dx + lonShiftDeg;
  const ymax = tie[4] + tie[1] * dy;
  return {
    width, height, dx, dy, data,
    xmin, xmax: xmin + width * dx,
    ymin: ymax - height * dy, ymax,
  };
}

/** Bilinear sample of GeoTIFF grid in tile coordinates, or null if outside/NoData. */
function sampleGeoTile(tile, x, y) {
  const c = (x - tile.xmin) / tile.dx - 0.5;
  const r = (tile.ymax - y) / tile.dy - 0.5;
  if (c < 0 || c > tile.width - 1 || r < 0 || r > tile.height - 1) return null;
  const c0 = Math.floor(c), r0 = Math.floor(r);
  const c1 = Math.min(tile.width - 1, c0 + 1), r1 = Math.min(tile.height - 1, r0 + 1);
  const fc = c - c0, fr = r - r0;
  const w = tile.width, d = tile.data;
  const v00 = d[r0 * w + c0], v10 = d[r0 * w + c1];
  const v01 = d[r1 * w + c0], v11 = d[r1 * w + c1];
  if (isNaN(v00) || isNaN(v10) || isNaN(v01) || isNaN(v11)) return null;
  const top = v00 + (v10 - v00) * fc;
  const bot = v01 + (v11 - v01) * fc;
  return top + (bot - top) * fr;
}

/** Fetch one LRO LOLA DEM uncompressed Float32 TIFF patch. */
async function fetchLolaTile(service, bbox, w = 128, h = 128) {
  const url = `https://trek.nasa.gov/moon/trekarcgis/rest/services/${service}/ImageServer/exportImage` +
    `?bbox=${bbox.join(",")}&size=${w},${h}&format=tiff&compression=NONE&pixelType=F32&interpolation=RSP_BilinearInterpolation&f=image`;
  const resp = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
  if (!resp.ok) throw new Error(`LOLA HTTP ${resp.status}`);
  return parseGeoTiffF32(await resp.arrayBuffer());
}

/** Fetch concentric near/far LOLA DEM grids and raymarch 360-deg terrain horizon. */
async function fetchLiveHorizon(lon, lat) {
  const proj = projectLunar(lon, lat);
  const lon180 = proj.lon180;
  let tilesNear = [], tilesFar = [], sampleAt;

  if (proj.region === "global") {
    const svc = "LRO_LOLA_DEM_Global_256ppd_v06";
    const cosL = Math.max(0.25, Math.cos(lat * Math.PI / 180));
    const fetchSpan = async (radiusKm) => {
      const spanDeg = (radiusKm * 1000 / (R_MOON * cosL)) * 180 / Math.PI;
      const y0 = Math.max(-89.9, lat - spanDeg), y1 = Math.min(89.9, lat + spanDeg);
      const halfSpan = (y1 - y0) / 2, fullSpan = 2 * halfSpan;
      if (lon180 - halfSpan < -180 || lon180 + halfSpan > 180) {
        return Promise.all([
          fetchLolaTile(svc, [-180, y0, -180 + fullSpan, y1], 128, 128),
          fetchLolaTile(svc, [180 - fullSpan, y0, 180, y1], 128, 128),
        ]);
      }
      return Promise.all([fetchLolaTile(svc, [lon180 - halfSpan, y0, lon180 + halfSpan, y1], 128, 128)]);
    };
    [tilesNear, tilesFar] = await Promise.all([fetchSpan(16), fetchSpan(96)]);
    sampleAt = (gridList, sLon, sLat) => {
      const sl = ((sLon + 180) % 360 + 360) % 360 - 180;
      for (const t of gridList) {
        const v = sampleGeoTile(t, sl, sLat);
        if (v !== null) return v;
      }
      return null;
    };
  } else {
    const svc = proj.region === "spole" ? "LRO_LOLA_DEM_SPole45_100mp_v04" : "LRO_LOLA_DEM_NPole45_100mp_v04";
    const clampBbox = half => [
      Math.max(-1439900, proj.x - half), Math.max(-1439900, proj.y - half),
      Math.min(1439900, proj.x + half), Math.min(1439900, proj.y + half),
    ];
    const [tn, tf] = await Promise.all([
      fetchLolaTile(svc, clampBbox(16000), 128, 128),
      fetchLolaTile(svc, clampBbox(96000), 128, 128),
    ]);
    tilesNear = [tn]; tilesFar = [tf];
    sampleAt = (gridList, sLon, sLat) => {
      const sp = projectLunar(sLon, sLat);
      return sampleGeoTile(gridList[0], sp.x, sp.y);
    };
  }

  let elev0 = sampleAt(tilesNear, lon180, lat);
  if (elev0 === null) elev0 = sampleAt(tilesFar, lon180, lat);
  if (elev0 === null) throw new Error("site outside valid LOLA coverage");

  const lat0R = lat * Math.PI / 180;
  const sinLat0 = Math.sin(lat0R), cosLat0 = Math.cos(lat0R);
  const elArr = new Array(360), distArr = new Array(360);
  const rObs = R_MOON + elev0 + 2;

  const marchStep = (az, azR, sM, primary, secondary, state) => {
    const ang = sM / R_MOON;
    let sLat, sLon;
    if (cosLat0 < 1e-6) {
      sLat = (lat < 0 ? -90 + ang * 180 / Math.PI : 90 - ang * 180 / Math.PI);
      sLon = lon180 + (lat < 0 ? az : 180 - az);
    } else {
      const sinLat = Math.max(-1, Math.min(1, sinLat0 * Math.cos(ang) + cosLat0 * Math.sin(ang) * Math.cos(azR)));
      sLat = Math.asin(sinLat) * 180 / Math.PI;
      sLon = lon180 + Math.atan2(
        Math.sin(azR) * Math.sin(ang) * cosLat0,
        Math.cos(ang) - sinLat0 * sinLat
      ) * 180 / Math.PI;
    }
    let h = sampleAt(primary, sLon, sLat);
    if (h === null && secondary) h = sampleAt(secondary, sLon, sLat);
    if (h === null) return;
    const rTgt = R_MOON + h;
    const elDeg = Math.atan2(rTgt * Math.cos(ang) - rObs, rTgt * Math.sin(ang)) * 180 / Math.PI;
    if (elDeg > state.bestEl) { state.bestEl = elDeg; state.bestDistKm = sM / 1000; }
  };

  for (let az = 0; az < 360; az++) {
    const azR = az * Math.PI / 180;
    const state = { bestEl: 0, bestDistKm: 0 };
    for (let s = 250; s <= 15000; s += 250) marchStep(az, azR, s, tilesNear, tilesFar, state);
    for (let s = 16000; s <= 90000; s += 1000) marchStep(az, azR, s, tilesFar, null, state);
    elArr[az] = Math.round(state.bestEl * 100) / 100;
    distArr[az] = Math.round(state.bestDistKm * 10) / 10;
  }

  return { elevM: Math.round(elev0 * 10) / 10, el: elArr, distKm: distArr, source: "lola-live" };
}

/** Return precomputed LOLA horizon profile for curated sites, or fetch live for custom sites. */
async function getHorizon(site) {
  const pre = window.__LSP_HORIZONS;
  if (site.id !== "custom" && pre && pre[site.id]) {
    const p = pre[site.id];
    return { elevM: p.elevM, el: p.el, distKm: p.distKm, source: "lola-cache" };
  }
  const lon180 = ((site.lon + 180) % 360 + 360) % 360 - 180;
  const key = `${lon180.toFixed(4)},${site.lat.toFixed(4)}`;
  if (horizonCache[key]) return horizonCache[key];
  try {
    const h = await fetchLiveHorizon(site.lon, site.lat);
    horizonCache[key] = h;
    return h;
  } catch (e) {
    console.warn("LOLA horizon fetch fallback:", e);
    return { elevM: null, el: new Array(360).fill(0), distKm: new Array(360).fill(0), source: "flat-fallback" };
  }
}

/* ---------------- metrics ---------------- */

function computeStats(sc, refMs) {
  const mode = horizonMode();
  let base = sc._statsCache && sc._statsCache.mode === mode ? sc._statsCache.base : null;
  if (!base) {
    const sun = sc.sun, earth = sc.earth;
    const startMs = sc.startMs != null ? sc.startMs : sun.t0 * 1000;
    const endMs = sc.endMs != null ? sc.endMs : (sun.t0 + (sun.el.length - 1) * sun.step) * 1000;
    const n = sun.el.length;
    const hor = az => horizonAt(sc, az);
    const sunUp = i => sun.el[i] > hor(sun.az[i]);
    const earthUp = i => earth.el[i] > hor(earth.az[i]);
    let sunPct = 0, earthPct = 0, bothPct = 0;
    let sunPctFlat = 0, earthPctFlat = 0, bothPctFlat = 0;
    for (let i = 0; i < n; i++) {
      const s = sunUp(i), e = earthUp(i);
      if (s) sunPct++;
      if (e) earthPct++;
      if (s && e) bothPct++;
      const sf = sun.el[i] > 0, ef = earth.el[i] > 0;
      if (sf) sunPctFlat++;
      if (ef) earthPctFlat++;
      if (sf && ef) bothPctFlat++;
    }
    /* longest continuous sunlit run above active horizon */
    let best = 0, run = 0;
    for (let i = 0; i < n; i++) {
      run = sunUp(i) ? run + 1 : 0;
      if (run > best) best = run;
    }
    let sunMaxEl = -91, sunMaxI = 0;
    for (let i = 0; i < n; i++) if (sun.el[i] > sunMaxEl) { sunMaxEl = sun.el[i]; sunMaxI = i; }
    let earthMinEl = 91, earthMaxEl = -91;
    for (let i = 0; i < earth.el.length; i++) {
      if (earth.el[i] < earthMinEl) earthMinEl = earth.el[i];
      if (earth.el[i] > earthMaxEl) earthMaxEl = earth.el[i];
    }
    let horMin = 90, horMax = -90, horSum = 0;
    for (let az = 0; az < 360; az++) {
      const h = hor(az);
      if (h < horMin) horMin = h;
      if (h > horMax) horMax = h;
      horSum += h;
    }
    const sunX = crossings(sun, hor), earthX = crossings(earth, hor);
    base = {
      n,
      sunPct: 100 * sunPct / n, earthPct: 100 * earthPct / n, bothPct: 100 * bothPct / n,
      sunPctFlat: 100 * sunPctFlat / n, earthPctFlat: 100 * earthPctFlat / n, bothPctFlat: 100 * bothPctFlat / n,
      horMin, horMax, horMean: horSum / 360,
      longestDaylightMs: Math.min(best * sun.step * 1000, endMs - startMs),
      sunMaxEl, sunMaxT: (sun.t0 + sunMaxI * sun.step) * 1000,
      earthMinEl, earthMaxEl,
      sunX, earthX,
    };
    sc._statsCache = { mode, base };
  }
  const ref = refMs / 1000;
  const nextSet = (xs) => xs.find(x => x.t > ref && !x.up);
  const nextRise = (xs) => xs.find(x => x.t > ref && x.up);
  return {
    n: base.n,
    sunPct: base.sunPct, earthPct: base.earthPct, bothPct: base.bothPct,
    sunPctFlat: base.sunPctFlat, earthPctFlat: base.earthPctFlat, bothPctFlat: base.bothPctFlat,
    horMin: base.horMin, horMax: base.horMax, horMean: base.horMean,
    longestDaylightMs: base.longestDaylightMs,
    sunMaxEl: base.sunMaxEl, sunMaxT: base.sunMaxT,
    earthMinEl: base.earthMinEl, earthMaxEl: base.earthMaxEl,
    sunNextSet: nextSet(base.sunX), sunNextRise: nextRise(base.sunX),
    earthNextSet: nextSet(base.earthX), earthNextRise: nextRise(base.earthX),
  };
}

/* ---------------- scenario rendering ---------------- */

function renderScenario() {
  const sc = current;
  $("scenarioView").hidden = false;
  $("scenTitle").textContent = sc.site.name;
  const approx = sc.site.approx ? " (coordinates approximate)" : "";
  const elevTxt = sc.horizon && sc.horizon.elevM != null
    ? ` · LOLA elev ${Math.round(sc.horizon.elevM)} m` : "";
  const src = sc.source === "cache"
    ? "precomputed JPL Horizons dataset (2025–2029)"
    : sc.source === "selenographic-cache"
      ? "selenographic transform from precomputed JPL Horizons (2025–2029)"
      : "live JPL Horizons fetch (experimental)";
  const degraded = horizonMode().startsWith("lola") && sc.horizon && sc.horizon.source === "flat-fallback"
    ? " · DEM unavailable, using flat fallback" : "";
  $("scenMeta").textContent =
    `lon ${sc.site.lon}°E, lat ${sc.site.lat}°${approx}${elevTxt} · window ${fmtUTC(sc.startMs)} → ` +
    `${fmtUTC(sc.endMs)} · data: ${src} · horizon: ${horizonLabel(sc)}${degraded}`;
  scrubT = sc.startMs + (sc.endMs - sc.startMs) * ($("scrub").value / 1000);
  updateLinks();
  if (typeof flyGlobeTo === "function") flyGlobeTo(sc.site.lat, sc.site.lon);
  drawAll();
}

const R_MOON = 1737400;

/** Project lunar (lon, lat) in degrees to QuickMap and Moon Trek coordinates. */
function projectLunar(lon, lat) {
  const lon180 = Number(((((lon + 180) % 360 + 360) % 360) - 180).toFixed(6));
  const lonR = lon180 * Math.PI / 180;
  const latR = lat * Math.PI / 180;
  if (lat <= -60) {
    const r = 2 * R_MOON * Math.tan(Math.PI / 4 + latR / 2);
    const x = r * Math.sin(lonR), y = r * Math.cos(lonR);
    return {
      lon180, lat, x, y, half: 25000, qmProj: 27,
      mtProj: "urn:ogc:def:crs:IAU2000::30120",
      mtX: Math.round(x), mtY: Math.round(y), mtZ: 6,
      region: "spole",
    };
  }
  if (lat >= 60) {
    const r = 2 * R_MOON * Math.tan(Math.PI / 4 - latR / 2);
    const x = r * Math.sin(lonR), y = -r * Math.cos(lonR);
    return {
      lon180, lat, x, y, half: 25000, qmProj: 26,
      mtProj: "urn:ogc:def:crs:IAU2000::30118",
      mtX: Math.round(x), mtY: Math.round(y), mtZ: 6,
      region: "npole",
    };
  }
  const x = R_MOON * lonR, y = R_MOON * latR;
  return {
    lon180, lat, x, y, half: 35000, qmProj: 16,
    mtProj: "urn:ogc:def:crs:EPSG::104903",
    mtX: Number(lon180.toFixed(4)), mtY: Number(lat.toFixed(4)), mtZ: 7,
    region: "global",
  };
}

function updateLinks() {
  const sc = current;
  const lon = sc.site.lon, lat = sc.site.lat;
  const p = projectLunar(lon, lat);
  const ext = [
    Math.round(p.x - p.half), Math.round(p.y - p.half),
    Math.round(p.x + p.half), Math.round(p.y + p.half),
  ].join(",");
  if ($("linksLabel")) $("linksLabel").textContent = `Open ${sc.site.name} in:`;
  $("qmLink").href =
    `https://quickmap.lroc.im-ldi.com/?prjExtent=${ext}&proj=${p.qmProj}&features=${p.lon180},${lat}`;
  $("mtLink").href =
    `https://trek.nasa.gov/moon/#v=0.1&x=${p.mtX}&y=${p.mtY}&z=${p.mtZ}&p=${encodeURIComponent(p.mtProj)}&d=2d`;
}

/* ---------------- scientific glossary tooltips ---------------- */

const TOOLTIPS = {
  sunEl: {
    title: "Solar Elevation",
    body: "Angle of the Sun above (+) or below (-) the mathematical 0° lunar horizon plane at the selected time. Sunlight reaches the surface when elevation clears both 0° and surrounding terrain ridges.",
  },
  nextSun: {
    title: "Next Sunset / Sunrise",
    body: "Countdown and UTC timestamp for the next moment the Sun crosses below or above the active terrain horizon mask within the selected mission window.",
  },
  peakSun: {
    title: "Peak Sun Elevation",
    body: "Highest solar altitude angle reached during the chosen window. Higher solar angles shorten surface shadows and increase power generated by level solar arrays.",
  },
  sunlit: {
    title: "Sunlit (% of Window)",
    body: "Fraction of hourly samples where the Sun clears the active horizon mask, paired with the longest continuous uninterrupted daylight streak and loss relative to an ideal 0° sphere.",
  },
  earthEl: {
    title: "Earth Elevation",
    body: "Angle of Earth above (+) or below (-) the mathematical 0° horizon from the landing site. Positive terrain clearance provides direct-to-Earth line-of-sight radio links.",
  },
  earthVis: {
    title: "Earth Visibility",
    body: "Percentage of the window where Earth clears local terrain ridges. Due to lunar libration, polar landing sites see Earth nod slowly across the horizon, making ridge height decisive for communications.",
  },
  solarPower: {
    title: "Solar Power Proxy (Level Panel)",
    body: "Geometric sin(elevation) incidence factor for a flat horizontal solar panel (100% if directly overhead, 0% when shaded behind terrain or below the horizon), before thermal or efficiency losses.",
  },
  fullOps: {
    title: "Sunlit AND Earth-Visible",
    body: "Combined full-operations window where the lander simultaneously has solar power (Sun above mask) and direct-to-Earth communication line-of-sight (Earth above mask).",
  },
  localHorizon: {
    title: "Local Terrain Horizon",
    body: "Angular height range (min to max) and 360° mean ridge obstruction derived from NASA LRO LOLA laser altimetry elevations around the landing site.",
  },
  horizonModel: {
    title: "Horizon Model Selection",
    body: "LRO LOLA DEM models real surrounding terrain ridges up to 90 km out. +1.5° floor adds a conservative surface clearance buffer. Flat 1.5° and Smooth sphere (0°) ignore topography for baseline comparison.",
  },
  elevChart: {
    title: "Elevation vs Time",
    body: "Compares hourly solar (gold) and Earth (blue) elevation curves over the mission window against the dashed orange terrain obstruction along the Sun's azimuth.",
  },
  domeChart: {
    title: "Sky Dome Projection",
    body: "Fish-eye polar map looking straight overhead from the site (zenith +90° at center, mathematical 0° horizon on outer rim, North up). Solid arcs mark clear sky; dotted arcs are blocked behind orange ridges.",
  },
  horizonChart: {
    title: "360° Local Terrain Horizon Profile",
    body: "Full panoramic view across compass azimuths (0° North -> 90° East -> 180° South -> 270° West), overlaying Sun and Earth paths across craters and ridge peaks.",
  },
  geomChart: {
    title: "Sun, Earth & Local Horizon Geometry",
    body: "Spatial cross-section at the current scrub time showing the curved airless lunar surface (R = 1,737.4 km, 0° refraction), the LRO LOLA ridge height and distance along the Sun azimuth, and whether solar rays or Direct-to-Earth links clear or strike local terrain.",
  },
  moonGlobe: {
    title: "Interactive 3D Lunar Globe",
    body: "Selenographic 3D Moon (0° prime meridian facing Earth, 90°E Mare Crisium, 180° far side) illuminated by the live solar direction from the Mission Timeline. Amber and blue vectors point toward the Sun and Earth and fade when below the active horizon. Click any preset dot or surface point to pin and evaluate.",
  },
  windowsChart: {
    title: "Operational Windows Strip",
    body: "Timeline bands highlighting contiguous periods of Sun visibility, Earth visibility, and simultaneous Sun+Earth operations compared against a flat 0° sphere (translucent backdrop).",
  },
  azimuth: {
    title: "Azimuth & Ridge Clearance",
    body: "Azimuth is compass bearing clockwise from North (0° N, 90° E, 180° S, 270° W). Positive clearance indicates degrees above the local ridge; negative indicates terrain shading or below-horizon position.",
  },
  compareChart: {
    title: "Scenario Overlay Comparison",
    body: "Overlays solar elevation profiles across up to 6 saved session scenarios on a shared UTC timeline using the currently selected horizon model.",
  },
};

let activeTipBtn = null;
let pinnedTipBtn = null;
let tipHideTimer = null;

function positionTooltip(btn) {
  const pop = $("tooltipPopover");
  if (!pop || pop.hidden || !btn) return;
  const br = btn.getBoundingClientRect();
  const pw = pop.offsetWidth || 280;
  const ph = pop.offsetHeight || 90;
  let left = br.left + br.width / 2 - pw / 2;
  left = Math.max(12, Math.min(window.innerWidth - pw - 12, left));
  let top = br.bottom + 8;
  if (top + ph > window.innerHeight - 12) {
    top = Math.max(12, br.top - ph - 8);
  }
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(top) + "px";
}

function showTooltip(btn, pin) {
  clearTimeout(tipHideTimer);
  const key = btn && btn.dataset ? btn.dataset.tip : "";
  const entry = TOOLTIPS[key];
  const pop = $("tooltipPopover");
  if (!entry || !pop) return;
  if (activeTipBtn && activeTipBtn !== btn) {
    activeTipBtn.setAttribute("aria-expanded", "false");
  }
  activeTipBtn = btn;
  if (pin) pinnedTipBtn = btn;
  btn.setAttribute("aria-expanded", "true");
  pop.innerHTML = "";
  const st = document.createElement("strong");
  st.textContent = entry.title;
  const p = document.createElement("div");
  p.textContent = entry.body;
  pop.appendChild(st);
  pop.appendChild(p);
  pop.hidden = false;
  positionTooltip(btn);
}

function hideTooltip(force) {
  clearTimeout(tipHideTimer);
  if (!force && pinnedTipBtn) return;
  const pop = $("tooltipPopover");
  if (pop) pop.hidden = true;
  if (activeTipBtn) activeTipBtn.setAttribute("aria-expanded", "false");
  activeTipBtn = null;
  if (force) pinnedTipBtn = null;
}

function initTooltips() {
  const pop = $("tooltipPopover");
  document.querySelectorAll(".info-btn").forEach(b => b.setAttribute("aria-expanded", "false"));

  document.addEventListener("mouseover", e => {
    const btn = e.target.closest(".info-btn");
    if (btn) {
      if (pinnedTipBtn && pinnedTipBtn !== btn) return;
      showTooltip(btn, false);
    } else if (pop && pop.contains(e.target)) {
      clearTimeout(tipHideTimer);
    }
  });
  document.addEventListener("mouseout", e => {
    const btn = e.target.closest(".info-btn");
    if ((btn || (pop && pop.contains(e.target))) && !pinnedTipBtn) {
      const to = e.relatedTarget;
      if (to && ((pop && pop.contains(to)) || (to.closest && to.closest(".info-btn")))) return;
      tipHideTimer = setTimeout(() => hideTooltip(false), 120);
    }
  });
  document.addEventListener("focusin", e => {
    const btn = e.target.closest(".info-btn");
    if (btn) showTooltip(btn, false);
  });
  document.addEventListener("focusout", e => {
    const btn = e.target.closest(".info-btn");
    if (btn && !pinnedTipBtn) {
      tipHideTimer = setTimeout(() => {
        if (!document.activeElement || !document.activeElement.classList.contains("info-btn")) {
          hideTooltip(false);
        }
      }, 60);
    }
  });
  document.addEventListener("click", e => {
    const btn = e.target.closest(".info-btn");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      if (pinnedTipBtn === btn) hideTooltip(true);
      else showTooltip(btn, true);
      return;
    }
    if (pop && !pop.contains(e.target)) hideTooltip(true);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && (activeTipBtn || pinnedTipBtn)) {
      const returnFocus = pinnedTipBtn || activeTipBtn;
      hideTooltip(true);
      if (returnFocus && returnFocus.focus) returnFocus.focus();
    }
  });
  window.addEventListener("scroll", () => { if (activeTipBtn) positionTooltip(activeTipBtn); }, { passive: true });
  window.addEventListener("resize", () => { if (activeTipBtn) positionTooltip(activeTipBtn); });
}

/* Persistent metric card DOM shells (never rebuilt during 60 FPS scrubbing) */
const METRIC_SPECS = [
  { cls: "sun", title: "Sun elevation (at scrub time)", tip: "sunEl" },
  { cls: "", title: "Next sunset", tip: "nextSun" },
  { cls: "sun", title: "Peak Sun elevation", tip: "peakSun" },
  { cls: "", title: "Sunlit", tip: "sunlit" },
  { cls: "earth", title: "Earth elevation (at scrub time)", tip: "earthEl" },
  { cls: "earth", title: "Earth visibility", tip: "earthVis" },
  { cls: "", title: "Solar power proxy (level panel)", tip: "solarPower" },
  { cls: "", title: "Sunlit AND Earth-visible", tip: "fullOps" },
  { cls: "", title: "Local terrain horizon", tip: "localHorizon" },
];

function initMetricCards() {
  const wrap = $("metrics");
  if (!wrap || metricNodes) return;
  wrap.innerHTML = "";
  metricNodes = METRIC_SPECS.map(spec => {
    const card = document.createElement("div");
    card.className = "card" + (spec.cls ? " " + spec.cls : "");
    const head = document.createElement("div");
    head.className = "card-head";
    const kEl = document.createElement("span");
    kEl.className = "k-text";
    kEl.textContent = spec.title;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "info-btn";
    btn.dataset.tip = spec.tip;
    btn.setAttribute("aria-label", "About " + spec.title);
    btn.setAttribute("aria-expanded", "false");
    btn.textContent = "ⓘ";
    head.appendChild(kEl);
    head.appendChild(btn);
    const vEl = document.createElement("div");
    vEl.className = "v";
    const dEl = document.createElement("div");
    dEl.className = "d";
    card.appendChild(head);
    card.appendChild(vEl);
    card.appendChild(dEl);
    wrap.appendChild(card);
    return { card, kEl, vEl, dEl, btn };
  });
}

function renderMetrics(precomputedSt) {
  if (!metricNodes) initMetricCards();
  const sc = current;
  const st = precomputedSt || computeStats(sc, scrubT);
  const sunNow = interp(sc.sun, scrubT / 1000);
  const earthNow = interp(sc.earth, scrubT / 1000);
  const mode = horizonMode();
  const useHor = mode !== "flat";
  const sunHor = sunNow ? horizonAt(sc, sunNow.az) : 0;
  const earthHor = earthNow ? horizonAt(sc, earthNow.az) : 0;
  const pct = (x) => (Math.round(x * 10) / 10) + "%";
  const deg = (x) => (x >= 0 ? "+" : "") + (Math.round(x * 100) / 100) + "°";
  const statusDetail = (p, h) => {
    const clear = p.el - h;
    if (!useHor) return `azimuth ${p.az.toFixed(1)}° · ${p.el > 0 ? "above horizon ▲" : "below horizon ▼"}`;
    if (clear > 0) return `az ${p.az.toFixed(1)}° · +${clear.toFixed(2)}° above ${h.toFixed(1)}° horizon ▲`;
    if (p.el > 0) return `az ${p.az.toFixed(1)}° · blocked by ${h.toFixed(1)}° ridge (${clear.toFixed(2)}°) ▼`;
    return `az ${p.az.toFixed(1)}° · below 0° sphere (${h.toFixed(1)}° ridge) ▼`;
  };
  const setSlot = (idx, hidden, title, v, d) => {
    const slot = metricNodes[idx];
    slot.card.hidden = !!hidden;
    if (hidden) return;
    if (title != null) slot.kEl.textContent = title;
    slot.vEl.textContent = v;
    slot.dEl.textContent = d || "";
  };

  setSlot(0, !sunNow, null, sunNow ? deg(sunNow.el) : "—", sunNow ? statusDetail(sunNow, sunHor) : "");
  const sunVis = sunNow ? sunNow.el > sunHor : false;
  const nx = sunVis ? st.sunNextSet : st.sunNextRise;
  if (nx) {
    setSlot(1, false, sunVis ? "Next sunset" : "Next sunrise",
      "in " + fmtCountdown(nx.t * 1000 - scrubT),
      fmtUTC(nx.t * 1000) + (useHor ? " (horizon crossing)" : ""));
  } else {
    setSlot(1, false, "Next sun crossing", "—", "no sunrise/sunset inside this window");
  }
  setSlot(2, false, null, deg(st.sunMaxEl), "on " + fmtDay(st.sunMaxT));
  const sunLoss = st.sunPctFlat - st.sunPct;
  setSlot(3, false, null, pct(st.sunPct) + " of window",
    "longest continuous daylight: " + fmtCountdown(st.longestDaylightMs) +
    (useHor && Math.abs(sunLoss) >= 0.05 ? ` · −${sunLoss.toFixed(1)}% vs 0° sphere` : ""));

  setSlot(4, !earthNow, null, earthNow ? deg(earthNow.el) : "—", earthNow ? statusDetail(earthNow, earthHor) : "");
  const earthVis = earthNow ? earthNow.el > earthHor : false;
  const enx = earthVis ? st.earthNextSet : st.earthNextRise;
  const earthLoss = st.earthPctFlat - st.earthPct;
  setSlot(5, false, null, pct(st.earthPct) + " of window",
    `elevation range ${deg(st.earthMinEl)} … ${deg(st.earthMaxEl)}` +
    (st.earthPct < 100 && enx ? ` · next Earth${earthVis ? "set" : "rise"} ${fmtUTC(enx.t * 1000)}` : "") +
    (useHor && Math.abs(earthLoss) >= 0.05 ? ` · −${earthLoss.toFixed(1)}% vs 0°` : ""));

  if (sunNow) {
    const eff = sunVis ? Math.max(0, Math.sin(sunNow.el * Math.PI / 180) * 100) : 0;
    const note = (!sunVis && sunNow.el > 0)
      ? `0% (shaded by ${sunHor.toFixed(1)}° terrain ridge)`
      : "sin(elevation) incidence factor — before panel/temperature limits";
    setSlot(6, false, null, Math.round(eff) + "%", note);
  } else {
    setSlot(6, true, null, "", "");
  }

  const bothLoss = st.bothPctFlat - st.bothPct;
  setSlot(7, false, null, pct(st.bothPct) + " of window",
    "full-operations window (power + direct-to-Earth)" +
    (useHor && Math.abs(bothLoss) >= 0.05 ? ` · −${bothLoss.toFixed(1)}% vs 0°` : ""));

  const elevM = sc.horizon && sc.horizon.elevM != null ? `${Math.round(sc.horizon.elevM)} m` : "—";
  setSlot(8, false, null, `${st.horMin.toFixed(1)}° … ${st.horMax.toFixed(1)}°`,
    `mean ${st.horMean.toFixed(1)}° · LOLA elev ${elevM} · ${horizonLabel(sc)}`);
}

/* ---------------- charts ---------------- */

function setupCanvas(c) {
  if (!c) return null;
  const r = c.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return null;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(50, Math.round(r.width * dpr)), h = Math.max(50, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return [ctx, r.width, r.height];
}

function niceYRange(lo, hi) {
  lo = Math.max(Math.min(lo, -2), -90);   /* az/el never exceed ±90° */
  hi = Math.min(Math.max(hi, 2), 90);
  const span = Math.max(hi - lo, 4);
  const step = [1, 2, 5, 10, 15, 20, 30, 45, 90].find(s => span / s <= 8) || 90;
  let y0 = Math.max(Math.floor(lo / step) * step, -90);
  let y1 = Math.min(Math.ceil(hi / step) * step, 90);
  if (y1 - y0 < step) y1 = Math.min(y0 + step, 90);
  return { y0, y1, step };
}

function timeTicks(t0, t1) {
  const span = t1 - t0;
  const steps = [3600e3, 6*3600e3, 12*3600e3, 86400e3, 2*86400e3, 7*86400e3, 14*86400e3, 30*86400e3, 90*86400e3];
  const step = steps.find(s => span / s <= 10) || 365*86400e3;
  const out = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  return out;
}

/* Elevation vs time. curves: [{series, color, label}] */
function drawElevChart(canvas, t0, t1, curves, scrubMs, yDynamic, horAtFn) {
  const scv = setupCanvas(canvas);
  if (!scv) return;
  const [ctx, W, H] = scv;
  const th = getThemeTokens();
  ctx.clearRect(0, 0, W, H);
  const L = 46, R = 12, T = 10, B = 26;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const showHor = !!horAtFn && curves.length > 0 && horizonMode() !== "flat";
  let lo = Infinity, hi = -Infinity;
  if (yDynamic) {
    for (const c of curves) for (const e of c.series.el) { if (e < lo) lo = e; if (e > hi) hi = e; }
    if (showHor) {
      const s0 = curves[0].series;
      for (let i = 0; i < s0.az.length; i++) {
        const h = horAtFn(s0.az[i]);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
  } else { lo = -90; hi = 90; }
  const yr = yDynamic ? niceYRange(lo, hi) : { y0: -90, y1: 90, step: 30 };
  const y = e => T + (yr.y1 - e) / (yr.y1 - yr.y0) * (H - T - B);

  /* night region below 0° horizon */
  ctx.fillStyle = "rgba(255,255,255,0.045)";
  ctx.fillRect(L, y(0), W - L - R, H - B - y(0));
  /* terrain obstruction band along primary (Sun) azimuth */
  if (showHor) {
    const s0 = curves[0].series;
    const stride = Math.max(1, Math.ceil((s0.el.length - 1) / 800));
    const pts = [];
    for (let i = 0; i < s0.az.length; i += stride) {
      const t = (s0.t0 + i * s0.step) * 1000;
      pts.push([x(t), y(horAtFn(s0.az[i]))]);
    }
    if (pts.length > 1) {
      const y0Px = y(0);
      ctx.fillStyle = "rgba(224, 122, 79, 0.22)";
      ctx.beginPath();
      ctx.moveTo(pts[0][0], y0Px);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.lineTo(pts[pts.length - 1][0], y0Px);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = HORIZON_C; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
      ctx.beginPath();
      pts.forEach(([px, py], idx) => idx === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  /* grid */
  ctx.strokeStyle = th.lineSoft; ctx.fillStyle = th.muted;
  ctx.font = "11px sans-serif"; ctx.lineWidth = 1;
  for (let e = yr.y0; e <= yr.y1; e += yr.step) {
    ctx.beginPath(); ctx.moveTo(L, y(e)); ctx.lineTo(W - R, y(e)); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(e + "°", L - 6, y(e) + 4);
  }
  ctx.textAlign = "center";
  for (const t of timeTicks(t0, t1)) {
    ctx.fillText(fmtDay(t), x(t), H - 8);
  }
  /* horizon */
  ctx.strokeStyle = th.line; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(W - R, y(0)); ctx.stroke();
  ctx.fillStyle = th.muted; ctx.textAlign = "left";
  ctx.fillText(showHor ? "horizon 0° (orange = LOLA terrain @ Sun az)" : "horizon 0°", L + 4, y(0) - 5);

  /* curves */
  for (const c of curves) {
    ctx.strokeStyle = c.color; ctx.lineWidth = 1.6;
    ctx.beginPath();
    const stride = Math.max(1, Math.ceil((c.series.el.length - 1) / 1600));
    let started = false;
    for (let i = 0; i < c.series.el.length; i += stride) {
      const t = c.series.t0 + i * c.series.step;
      const px = x(t * 1000), py = y(c.series.el[i]);
      if (!started) { ctx.moveTo(px, py); started = true; }
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  /* scrub line + dots */
  if (scrubMs != null) {
    const sx = x(scrubMs);
    ctx.strokeStyle = th.accent; ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(sx, T); ctx.lineTo(sx, H - B); ctx.stroke();
    ctx.setLineDash([]);
    for (const c of curves) {
      const p = interp(c.series, scrubMs / 1000);
      if (!p) continue;
      ctx.fillStyle = c.color;
      ctx.beginPath(); ctx.arc(sx, y(p.el), 4.5, 0, 7); ctx.fill();
    }
  }
}

/* Sky dome: N up, E left; center = zenith (90°). */
function drawDome(canvas, sc, scrubMs) {
  const scv = setupCanvas(canvas);
  if (!scv) return;
  const [ctx, W, H] = scv;
  const th = getThemeTokens();
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.max(10, Math.min(W, H) / 2 - 26);
  const pt = (az, el) => {
    const a = az * Math.PI / 180;
    const r = R * (1 - Math.max(0, el) / 90);
    return [cx - r * Math.sin(a), cy - r * Math.cos(a)];
  };
  ctx.fillStyle = th.bgElevated;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

  /* terrain horizon mask ring around dome perimeter */
  const showHor = horizonMode() !== "flat";
  if (showHor) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2, false);
    const [sx0, sy0] = pt(0, Math.min(90, Math.max(0, horizonAt(sc, 0))));
    ctx.moveTo(sx0, sy0);
    for (let az = 359; az >= 0; az--) {
      const [hx, hy] = pt(az, Math.min(90, Math.max(0, horizonAt(sc, az))));
      ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(224, 122, 79, 0.24)";
    ctx.fill("evenodd");

    ctx.beginPath();
    for (let az = 0; az <= 360; az++) {
      const [hx, hy] = pt(az, Math.min(90, Math.max(0, horizonAt(sc, az))));
      if (az === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
    }
    ctx.strokeStyle = HORIZON_C; ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  ctx.strokeStyle = th.line; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.font = "11px sans-serif"; ctx.fillStyle = th.muted; ctx.textAlign = "center";
  ctx.fillText("N", cx, cy - R - 8); ctx.fillText("S", cx, cy + R + 16);
  ctx.textAlign = "left"; ctx.fillText("W", cx - R - 18, cy + 4);
  ctx.textAlign = "right"; ctx.fillText("E", cx + R + 18, cy + 4);
  for (const e of [30, 60]) {
    const r = R * (1 - e / 90);
    ctx.strokeStyle = th.lineSoft; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 7); ctx.stroke();
    ctx.fillStyle = th.muted; ctx.textAlign = "left";
    ctx.fillText("+" + e + "°", cx + 4, cy - r + 12);
  }
  ctx.fillText("zenith", cx + 4, cy + 3);

  /* paths: clear-sky segments vs terrain-occluded segments */
  const drawPath = (series, color) => {
    const n = series.el.length;
    const stride = Math.max(1, Math.ceil(n / 400));
    const trace = (pred) => {
      let pen = false;
      ctx.beginPath();
      for (let i = 0; i < n; i += stride) {
        if (pred(series.az[i], series.el[i])) {
          const [px, py] = pt(series.az[i], series.el[i]);
          if (!pen) { ctx.moveTo(px, py); pen = true; }
          else ctx.lineTo(px, py);
        } else pen = false;
      }
      ctx.stroke();
    };
    if (showHor) {
      ctx.save();
      ctx.strokeStyle = color; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.1; ctx.setLineDash([3, 3]);
      trace((az, el) => el > 0 && el <= horizonAt(sc, az));
      ctx.restore();
    }
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    trace((az, el) => el > horizonAt(sc, az));
  };
  drawPath(sc.sun, SUN_C);
  drawPath(sc.earth, EARTH_C);

  /* current positions */
  const belowNotes = [];
  const drawNow = (series, color, label) => {
    const p = interp(series, scrubMs / 1000);
    if (!p) return;
    const hor = horizonAt(sc, p.az);
    if (p.el > hor) {
      const [px, py] = pt(p.az, p.el);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 7); ctx.fill();
      ctx.fillStyle = th.text; ctx.textAlign = "left"; ctx.font = "12px sans-serif";
      ctx.fillText(`${label} ${p.el.toFixed(1)}°`, px + 10, py - 8);
    } else if (p.el > 0) {
      const [px, py] = pt(p.az, p.el);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.stroke();
      belowNotes.push({ color, text: `${label} ${p.el.toFixed(1)}° — blocked by ${hor.toFixed(1)}° ridge` });
    } else {
      /* below horizon: hollow marker at the horizon edge, text moved to a corner */
      const [px, py] = pt(p.az, 0);
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 7); ctx.stroke();
      belowNotes.push({ color, text: `${label} ${p.el.toFixed(1)}° — below horizon` });
    }
  };
  drawNow(sc.earth, EARTH_C, "Earth");
  drawNow(sc.sun, SUN_C, "Sun");
  belowNotes.forEach((n, i) => {
    ctx.font = (W < 380 ? "10px" : "11px") + " sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = n.color;
    const text = W < 340 ? n.text.replace("below horizon", "below hor.") : n.text;
    ctx.fillText(text, 10, H - 10 - (belowNotes.length - 1 - i) * 14, Math.max(80, W - 20));
  });
  /* legend */
  ctx.textAlign = "right"; ctx.font = "11px sans-serif";
  ctx.fillStyle = SUN_C; ctx.fillText("Sun path", W - 10, 16);
  ctx.fillStyle = EARTH_C; ctx.fillText("Earth path", W - 10, 32);
  if (showHor) {
    ctx.fillStyle = HORIZON_C; ctx.fillText("Terrain mask", W - 10, 48);
  }
}

/** 360-degree terrain horizon panorama (azimuth vs elevation) with Sun/Earth tracks. */
function drawHorizonChart(canvas, sc, scrubMs) {
  const scv = setupCanvas(canvas);
  if (!scv) return;
  const [ctx, W, H] = scv;
  const th = getThemeTokens();
  ctx.clearRect(0, 0, W, H);
  const L = 46, R = 14, T = 20, B = 26;
  const x = az => L + (az / 360) * (W - L - R);

  const horVals = new Array(361);
  let lo = Infinity, hi = -Infinity, peakEl = -1, peakAz = 0, horSum = 0;
  for (let az = 0; az <= 360; az++) {
    const h = horizonAt(sc, az);
    horVals[az] = h;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
    if (az < 360) {
      horSum += h;
      if (h > peakEl) { peakEl = h; peakAz = az; }
    }
  }
  for (const s of [sc.sun, sc.earth]) {
    for (const e of s.el) {
      if (e < lo) lo = e;
      if (e > hi) hi = e;
    }
  }
  lo = Math.max(-25, Math.min(0, lo));
  hi = Math.max(4, hi);
  const yr = niceYRange(lo, hi);
  const y = e => T + (yr.y1 - e) / (yr.y1 - yr.y0) * (H - T - B);

  /* below-0° band */
  if (yr.y0 < 0) {
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fillRect(L, y(0), W - L - R, H - B - y(0));
  }

  /* elevation & compass grid */
  ctx.strokeStyle = th.lineSoft; ctx.fillStyle = th.muted;
  ctx.font = "11px sans-serif"; ctx.lineWidth = 1;
  for (let e = yr.y0; e <= yr.y1; e += yr.step) {
    ctx.beginPath(); ctx.moveTo(L, y(e)); ctx.lineTo(W - R, y(e)); ctx.stroke();
    ctx.textAlign = "right"; ctx.fillText(e + "°", L - 6, y(e) + 4);
  }
  const dirs = [[0, "0° N"], [45, "45° NE"], [90, "90° E"], [135, "135° SE"],
    [180, "180° S"], [225, "225° SW"], [270, "270° W"], [315, "315° NW"], [360, "360° N"]];
  ctx.textAlign = "center";
  for (const [az, lbl] of dirs) {
    const px = x(az);
    ctx.strokeStyle = az % 90 === 0 ? th.line : th.lineSoft;
    ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, H - B); ctx.stroke();
    ctx.fillStyle = th.muted;
    ctx.fillText(lbl, px, H - 8);
  }

  /* 0° baseline */
  ctx.strokeStyle = th.line; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(L, y(0)); ctx.lineTo(W - R, y(0)); ctx.stroke();

  /* LOLA terrain silhouette */
  ctx.fillStyle = "rgba(224, 122, 79, 0.28)";
  ctx.beginPath();
  ctx.moveTo(x(0), H - B);
  for (let az = 0; az <= 360; az++) ctx.lineTo(x(az), y(horVals[az]));
  ctx.lineTo(x(360), H - B);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = HORIZON_C; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let az = 0; az <= 360; az++) {
    const px = x(az), py = y(horVals[az]);
    if (az === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  if (horizonMode() === "lola15" && yr.y1 >= 1.5) {
    ctx.strokeStyle = "rgba(224, 122, 79, 0.55)"; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(L, y(1.5)); ctx.lineTo(W - R, y(1.5)); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* Sun & Earth tracks (split across 0/360 azimuth wrap) */
  const drawAzTrack = (series, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    const stride = Math.max(1, Math.ceil((series.el.length - 1) / 1400));
    let pen = false, prevAz = null;
    ctx.beginPath();
    for (let i = 0; i < series.el.length; i += stride) {
      const az = ((series.az[i] % 360) + 360) % 360;
      const el = series.el[i];
      if (el < yr.y0 - 5) { pen = false; prevAz = az; continue; }
      const px = x(az), py = y(el);
      if (!pen || Math.abs(az - prevAz) > 180) { ctx.moveTo(px, py); pen = true; }
      else ctx.lineTo(px, py);
      prevAz = az;
    }
    ctx.stroke();
  };
  drawAzTrack(sc.earth, EARTH_C);
  drawAzTrack(sc.sun, SUN_C);

  /* peak ridge callout */
  if (peakEl > 0.3 && !horizonMode().startsWith("flat")) {
    const dKm = horizonDistAt(sc, peakAz);
    const px = x(peakAz), py = y(peakEl);
    ctx.fillStyle = HORIZON_C;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, 7); ctx.fill();
    ctx.font = "11px sans-serif";
    ctx.textAlign = peakAz > 250 ? "right" : peakAz < 110 ? "left" : "center";
    const tx = peakAz > 250 ? px - 6 : peakAz < 110 ? px + 6 : px;
    const distTxt = dKm ? ` (${dKm.toFixed(1)} km)` : "";
    ctx.fillText(`max ridge ${peakEl.toFixed(1)}° @ ${peakAz}°${distTxt}`, tx, Math.max(T + 10, py - 6));
  }

  /* current scrub markers */
  if (scrubMs != null) {
    for (const [series, color, label] of [[sc.earth, EARTH_C, "Earth"], [sc.sun, SUN_C, "Sun"]]) {
      const p = interp(series, scrubMs / 1000);
      if (!p) continue;
      const az = ((p.az % 360) + 360) % 360;
      const px = x(az), py = y(Math.max(yr.y0, p.el));
      const clear = p.el > horizonAt(sc, az);
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 7);
      if (clear) { ctx.fillStyle = color; ctx.fill(); }
      else { ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = color; ctx.font = "11px sans-serif";
      const rightSide = az > 290;
      ctx.textAlign = rightSide ? "right" : "left";
      ctx.fillText(`${label} ${p.el.toFixed(1)}°`, px + (rightSide ? -8 : 8), Math.max(T + 11, Math.min(H - B - 4, py - 4)));
    }
  }

  /* compact top-right legend */
  ctx.font = "11px sans-serif"; ctx.textAlign = "right";
  ctx.fillStyle = SUN_C; ctx.fillText("Sun track", W - R - 175, 13);
  ctx.fillStyle = EARTH_C; ctx.fillText("Earth track", W - R - 105, 13);
  ctx.fillStyle = HORIZON_C; ctx.fillText(`Terrain (avg ${(horSum / 360).toFixed(1)}°)`, W - R, 13);
}

/** Spatial cross-section showing lunar curvature, ridge silhouette, and Sun/Earth rays. */
function drawGeometryDiagram(canvas, scOrData, scrubMs) {
  const scv = setupCanvas(canvas);
  if (!scv) return;
  const [ctx, W, H] = scv;
  if (W < 80 || H < 80) return;

  const th = getThemeTokens();
  ctx.clearRect(0, 0, W, H);

  let sunEl = 0, earthEl = 0, horSun = 0, horEarth = 0, ridgeDist = null;
  if (scOrData && scOrData.sun && Array.isArray(scOrData.sun.el)) {
    const tSec = (scrubMs != null ? scrubMs : scOrData.startMs) / 1000;
    const sunNow = interp(scOrData.sun, tSec);
    const earthNow = interp(scOrData.earth, tSec);
    sunEl = sunNow ? sunNow.el : 0;
    earthEl = earthNow ? earthNow.el : 0;
    horSun = sunNow ? horizonAt(scOrData, sunNow.az) : 0;
    horEarth = earthNow ? horizonAt(scOrData, earthNow.az) : 0;
    ridgeDist = sunNow ? horizonDistAt(scOrData, sunNow.az) : null;
  } else {
    const d = scOrData || {};
    sunEl = d.sunEl || 0;
    earthEl = d.earthEl || 0;
    horSun = d.ridgeEl || 0;
    horEarth = d.earthRidgeEl != null ? d.earthRidgeEl : 0;
    ridgeDist = d.ridgeDistKm != null ? d.ridgeDistKm : null;
  }

  const xL = W * 0.24, yL = H * 0.72;
  const xM = W * 0.68;
  const maxAng = Math.max(12, Math.abs(sunEl) * 1.15, Math.abs(earthEl) * 1.15, horSun * 1.35);
  const yAtAngle = (ang, fracX = 1) => yL - (ang / maxAng) * (H * 0.44) * fracX;

  /* 1. Curved lunar surface mass */
  ctx.fillStyle = th.bgElevated;
  ctx.beginPath();
  ctx.moveTo(0, H);
  ctx.lineTo(0, yL + 16);
  ctx.quadraticCurveTo(xL, yL - 8, W, yL + 22);
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();

  /* 2. 0-deg airless sphere horizon reference */
  ctx.strokeStyle = "rgba(148, 163, 184, 0.36)";
  ctx.lineWidth = 1.2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(xL, yL);
  ctx.lineTo(W - 24, yL);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = th.muted;
  ctx.font = "10.5px sans-serif";
  ctx.textAlign = "right";
  const horizonText = W < 440
    ? "0° Sphere Horizon (0° refraction)"
    : "0° Sphere Horizon (R = 1,737.4 km · 0° airless refraction)";
  ctx.fillText(horizonText, W - 24, yL + 15);

  /* 3. Crater ridge silhouette along Sun azimuth */
  const yPeak = yAtAngle(horSun, 1);
  if (horSun > 0.05) {
    ctx.fillStyle = "rgba(148, 163, 184, 0.24)";
    ctx.beginPath();
    ctx.moveTo(xM - 68, yL + 10);
    ctx.lineTo(xM - 28, yL - (yL - yPeak) * 0.55);
    ctx.lineTo(xM, yPeak);
    ctx.lineTo(xM + 36, yL - (yL - yPeak) * 0.42);
    ctx.lineTo(W - 14, yL + 16);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = th.horizon;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xM - 68, yL + 10);
    ctx.lineTo(xM - 28, yL - (yL - yPeak) * 0.55);
    ctx.lineTo(xM, yPeak);
    ctx.lineTo(xM + 36, yL - (yL - yPeak) * 0.42);
    ctx.lineTo(W - 14, yL + 16);
    ctx.stroke();

    const distTxt = ridgeDist != null ? ` (${ridgeDist.toFixed(0)} km away)` : "";
    ctx.fillStyle = th.text;
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Ridge ${horSun.toFixed(1)}°${distTxt}`, xM, Math.min(yL - 10, yPeak - 10));
  }

  /* 4. Curved lunar limb outline */
  ctx.strokeStyle = "rgba(148, 163, 184, 0.55)";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(0, yL + 16);
  ctx.quadraticCurveTo(xL, yL - 8, W, yL + 22);
  ctx.stroke();

  /* 5. Sun ray vector */
  const sunClear = sunEl > horSun;
  const sunEndX = W - 26;
  const sunEndY = Math.max(24, Math.min(H - 22, yAtAngle(sunEl, (sunEndX - xL) / (xM - xL))));

  if (sunEl > 0) {
    if (sunClear) {
      ctx.strokeStyle = th.sun;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(xL, yL);
      ctx.lineTo(sunEndX, sunEndY);
      ctx.stroke();

      ctx.fillStyle = th.sun;
      ctx.beginPath();
      ctx.arc(sunEndX, sunEndY, 7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const yHit = yAtAngle(sunEl, 1);
      ctx.strokeStyle = th.sun;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(xM, yHit);
      ctx.lineTo(sunEndX, sunEndY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = "rgba(242, 193, 78, 0.35)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(xL, yL);
      ctx.lineTo(xM, yHit);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = th.sun;
      ctx.beginPath();
      ctx.arc(xM, yHit, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.fillStyle = th.sun;
  ctx.font = "600 11.5px sans-serif";
  ctx.textAlign = "left";
  const sunState = sunClear ? "Sunlit" : (sunEl > 0 ? "Blocked by ridge" : "Below horizon");
  ctx.fillText(`Sun ${sunEl >= 0 ? "+" : ""}${sunEl.toFixed(1)}° · ${sunState}`, 16, 22);

  /* 6. Earth signal vector */
  const earthClear = earthEl > horEarth;
  const earthEndX = W - 64;
  const earthEndY = Math.max(44, Math.min(H - 22, yAtAngle(earthEl, (earthEndX - xL) / (xM - xL))));

  if (earthEl > 0) {
    ctx.strokeStyle = th.earth;
    ctx.lineWidth = earthClear ? 2 : 1.5;
    if (!earthClear) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xL, yL);
    ctx.lineTo(earthEndX, earthEndY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = th.earth;
    ctx.beginPath();
    ctx.arc(earthEndX, earthEndY, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = th.earth;
  ctx.font = "600 11.5px sans-serif";
  ctx.textAlign = "left";
  const earthState = earthEl > 0 ? (earthClear ? "Direct Link" : "Blocked by ridge") : "Below horizon";
  ctx.fillText(`Earth ${earthEl >= 0 ? "+" : ""}${earthEl.toFixed(1)}° · ${earthState}`, 16, 40);

  /* 7. Lander marker */
  ctx.fillStyle = th.ok;
  ctx.beginPath();
  ctx.arc(xL, yL, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#0b0f17";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = th.text;
  ctx.font = "600 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Lander", xL, yL - 12);
}

/* Operational windows bars. */
function drawWindows(canvas, sc, scrubMs) {
  const scv = setupCanvas(canvas);
  if (!scv) return;
  const [ctx, W, H] = scv;
  const th = getThemeTokens();
  ctx.clearRect(0, 0, W, H);
  const L = 70, R = 12, T = 8, B = 26;
  const hor = az => horizonAt(sc, az);
  const useHor = horizonMode() !== "flat";
  const lanes = [
    { label: "Sun up", color: th.sun, test: i => sc.sun.el[i] > hor(sc.sun.az[i]), flat: i => sc.sun.el[i] > 0 },
    { label: "Earth up", color: th.earth, test: i => sc.earth.el[i] > hor(sc.earth.az[i]), flat: i => sc.earth.el[i] > 0 },
    { label: "Both", color: th.ok,
      test: i => sc.sun.el[i] > hor(sc.sun.az[i]) && sc.earth.el[i] > hor(sc.earth.az[i]),
      flat: i => sc.sun.el[i] > 0 && sc.earth.el[i] > 0 },
  ];
  const laneH = Math.min(30, Math.floor((H - T - B) / lanes.length - 8));
  const t0 = sc.startMs, t1 = sc.endMs;
  const x = t => L + (t - t0) / (t1 - t0) * (W - L - R);
  const n = sc.sun.el.length;
  ctx.font = "11px sans-serif"; ctx.textAlign = "right"; ctx.fillStyle = th.muted;
  const fillRuns = (pred, y0, pad, color) => {
    ctx.fillStyle = color;
    for (let i = 0; i < n - 1; i++) {
      if (!pred(i)) continue;
      const a = x((sc.sun.t0 + i * sc.sun.step) * 1000);
      const b = x((sc.sun.t0 + (i + 1) * sc.sun.step) * 1000);
      ctx.fillRect(a, y0 + pad, Math.max(b - a, 1), laneH - 2 * pad);
    }
  };
  lanes.forEach((ln, li) => {
    const y0 = T + li * (laneH + 8);
    ctx.strokeStyle = th.lineSoft;
    ctx.strokeRect(L, y0, W - L - R, laneH);
    ctx.fillStyle = th.muted;
    ctx.fillText(ln.label, L - 8, y0 + laneH / 2 + 4);
    if (useHor) fillRuns(ln.flat, y0, 2, "rgba(255,255,255,0.11)");
    fillRuns(ln.test, y0, 2, ln.color);
  });
  ctx.fillStyle = th.muted; ctx.textAlign = "center";
  for (const t of timeTicks(t0, t1)) ctx.fillText(fmtDay(t), x(t), H - 8);
  if (scrubMs != null) {
    ctx.strokeStyle = th.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x(scrubMs), T); ctx.lineTo(x(scrubMs), H - B); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawAll() {
  const sc = current;
  if (!sc) return;
  const th = getThemeTokens();
  drawElevChart($("elevChart"), sc.startMs, sc.endMs,
    [{ series: sc.sun, color: th.sun }, { series: sc.earth, color: th.earth }],
    scrubT, true, az => horizonAt(sc, az));
  drawHorizonChart($("horizonChart"), sc, scrubT);
  drawGeometryDiagram($("geomCanvas"), sc, scrubT);
  drawWindows($("windowsChart"), sc, scrubT);
  const st = computeStats(sc, scrubT);
  renderMetrics(st);
  renderScrubReadout(st);
  if (typeof updateMoonGlobe === "function") updateMoonGlobe(sc, scrubT);
}

function renderScrubReadout(precomputedSt) {
  const sc = current;
  const sunNow = interp(sc.sun, scrubT / 1000);
  const earthNow = interp(sc.earth, scrubT / 1000);
  const useHor = horizonMode() !== "flat";
  const fmtBody = (p, elId) => {
    const elNode = $(elId);
    if (!p) { elNode.textContent = "—"; elNode.classList.remove("warn-t"); return; }
    const h = horizonAt(sc, p.az), clr = p.el - h;
    let extra = "";
    if (useHor) {
      extra = clr > 0 ? ` · +${clr.toFixed(1)}° over ${h.toFixed(1)}° ridge`
        : p.el > 0 ? ` · BLOCKED by ${h.toFixed(1)}° ridge` : ` · below 0° (${h.toFixed(1)}° ridge)`;
    }
    elNode.classList.toggle("warn-t", useHor && p.el > 0 && clr <= 0);
    elNode.textContent = `${p.el.toFixed(2)}° el · ${p.az.toFixed(1)}° az${extra}`;
  };
  $("scrubTime").textContent = fmtUTC(scrubT);
  fmtBody(sunNow, "scrubSun");
  fmtBody(earthNow, "scrubEarth");
  const st = precomputedSt || computeStats(sc, scrubT);
  const f = (x) => x ? "in " + fmtCountdown(x.t * 1000 - scrubT) : "— (none in window)";
  $("scrubNextSet").textContent = st.sunNextSet ? f(st.sunNextSet)
    : st.sunNextRise ? "sun down · sunrise " + f(st.sunNextRise) : "—";
  $("scrubNextESet").textContent = st.earthPct === 0
    ? (st.earthMaxEl > 0 ? `blocked by terrain (max ${st.earthMaxEl.toFixed(1)}°)` : "never up in this window (far side?)")
    : st.earthNextSet ? f(st.earthNextSet)
    : st.earthNextRise ? "Earth down · rise " + f(st.earthNextRise)
    : "— (always up in window)";
}

/* ---------------- scrubber & animation ---------------- */

function scrubFromSlider() {
  const sc = current;
  if (!sc) return;
  const v = $("scrub").value / 1000;
  scrubT = sc.startMs + (sc.endMs - sc.startMs) * v;
  drawAll();
}

function setScrub(t) {
  const sc = current;
  if (!sc) return;
  scrubT = Math.min(Math.max(t, sc.startMs), sc.endMs);
  $("scrub").value = Math.round((scrubT - sc.startMs) / (sc.endMs - sc.startMs) * 1000);
  drawAll();
}

function syncPlayButtons() {
  const label = playing ? "❚❚ Pause" : "▶ Play";
  const mainBtn = $("playBtn");
  if (mainBtn) mainBtn.textContent = label;
  const gBtn = $("globePlayBtn");
  if (gBtn) {
    gBtn.textContent = label;
    gBtn.classList.toggle("playing", playing);
    gBtn.setAttribute("aria-pressed", String(playing));
  }
}

function togglePlay() {
  playing = !playing;
  syncPlayButtons();
  if (playing) {
    playT0 = performance.now();
    scrubAtPlay = scrubT;
    rafId = requestAnimationFrame(step);
  } else if (rafId) cancelAnimationFrame(rafId);
}
function step(ts) {
  if (!playing || !current) return;
  const span = current.endMs - current.startMs;
  const speed = span / 60000; /* window plays over ~60 s */
  setScrub(scrubAtPlay + (ts - playT0) * speed);
  if (scrubT >= current.endMs - 1) { playing = false; syncPlayButtons(); return; }
  rafId = requestAnimationFrame(step);
}

/* ---------------- comparison ---------------- */

function compareKey(c) { return JSON.stringify([c.site.id, c.site.lon, c.site.lat, c.startMs, c.dur]); }

function updateCompareCount() {
  const btn = $("compareBtn");
  if (btn) btn.textContent = `Add to comparison (${compares.length}/6)`;
}

function addCompare() {
  if (!current) return;
  const c = { site: current.site, startMs: current.startMs, dur: current.dur, series: current, horizon: current.horizon };
  if (compares.some(x => compareKey(x) === compareKey(c))) { status("Already in comparison."); return; }
  if (compares.length >= 6) { status("Comparison is full (6 scenarios).", true); return; }
  compares.push(c);
  saveCompares();
  updateCompareCount();
  renderCompare();
  status(`Added ${current.site.name} to comparison (${compares.length}/6).`);
}

function saveCompares() { /* persistence is in-memory only (sandboxed previews have no storage) */ }

async function restoreCompares() { /* nothing to restore without storage */ }

async function ensureSeries(c) {
  if (c.series && c.horizon) return c.series;
  const endMs = c.startMs + c.dur * 86400e3;
  const [s, h] = await Promise.all([
    c.series || getSeries(c.site, c.startMs, endMs),
    c.horizon || getHorizon(c.site),
  ]);
  c.series = s;
  c.horizon = h;
  return c.series;
}

function renderCompare() {
  const view = $("compareView");
  if (!compares.length) { view.hidden = true; return; }
  view.hidden = false;
  const theme = getThemeTokens();
  const maskText = typeof horizonLabel === "function"
    ? horizonLabel(current)
    : (horizonMode() === "flat" ? "Flat 0°" : "LRO LOLA horizon");
  $("compareMeta").textContent = `Comparing ${compares.length}/6 scenarios (in-memory) · Horizon mask: ${maskText}`;

  const th = (h) => `<th>${h}</th>`;
  const rows = [];
  for (let i = 0; i < compares.length; i++) {
    const c = compares[i];
    if (!c.series) continue;
    const hor = c.horizon || (c.series && c.series.horizon) ||
      (window.__LSP_HORIZONS && window.__LSP_HORIZONS[c.site.id]);
    const st = computeStats(
      { sun: c.series.sun, earth: c.series.earth, horizon: hor,
        startMs: c.startMs, endMs: c.startMs + c.dur * 86400e3 },
      c.startMs);
    const pct = (x) => (Math.round(x * 10) / 10) + "%";
    const deg = (x) => (x >= 0 ? "+" : "") + (Math.round(x * 100) / 100) + "°";
    rows.push(
      `<tr><td>${c.site.name}</td>` +
      `<td>${fmtDay(c.startMs)}<br><span class="sub">${c.dur} days</span></td>` +
      `<td>${st.horMean.toFixed(1)}° / ${st.horMax.toFixed(1)}°</td>` +
      `<td>${deg(st.sunMaxEl)} <span class="sub">(${fmtDay(st.sunMaxT)})</span></td>` +
      `<td>${pct(st.sunPct)}</td>` +
      `<td>${fmtCountdown(st.longestDaylightMs)}</td>` +
      `<td>${deg(st.earthMinEl)} … ${deg(st.earthMaxEl)}</td>` +
      `<td>${pct(st.earthPct)}</td>` +
      `<td>${pct(st.bothPct)}</td>` +
      `<td><span class="rm" title="remove" data-i="${i}">✕</span></td></tr>`);
  }
  $("compareTable").innerHTML = "<thead><tr>" +
    ["Site", "Window", "Horizon avg/max", "Peak Sun el.", "Sunlit", "Longest daylight",
     "Earth el. range", "Earth up", "Sun+Earth", ""].map(th).join("") +
    "</tr></thead><tbody>" + rows.join("") + "</tbody>";
  $("compareTable").querySelectorAll(".rm").forEach(el =>
    el.addEventListener("click", () => {
      compares.splice(+el.dataset.i, 1); saveCompares(); updateCompareCount(); renderCompare();
    }));

  /* overlay chart: sun elevation for each scenario on a shared absolute-time axis */
  const t0 = Math.min(...compares.map(c => c.startMs));
  const t1 = Math.max(...compares.map(c => c.startMs + c.dur * 86400e3));
  const curves = compares.map((c, i) => ({
    series: c.series.sun,
    color: i === 0 ? theme.sun : i === 1 ? theme.earth : PALETTE[i % PALETTE.length],
    label: c.site.name,
  }));
  const cmpCanvas = $("compareChart");
  const scv = setupCanvas(cmpCanvas);
  if (!scv) return;
  const [ctx, W] = scv;
  drawElevChart(cmpCanvas, t0, t1, curves, null, true);
  ctx.font = "11px sans-serif"; ctx.textAlign = "right";
  curves.forEach((c, i) => {
    ctx.fillStyle = c.color;
    ctx.fillText(c.label, W - 10, 14 + i * 15);
  });
}

/* ---------------- CSV collaboration export / import ---------------- */

function csvEscape(val) {
  const s = val == null ? "" : String(val);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function parseCSVLine(line) {
  const out = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function formatInputUTC(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function scenarioCsvRow(recordType, scObj, refMs) {
  const scForStats = scObj.sun ? scObj : {
    sun: scObj.series.sun,
    earth: scObj.series.earth,
    horizon: scObj.horizon || (scObj.series && scObj.series.horizon),
    startMs: scObj.startMs,
    endMs: scObj.startMs + scObj.dur * 86400e3,
  };
  const st = computeStats(scForStats, refMs || scForStats.startMs);
  const site = scObj.site;
  return [
    recordType,
    site.id || "custom",
    site.name || "",
    Number(site.lat).toFixed(4),
    Number(site.lon).toFixed(4),
    new Date(scObj.startMs).toISOString().slice(0, 16) + "Z",
    scObj.dur,
    horizonMode(),
    new Date(refMs || scObj.startMs).toISOString().slice(0, 16) + "Z",
    st.sunPct.toFixed(2),
    st.earthPct.toFixed(2),
    st.bothPct.toFixed(2),
    (st.longestDaylightMs / 3600e3).toFixed(2),
    st.sunMaxEl.toFixed(2),
    st.horMean.toFixed(2),
    st.horMax.toFixed(2),
  ].map(csvEscape).join(",");
}

function downloadCollaborationCSV() {
  if (!current) {
    status("Load a scenario first before downloading CSV.", true);
    return;
  }
  const sc = current;
  const lines = [
    "# ASTRA CARTO Mission Collaboration Export v1",
    [
      "record_type", "site_id", "site_name", "lat_deg", "lon_deg", "start_utc",
      "duration_days", "horizon_mode", "scrub_utc", "sunlit_pct", "earth_visible_pct",
      "both_visible_pct", "longest_daylight_hr", "peak_sun_el_deg", "horizon_mean_deg", "horizon_max_deg",
    ].join(","),
    scenarioCsvRow("active", sc, scrubT),
  ];
  for (const c of compares) {
    lines.push(scenarioCsvRow("compare", c, c.startMs));
  }

  lines.push("");
  lines.push("# Hourly Ephemeris (Active Scenario)");
  lines.push([
    "time_utc", "sun_az_deg", "sun_el_deg", "horizon_sun_deg", "sun_clear_deg", "sun_up",
    "earth_az_deg", "earth_el_deg", "horizon_earth_deg", "earth_clear_deg", "earth_up", "both_up",
  ].join(","));

  const nPts = sc.sun.el.length;
  const earthAligned = sc.earth.t0 === sc.sun.t0 && sc.earth.step === sc.sun.step;
  for (let i = 0; i < nPts; i++) {
    const tSec = sc.sun.t0 + i * sc.sun.step;
    const sAz = sc.sun.az[i], sEl = sc.sun.el[i];
    const hS = horizonAt(sc, sAz);
    const clrS = sEl - hS;
    const sUp = clrS > 0 ? 1 : 0;
    const ePt = (earthAligned && i < sc.earth.el.length)
      ? { az: sc.earth.az[i], el: sc.earth.el[i] }
      : interp(sc.earth, tSec);
    const eAz = ePt ? ePt.az : 0;
    const eEl = ePt ? ePt.el : -90;
    const hE = horizonAt(sc, eAz);
    const clrE = eEl - hE;
    const eUp = (ePt && clrE > 0) ? 1 : 0;
    lines.push([
      new Date(tSec * 1000).toISOString().slice(0, 16) + "Z",
      sAz.toFixed(2), sEl.toFixed(2), hS.toFixed(2), clrS.toFixed(2), sUp,
      eAz.toFixed(2), eEl.toFixed(2), hE.toFixed(2), clrE.toFixed(2), eUp, (sUp && eUp) ? 1 : 0,
    ].map(csvEscape).join(","));
  }

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = String(sc.site.id || "custom").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  const day = new Date(sc.startMs).toISOString().slice(0, 10);
  a.href = url;
  a.download = `astra-carto-${slug}-${day}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const cmpNote = compares.length ? `active + ${compares.length} compared, ` : "";
  status(`Downloaded ${a.download} (${cmpNote}${nPts} hourly rows).`);
}

function parseUtcField(raw) {
  const s = String(raw || "").trim();
  if (!s) return NaN;
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : s.replace(" ", "T") + "Z";
  return Date.parse(iso);
}

function resolveCsvSite(siteId, siteName, lat, lon) {
  const idMatch = siteId && siteId !== "custom" ? SITES.find(s => s.id === siteId) : null;
  if (idMatch) return idMatch;
  const nameMatch = siteName ? SITES.find(s => s.name === siteName) : null;
  if (nameMatch) return nameMatch;
  return {
    id: "custom",
    name: siteName || `Custom site (${lon}°E, ${lat}°)`,
    lon,
    lat,
    approx: false,
  };
}

function parseCollaborationCSV(text) {
  const rawLines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  let headers = null;
  const rows = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) {
      if (headers && rows.length) break;
      continue;
    }
    const cols = parseCSVLine(raw);
    if (!headers) {
      headers = cols.map(c => c.trim().toLowerCase());
      continue;
    }
    if (cols[0] && cols[0].trim().toLowerCase() === "time_utc") break;
    const get = (name) => {
      const idx = headers.indexOf(name);
      return idx >= 0 && idx < cols.length ? cols[idx].trim() : "";
    };
    const lat = parseFloat(get("lat_deg"));
    const lon = parseFloat(get("lon_deg"));
    const startMs = parseUtcField(get("start_utc"));
    const dur = parseInt(get("duration_days") || "30", 10);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(startMs) || !Number.isFinite(dur) || dur < 1) {
      continue;
    }
    const scrubMs = parseUtcField(get("scrub_utc"));
    rows.push({
      recordType: (get("record_type") || "active").toLowerCase(),
      siteId: get("site_id"),
      siteName: get("site_name"),
      lat,
      lon,
      startMs: Math.round(startMs / 3600e3) * 3600e3,
      dur: Math.min(365, Math.max(1, dur)),
      horMode: get("horizon_mode").toLowerCase(),
      scrubMs: Number.isFinite(scrubMs) ? scrubMs : NaN,
    });
  }
  return rows;
}

async function uploadCollaborationCSV(file) {
  if (!file) return;
  try {
    const rows = parseCollaborationCSV(await file.text());
    if (!rows.length) {
      status("No valid scenario rows found in the uploaded CSV file.", true);
      return;
    }
    const activeRow = rows.find(r => r.recordType === "active") || rows[0];
    const compareRows = rows.filter(r => r !== activeRow && r.recordType === "compare").slice(0, 6);

    const activeSite = resolveCsvSite(activeRow.siteId, activeRow.siteName, activeRow.lat, activeRow.lon);
    $("siteSelect").value = activeSite.id === "custom" ? "custom" : activeSite.id;
    $("customCoords").hidden = $("siteSelect").value !== "custom";
    if (activeSite.id === "custom") {
      $("latInput").value = activeSite.lat;
      $("lonInput").value = activeSite.lon;
    }
    $("startInput").value = formatInputUTC(activeRow.startMs);

    const durSel = $("durationSelect");
    const durStr = String(activeRow.dur);
    if (!Array.from(durSel.options).some(o => o.value === durStr)) {
      durSel.add(new Option(`${activeRow.dur} days`, durStr));
    }
    durSel.value = durStr;

    if (["lola", "lola15", "flat15", "flat"].includes(activeRow.horMode)) {
      $("horizonSelect").value = activeRow.horMode;
    }

    await loadScenario();
    if (current && Number.isFinite(activeRow.scrubMs)) {
      setScrub(activeRow.scrubMs);
    }
    if (typeof flyGlobeTo === "function") {
      flyGlobeTo(activeSite.lat, activeSite.lon, null, true);
    }

    compares = [];
    for (const r of compareRows) {
      if (compares.length >= 6) break;
      const cSite = resolveCsvSite(r.siteId, r.siteName, r.lat, r.lon);
      const item = { site: cSite, startMs: r.startMs, dur: r.dur, series: null, horizon: null };
      if (compares.some(x => compareKey(x) === compareKey(item))) continue;
      await ensureSeries(item);
      compares.push(item);
    }
    saveCompares();
    updateCompareCount();
    renderCompare();

    const cmpNote = compares.length ? ` and ${compares.length} comparison scenario(s)` : "";
    status(`Loaded ${activeSite.name}${cmpNote} from ${file.name}.`);
  } catch (e) {
    status("Could not import CSV: " + e.message, true);
  }
}

/* ---------------- UI wiring ---------------- */

async function loadScenario() {
  const sel = $("siteSelect");
  let site;
  if (sel.value === "custom") {
    const lat = parseFloat($("latInput").value);
    const lon = parseFloat($("lonInput").value);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 360) {
      status("Enter valid coordinates (lat -90..90, lon -180..360).", true);
      return;
    }
    site = { id: "custom", name: `Custom site (${lon}°E, ${lat}°)`, lon, lat, approx: false };
  } else {
    site = SITES.find(s => s.id === sel.value);
  }
  if (!site) return;

  const v = $("startInput").value.trim();
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2}))?$/.exec(v);
  if (!m) {
    status("Enter a valid UTC start date and time (YYYY-MM-DDTHH:MM).", true);
    return;
  }
  let startMs = Date.parse(m[1] + ":" + (m[2] || "00") + "Z");
  if (!Number.isFinite(startMs)) {
    status("Enter a valid UTC start date and time.", true);
    return;
  }
  startMs = Math.round(startMs / 3600e3) * 3600e3; /* snap to whole UTC hour */
  const dur = parseInt($("durationSelect").value, 10);
  const endMs = startMs + dur * 86400e3;

  const seq = ++loadSeq;
  if (playing) togglePlay();
  const loadBtn = $("loadBtn");
  loadBtn.disabled = true;

  const useCache = site.id !== "custom" && startMs / 1000 >= CACHE_START && endMs / 1000 <= CACHE_END;
  status(useCache ? "Loading cached Horizons & LOLA data…" :
    "Fetching live from JPL Horizons & LRO LOLA DEM (this can take ~10 s)…");

  let res, hor;
  try {
    [res, hor] = await Promise.all([getSeries(site, startMs, endMs), getHorizon(site)]);
  } catch (e) {
    if (seq === loadSeq) {
      loadBtn.disabled = false;
      status("Could not load scenario: " + e.message +
        " — live fetches need internet access to JPL Horizons via a CORS relay; try a curated site/date.", true);
    }
    return;
  }
  if (seq !== loadSeq) return;

  current = { site, startMs, endMs, dur, sun: res.sun, earth: res.earth, horizon: hor, source: res.source };
  $("scrub").value = 0;
  try {
    renderScenario();
  } catch (e) {
    loadBtn.disabled = false;
    status("Scenario loaded, but rendering failed: " + e.message, true);
    return;
  }
  loadBtn.disabled = false;

  const isLolaFallback = horizonMode() !== "flat" && hor.source === "flat-fallback";
  const horSrc = hor.source === "flat-fallback" ? "flat 0° horizon fallback" : "LRO LOLA horizon";
  const ephemSrc = res.source === "cache"
    ? "precomputed"
    : res.source === "selenographic-cache" ? "precomputed (selenographic)" : "live";
  status(
    `Loaded ${site.name} · ${ephemSrc} ephemeris · ${horSrc}.` +
    (isLolaFallback ? " (LOLA terrain unavailable; using 0° horizon.)" : ""),
    isLolaFallback
  );
}

/* ---------------- Interactive 3D Lunar Globe ---------------- */

let moonGlobe = null;

function normVec3(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function dotVec3(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossVec3(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function rotateAroundAxis(v, k, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const kv = dotVec3(k, v);
  const kxv = crossVec3(k, v);
  return {
    x: v.x * c + kxv.x * s + k.x * kv * (1 - c),
    y: v.y * c + kxv.y * s + k.y * kv * (1 - c),
    z: v.z * c + kxv.z * s + k.z * kv * (1 - c),
  };
}

function slerpUnitVec(a, b, t) {
  const d = Math.max(-1, Math.min(1, dotVec3(a, b)));
  if (d > 0.9995) {
    return normVec3({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    });
  }
  const theta = Math.acos(d);
  const s = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / s;
  const w1 = Math.sin(t * theta) / s;
  return normVec3({
    x: a.x * w0 + b.x * w1,
    y: a.y * w0 + b.y * w1,
    z: a.z * w0 + b.z * w1,
  });
}

function buildLunarAlbedoHeightPixels(W, H) {
  const maria = [
    { lat: 18.0,  lon: -57.0, rx: 32, ry: 38, d: 0.44 }, /* Oceanus Procellarum */
    { lat: 8.0,   lon: -38.0, rx: 20, ry: 22, d: 0.34 },
    { lat: 33.0,  lon: -16.0, rx: 19, ry: 17, d: 0.48 }, /* Mare Imbrium */
    { lat: 28.0,  lon: 17.5,  rx: 12, ry: 11, d: 0.46 }, /* Mare Serenitatis */
    { lat: 8.5,   lon: 31.4,  rx: 15, ry: 12, d: 0.48 }, /* Mare Tranquillitatis (SW edge @ 0.67N, 23.47E) */
    { lat: -7.8,  lon: 51.3,  rx: 12, ry: 13, d: 0.42 }, /* Mare Fecunditatis */
    { lat: 17.0,  lon: 59.1,  rx: 8.5, ry: 7.5, d: 0.50 }, /* Mare Crisium */
    { lat: -15.2, lon: 34.6,  rx: 7,  ry: 7,  d: 0.42 }, /* Mare Nectaris */
    { lat: 13.3,  lon: 3.6,   rx: 6,  ry: 5,  d: 0.36 }, /* Mare Vaporum */
    { lat: -21.3, lon: -16.6, rx: 13, ry: 11, d: 0.40 }, /* Mare Nubium */
    { lat: -24.4, lon: -38.6, rx: 8,  ry: 7.5, d: 0.42 }, /* Mare Humorum */
    { lat: -10.0, lon: -23.1, rx: 7,  ry: 7,  d: 0.38 }, /* Mare Cognitum */
    { lat: 56.0,  lon: 1.4,   rx: 28, ry: 6,  d: 0.36 }, /* Mare Frigoris */
    { lat: -38.9, lon: 93.0,  rx: 14, ry: 12, d: 0.30 }, /* Mare Australe */
    { lat: -19.4, lon: -92.8, rx: 7.5, ry: 7.5, d: 0.42 }, /* Mare Orientale */
    { lat: 27.3,  lon: 147.9, rx: 6,  ry: 5.5, d: 0.44 }, /* Mare Moscoviense */
    { lat: -53.0, lon: -169.0, rx: 32, ry: 28, d: 0.24 }, /* South Pole-Aitken Basin */
  ].map(m => ({
    ...m,
    u: latLonToVec(m.lat, m.lon),
    b: siteBasis(m.lat, m.lon),
    rxR: m.rx * D2R,
    ryR: m.ry * D2R,
  }));

  /* Deterministic procedural craters: bright highland ray craters + regional craters */
  const rayCraters = [
    { lat: -43.3, lon: -11.2, r: 4.5, ray: 0.28 }, /* Tycho */
    { lat: 9.6,   lon: -20.1, r: 4.0, ray: 0.24 }, /* Copernicus */
    { lat: 8.1,   lon: -38.0, r: 2.2, ray: 0.18 }, /* Kepler */
    { lat: 23.7,  lon: -47.4, r: 2.4, ray: 0.24 }, /* Aristarchus */
    { lat: -89.6, lon: 129.4, r: 3.0, ray: 0.12 }, /* Shackleton region */
    { lat: -20.5, lon: -158.0, r: 5.0, ray: 0.18 }, /* Farside highland crater */
  ];
  const craters = [];
  let seed = 133791;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const rc of rayCraters) {
    craters.push({ u: latLonToVec(rc.lat, rc.lon), rad: rc.r * D2R, ray: rc.ray, cosMax: Math.cos(rc.r * D2R * 4.2) });
  }
  for (let i = 0; i < 88; i++) {
    const z = rnd() * 2 - 1;
    const lat = Math.asin(z) / D2R;
    const lon = (rnd() * 360) - 180;
    const radDeg = 1.6 + rnd() * rnd() * 9.5;
    craters.push({ u: latLonToVec(lat, lon), rad: radDeg * D2R, ray: 0, cosMax: Math.cos(radDeg * D2R * 1.65) });
  }

  const hash3 = (ix, iy, iz) => {
    let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(iz, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const noise3 = (x, y, z) => {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    const fx = x - ix, fy = y - iy, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
    const lerp = (a, b, t) => a + (b - a) * t;
    return lerp(
      lerp(lerp(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), ux), lerp(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), ux), uy),
      lerp(lerp(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), ux), lerp(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), ux), uy),
      uz
    );
  };

  const out = new Uint8Array(W * H * 4);
  for (let py = 0; py < H; py++) {
    const lat = (0.5 - (py + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let px = 0; px < W; px++) {
      const lon = ((px + 0.5) / W - 0.5) * 2 * Math.PI;
      const vx = cl * Math.cos(lon), vy = sl, vz = -cl * Math.sin(lon);

      const n1 = noise3(vx * 3.5 + 10, vy * 3.5 + 10, vz * 3.5 + 10);
      const n2 = noise3(vx * 9.0 + 23, vy * 9.0 + 23, vz * 9.0 + 23);
      const n3 = noise3(vx * 22.0 + 47, vy * 22.0 + 47, vz * 22.0 + 47);
      const fbm = n1 * 0.55 + n2 * 0.30 + n3 * 0.15;

      let mareMask = 0;
      for (let i = 0; i < maria.length; i++) {
        const m = maria[i];
        const d = vx * m.u.x + vy * m.u.y + vz * m.u.z;
        if (d < 0.25) continue;
        const dx = (vx * m.b.E.x + vy * m.b.E.y + vz * m.b.E.z) / m.rxR;
        const dy = (vx * m.b.N.x + vy * m.b.N.y + vz * m.b.N.z) / m.ryR;
        const er = Math.sqrt(dx * dx + dy * dy) + (fbm - 0.5) * 0.32;
        if (er < 1.0) {
          const w = (1 - er * er) * m.d;
          if (w > mareMask) mareMask = w;
        }
      }

      let craterH = 0;
      let ejecta = 0;
      for (let i = 0; i < craters.length; i++) {
        const cr = craters[i];
        const d = vx * cr.u.x + vy * cr.u.y + vz * cr.u.z;
        if (d < cr.cosMax) continue;
        const ang = Math.acos(Math.max(-1, Math.min(1, d)));
        const r = ang / cr.rad;
        if (r < 1.55) {
          if (r < 0.86) {
            const k = r / 0.86;
            craterH -= 0.22 * (1 - k * k);
          } else {
            const k = (r - 1.0) / 0.35;
            craterH += 0.16 * Math.exp(-k * k);
            ejecta += 0.06 * Math.exp(-k * k);
          }
        }
        if (cr.ray > 0 && r > 0.9 && r < 4.2) {
          const azNoise = noise3(vx * 14 + i, vy * 14, vz * 14);
          if (azNoise > 0.48) {
            ejecta += cr.ray * (1 - r / 4.2) * (azNoise - 0.48) * 1.9;
          }
        }
      }

      const albedo = Math.max(0.18, Math.min(0.95, 0.64 + (fbm - 0.5) * 0.24 - mareMask * 0.58 + ejecta));
      const height = Math.max(0.0, Math.min(1.0, 0.52 + (fbm - 0.5) * 0.42 - mareMask * 0.26 + craterH));
      const idx = (py * W + px) * 4;
      out[idx]     = Math.round(albedo * 246);
      out[idx + 1] = Math.round(albedo * 244);
      out[idx + 2] = Math.round(albedo * 238);
      out[idx + 3] = Math.round(height * 255);
    }
  }
  return out;
}

function initMoonGlobeWebGL(glCanvas) {
  const gl = glCanvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true });
  if (!gl) return null;

  const vsSrc = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;
  const fsSrc = `
    precision highp float;
    uniform vec2 uRes;
    uniform vec3 uCamPos;
    uniform vec3 uCamR;
    uniform vec3 uCamU;
    uniform vec3 uCamF;
    uniform float uTanHalf;
    uniform vec3 uSunDir;
    uniform vec3 uEarthPos;
    uniform sampler2D uTex;

    float hash31(vec3 p) {
      p = fract(p * 0.1031);
      p += dot(p, p.yzx + 33.33);
      return fract((p.x + p.y) * p.z);
    }

    float noise3D(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(hash31(i), hash31(i + vec3(1.0,0.0,0.0)), f.x),
            mix(hash31(i + vec3(0.0,1.0,0.0)), hash31(i + vec3(1.0,1.0,0.0)), f.x), f.y),
        mix(mix(hash31(i + vec3(0.0,0.0,1.0)), hash31(i + vec3(1.0,0.0,1.0)), f.x),
            mix(hash31(i + vec3(0.0,1.0,1.0)), hash31(i + vec3(1.0,1.0,1.0)), f.x), f.y),
        f.z
      );
    }

    vec2 sphereUV(vec3 n) {
      float u = atan(-n.z, n.x) / 6.28318530718 + 0.5;
      float v = 0.5 - asin(clamp(n.y, -1.0, 1.0)) / 3.14159265359;
      return vec2(u, v);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / uRes;
      vec2 ndc = uv * 2.0 - 1.0;
      float aspect = uRes.x / max(uRes.y, 1.0);
      vec3 rd = normalize(uCamF + ndc.x * uTanHalf * aspect * uCamR + ndc.y * uTanHalf * uCamU);

      float camLen = length(uCamPos);
      float pxAngle = 2.0 * uTanHalf / max(uRes.y, 1.0);

      float bM = dot(uCamPos, rd);
      float cM = dot(uCamPos, uCamPos) - 1.0;
      float discM = bM * bM - cM;
      float edgeM = max(0.002, camLen * pxAngle * 1.1);
      float moonCov = 0.0;
      float tMoon = -1.0;
      if (discM > 0.0 && bM < 0.0) {
        tMoon = -bM - sqrt(discM);
        float dClosestM = sqrt(max(0.0, 1.0 - discM));
        moonCov = smoothstep(1.0, 1.0 - edgeM, dClosestM);
      }

      vec3 ocE = uCamPos - uEarthPos;
      float bE = dot(ocE, rd);
      float cE = dot(ocE, ocE) - 0.0121;
      float discE = bE * bE - cE;
      float edgeE = max(0.001, length(ocE) * pxAngle * 1.1);
      float earthCov = 0.0;
      float tEarth = -1.0;
      if (discE > 0.0 && bE < 0.0) {
        tEarth = -bE - sqrt(discE);
        float dClosestE = sqrt(max(0.0, 0.0121 - discE));
        earthCov = smoothstep(0.11, 0.11 - edgeE, dClosestE);
      }

      vec3 outCol = vec3(0.0);
      float outA = 0.0;

      bool hitEarthFirst = earthCov > 0.001 && (moonCov <= 0.001 || (tEarth > 0.0 && (tMoon < 0.0 || tEarth < tMoon)));
      if (hitEarthFirst) {
        float tc = (tEarth > 0.0) ? tEarth : -bE;
        vec3 pE = uCamPos + tc * rd;
        vec3 nE = normalize(pE - uEarthPos);
        float cloud = smoothstep(0.46, 0.76, noise3D(nE * 6.5) * 0.65 + noise3D(nE * 14.0) * 0.35);
        float land = smoothstep(0.52, 0.64, noise3D(nE * 3.8 + vec3(4.2)));
        vec3 baseE = mix(vec3(0.14, 0.42, 0.88), vec3(0.24, 0.56, 0.38), land * 0.45);
        baseE = mix(baseE, vec3(0.92, 0.96, 1.0), cloud * 0.72);
        float diffE = max(dot(nE, uSunDir), 0.0);
        vec3 colE = baseE * (0.28 + 0.92 * diffE) + vec3(0.04, 0.14, 0.36) * 0.6;
        outCol = colE * earthCov;
        outA = earthCov;
      } else if (moonCov > 0.001) {
        float tHit = (tMoon > 0.0) ? tMoon : -bM;
        vec3 p = uCamPos + tHit * rd;
        vec3 n = normalize(p);
        vec2 muv = sphereUV(n);
        vec4 texel = texture2D(uTex, muv);
        vec3 albedo = texel.rgb;

        float du = 1.0 / 512.0;
        float dv = 1.0 / 256.0;
        float hR = texture2D(uTex, vec2(muv.x + du, muv.y)).a;
        float hL = texture2D(uTex, vec2(muv.x - du, muv.y)).a;
        float hB = texture2D(uTex, vec2(muv.x, min(0.996, muv.y + dv))).a;
        float hT = texture2D(uTex, vec2(muv.x, max(0.004, muv.y - dv))).a;

        vec3 tU = length(n.xz) > 0.001 ? normalize(vec3(n.z, 0.0, -n.x)) : vec3(0.0, 0.0, -1.0);
        vec3 tV = normalize(cross(tU, n));
        float polFade = clamp(length(n.xz) * 1.4, 0.2, 1.0);
        float bumpScale = 3.2;
        vec3 bumpN = normalize(n - bumpScale * ((hR - hL) * polFade * tU + (hB - hT) * tV));

        float micro = (noise3D(n * 42.0) - 0.5) * 0.09;
        albedo = clamp(albedo + micro * 0.65, 0.12, 0.98);

        float ndlGeom = dot(n, uSunDir);
        float termMask = smoothstep(-0.04, 0.05, ndlGeom);
        float ndl = max(dot(bumpN, uSunDir), 0.0);
        float ndv = max(dot(bumpN, -rd), 0.08);
        float lommel = ndl / max(ndl + ndv * 0.55, 0.08);
        float diff = mix(ndl, lommel, 0.34) * termMask;

        vec3 earthshine = vec3(0.54, 0.64, 0.85) * 0.16;
        vec3 sunCol = vec3(1.0, 0.945, 0.863) * 1.18 * diff;
        float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
        vec3 rim = vec3(0.35, 0.62, 0.92) * 0.07 * fresnel * (0.25 + 0.75 * termMask);

        vec3 colM = albedo * (earthshine + sunCol) + rim;
        outCol = colM * moonCov;
        outA = moonCov;
      }

      gl_FragColor = vec4(outCol, outA);
    }
  `;

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn("Moon WebGL shader error:", gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const TW = 512, TH = 256;
  const pixels = buildLunarAlbedoHeightPixels(TW, TH);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, TW, TH, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  /* Upgrade asynchronously with moon_1024.jpg when available & canvas-readable */
  const moonImg = new Image();
  moonImg.onload = () => {
    try {
      const iw = moonImg.naturalWidth || 1024;
      const ih = moonImg.naturalHeight || 512;
      const mc = document.createElement("canvas");
      mc.width = iw;
      mc.height = ih;
      const mg = mc.getContext("2d");
      mg.drawImage(moonImg, 0, 0, iw, ih);
      const data = mg.getImageData(0, 0, iw, ih).data;
      for (let i = 0; i < data.length; i += 4) {
        data[i + 3] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
      }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, iw, ih, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } catch (_) {
      /* Retain procedural equirectangular texture if file:// restricts getImageData */
    }
  };
  moonImg.src = "assets/moon.jpg";

  return {
    gl,
    prog,
    tex,
    uRes: gl.getUniformLocation(prog, "uRes"),
    uCamPos: gl.getUniformLocation(prog, "uCamPos"),
    uCamR: gl.getUniformLocation(prog, "uCamR"),
    uCamU: gl.getUniformLocation(prog, "uCamU"),
    uCamF: gl.getUniformLocation(prog, "uCamF"),
    uTanHalf: gl.getUniformLocation(prog, "uTanHalf"),
    uSunDir: gl.getUniformLocation(prog, "uSunDir"),
    uEarthPos: gl.getUniformLocation(prog, "uEarthPos"),
    uTex: gl.getUniformLocation(prog, "uTex"),
  };
}

function getGlobeBasis(st) {
  const C = {
    x: st.camDir.x * st.dist,
    y: st.camDir.y * st.dist,
    z: st.camDir.z * st.dist,
  };
  const F = normVec3({ x: -C.x, y: -C.y, z: -C.z });
  let R = crossVec3(F, { x: 0, y: 1, z: 0 });
  const rLen = Math.hypot(R.x, R.y, R.z);
  R = rLen > 1e-5 ? { x: R.x / rLen, y: R.y / rLen, z: R.z / rLen } : { x: 1, y: 0, z: 0 };
  const U = normVec3(crossVec3(R, F));
  const fovY = 36 * D2R;
  const tanHalf = Math.tan(fovY / 2);
  return { C, F, R, U, tanHalf };
}

function projectGlobePoint(p, basis, W, H) {
  const dx = p.x - basis.C.x, dy = p.y - basis.C.y, dz = p.z - basis.C.z;
  const vz = dx * basis.F.x + dy * basis.F.y + dz * basis.F.z;
  if (vz <= 0.02) return null;
  const vx = dx * basis.R.x + dy * basis.R.y + dz * basis.R.z;
  const vy = dx * basis.U.x + dy * basis.U.y + dz * basis.U.z;
  const aspect = W / Math.max(H, 1);
  const ndcX = vx / (vz * basis.tanHalf * aspect);
  const ndcY = vy / (vz * basis.tanHalf);
  return {
    sx: (ndcX + 1) * 0.5 * W,
    sy: (1 - ndcY) * 0.5 * H,
    vz,
  };
}

function isOccludedByMoon(p, C, radius = 0.996) {
  const dx = p.x - C.x, dy = p.y - C.y, dz = p.z - C.z;
  const lenD = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / lenD, uy = dy / lenD, uz = dz / lenD;
  const b = C.x * ux + C.y * uy + C.z * uz;
  if (b >= 0) return false;
  const c = C.x * C.x + C.y * C.y + C.z * C.z - radius * radius;
  const disc = b * b - c;
  if (disc <= 0) return false;
  const tHit = -b - Math.sqrt(disc);
  return tHit > 0 && tHit < lenD - 1e-4;
}

function flyGlobeTo(lat, lon, dist, force = false, withTilt = true) {
  if (!moonGlobe) return;
  const clampedLat = Math.max(-86, Math.min(86, lat));
  const rawTo = latLonToVec(clampedLat, lon);
  const tilted = withTilt
    ? normVec3({ x: rawTo.x, y: rawTo.y + (lat < -65 ? 0.24 : 0.15), z: rawTo.z })
    : rawTo;
  const targetDist = dist != null ? Math.max(1.35, Math.min(7, dist))
    : Math.min(Math.max(moonGlobe.dist, 2.4), 3.6);
  if (!force && moonGlobe.fly && dotVec3(moonGlobe.fly.to, tilted) > 0.9999) return;
  moonGlobe.velAz = 0;
  moonGlobe.velPol = 0;
  moonGlobe.fly = {
    from: { ...moonGlobe.camDir },
    to: tilted,
    d0: moonGlobe.dist,
    d1: targetDist,
    t0: performance.now(),
  };
}

function updateMoonGlobe(sc, scrubMs) {
  if (!moonGlobe) return;
  const actSc = sc || current;
  if (!actSc) return;
  const tSec = (scrubMs != null ? scrubMs : scrubT) / 1000;
  const sunNow = interp(actSc.sun, tSec);
  const earthNow = interp(actSc.earth, tSec);

  moonGlobe.pinLat = actSc.site.lat;
  moonGlobe.pinLon = actSc.site.lon;
  moonGlobe.pinName = actSc.site.name;

  if (sunNow) {
    moonGlobe.sunVec = localAzElToSelenographic(actSc.site.lat, actSc.site.lon, sunNow.az, sunNow.el);
    const subS = vecToLatLon(moonGlobe.sunVec);
    moonGlobe.sunLat = subS.lat;
    moonGlobe.sunLon = subS.lon;
    const horSun = horizonAt(actSc, sunNow.az);
    moonGlobe.sunClear = sunNow.el > horSun;
    if ($("globeSubsolar")) {
      $("globeSubsolar").textContent = `☀ Subsolar: ${subS.lat.toFixed(1)}°, ${subS.lon.toFixed(1)}°`;
    }
  }
  if (earthNow) {
    moonGlobe.earthVec = localAzElToSelenographic(actSc.site.lat, actSc.site.lon, earthNow.az, earthNow.el);
    const subE = vecToLatLon(moonGlobe.earthVec);
    moonGlobe.earthLat = subE.lat;
    moonGlobe.earthLon = subE.lon;
    const horEarth = horizonAt(actSc, earthNow.az);
    moonGlobe.earthClear = earthNow.el > horEarth;
    if ($("globeSubearth")) {
      $("globeSubearth").textContent = `⊕ Sub-Earth: ${subE.lat.toFixed(1)}°, ${subE.lon.toFixed(1)}°`;
    }
  }
  if ($("globePinCoord")) {
    $("globePinCoord").textContent =
      `📍 Pin: ${actSc.site.name} (${actSc.site.lat.toFixed(2)}°, ${actSc.site.lon.toFixed(2)}°)`;
  }
  if ($("globeFsTime") && $("scrubTime")) {
    $("globeFsTime").textContent = $("scrubTime").textContent;
  }
}

function renderMoonGlobeFrame(now) {
  const g = moonGlobe;
  if (!g) return;
  requestAnimationFrame(renderMoonGlobeFrame);
  if ($("planner").hidden || !g.mount || !g.canvas) return;

  const W = g.mount.clientWidth;
  const H = g.mount.clientHeight;
  if (W < 40 || H < 40) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (g.canvas.width !== pw || g.canvas.height !== ph) {
    g.canvas.width = pw;
    g.canvas.height = ph;
  }
  if (g.glCanvas && (g.glCanvas.width !== pw || g.glCanvas.height !== ph)) {
    g.glCanvas.width = pw;
    g.glCanvas.height = ph;
  }

  /* Camera flight (1.1 s spherical slerp) or damped orbit inertia */
  if (g.fly) {
    const f = Math.min(1, (now - g.fly.t0) / 1100);
    const e = 1 - Math.pow(1 - f, 3);
    g.camDir = slerpUnitVec(g.fly.from, g.fly.to, e);
    g.dist = g.fly.d0 + (g.fly.d1 - g.fly.d0) * e;
    if (f >= 1) g.fly = null;
  } else if (!g.dragging && (Math.abs(g.velAz) > 1e-5 || Math.abs(g.velPol) > 1e-5)) {
    let { lat, lon } = vecToLatLon(g.camDir);
    lon += g.velAz / D2R;
    lat = Math.max(-85, Math.min(85, lat + g.velPol / D2R));
    g.camDir = latLonToVec(lat, lon);
    g.velAz *= 0.93;
    g.velPol *= 0.93;
  }

  const basis = getGlobeBasis(g);
  const ctx = g.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  /* 1. Background starfield shell (r = 60..120) */
  for (let i = 0; i < g.stars.length; i++) {
    const s = g.stars[i];
    const p = projectGlobePoint(s, basis, W, H);
    if (!p || p.sx < -4 || p.sx > W + 4 || p.sy < -4 || p.sy > H + 4) continue;
    ctx.fillStyle = `rgba(203, 213, 225, ${s.alpha})`;
    ctx.fillRect(p.sx, p.sy, s.size, s.size);
  }

  /* Helper: draw Sun radial corona sprite */
  const sunPos = { x: g.sunVec.x * 4.2, y: g.sunVec.y * 4.2, z: g.sunVec.z * 4.2 };
  const sunOccluded = isOccludedByMoon(sunPos, basis.C, 1.0);
  const drawSunCorona = () => {
    const sp = projectGlobePoint(sunPos, basis, W, H);
    if (!sp) return;
    const rad = Math.max(18, (0.45 / (sp.vz * basis.tanHalf)) * H * 0.5);
    if (sp.sx + rad < 0 || sp.sx - rad > W || sp.sy + rad < 0 || sp.sy - rad > H) return;
    const grad = ctx.createRadialGradient(sp.sx, sp.sy, 0, sp.sx, sp.sy, rad);
    grad.addColorStop(0, "rgba(255, 240, 185, 1)");
    grad.addColorStop(0.24, "rgba(255, 220, 130, 0.85)");
    grad.addColorStop(1, "rgba(245, 158, 11, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sp.sx, sp.sy, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  if (sunOccluded) drawSunCorona();

  /* 2. Composite WebGL lit 3D Moon + 3D Earth (or 2D sphere fallback) */
  const earthPos = { x: g.earthVec.x * 2.6, y: g.earthVec.y * 2.6, z: g.earthVec.z * 2.6 };
  if (g.glInfo) {
    const gi = g.glInfo;
    const gl = gi.gl;
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(gi.prog);
    gl.uniform2f(gi.uRes, pw, ph);
    gl.uniform3f(gi.uCamPos, basis.C.x, basis.C.y, basis.C.z);
    gl.uniform3f(gi.uCamR, basis.R.x, basis.R.y, basis.R.z);
    gl.uniform3f(gi.uCamU, basis.U.x, basis.U.y, basis.U.z);
    gl.uniform3f(gi.uCamF, basis.F.x, basis.F.y, basis.F.z);
    gl.uniform1f(gi.uTanHalf, basis.tanHalf);
    gl.uniform3f(gi.uSunDir, g.sunVec.x, g.sunVec.y, g.sunVec.z);
    gl.uniform3f(gi.uEarthPos, earthPos.x, earthPos.y, earthPos.z);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gi.tex);
    gl.uniform1i(gi.uTex, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(g.glCanvas, 0, 0, W, H);
  } else {
    const center = projectGlobePoint({ x: 0, y: 0, z: 0 }, basis, W, H);
    if (center) {
      const rPx = (1 / Math.sqrt(Math.max(0.01, g.dist * g.dist - 1)) / basis.tanHalf) * (H * 0.5);
      const grad = ctx.createRadialGradient(
        center.sx + g.sunVec.x * rPx * 0.35, center.sy - g.sunVec.y * rPx * 0.35, rPx * 0.1,
        center.sx, center.sy, rPx
      );
      grad.addColorStop(0, "#cfd6e3");
      grad.addColorStop(0.65, "#6b778d");
      grad.addColorStop(1, "#182133");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(center.sx, center.sy, rPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!sunOccluded) drawSunCorona();

  /* Earth outer cyan halo (matches earthHalo sprite in MoonGlobe.tsx) */
  if (!isOccludedByMoon(earthPos, basis.C, 1.0)) {
    const ep = projectGlobePoint(earthPos, basis, W, H);
    if (ep) {
      const haloRad = Math.max(12, (0.25 / (ep.vz * basis.tanHalf)) * H * 0.5);
      if (ep.sx + haloRad >= 0 && ep.sx - haloRad <= W && ep.sy + haloRad >= 0 && ep.sy - haloRad <= H) {
        const gradE = ctx.createRadialGradient(ep.sx, ep.sy, 0, ep.sx, ep.sy, haloRad);
        gradE.addColorStop(0, "rgba(56, 189, 248, 0.55)");
        gradE.addColorStop(0.25, "rgba(56, 189, 248, 0.40)");
        gradE.addColorStop(1, "rgba(56, 189, 248, 0)");
        ctx.fillStyle = gradE;
        ctx.beginPath();
        ctx.arc(ep.sx, ep.sy, haloRad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* 3. 30° Selenographic Lat/Lon Grid (r = 1.003) */
  if (g.showGrid) {
    ctx.strokeStyle = "rgba(34, 211, 238, 0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < g.gridSegs.length; i++) {
      const seg = g.gridSegs[i];
      if (isOccludedByMoon(seg.m, basis.C, 0.998)) continue;
      const pa = projectGlobePoint(seg.a, basis, W, H);
      const pb = projectGlobePoint(seg.b, basis, W, H);
      if (!pa || !pb) continue;
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
    }
    ctx.stroke();
  }

  /* 4. Preset Site Dots (r = 1.004) & Comparison Pins (r = 1.01) */
  ctx.fillStyle = "rgba(226, 232, 240, 0.7)";
  for (let i = 0; i < SITES.length; i++) {
    const s = SITES[i];
    const p3 = latLonToVec(s.lat, s.lon, 1.004);
    if (isOccludedByMoon(p3, basis.C, 0.997)) continue;
    const p2 = projectGlobePoint(p3, basis, W, H);
    if (!p2) continue;
    ctx.beginPath();
    ctx.arc(p2.sx, p2.sy, 2.3, 0, Math.PI * 2);
    ctx.fill();
  }

  const th = getThemeTokens();
  for (let i = 0; i < compares.length; i++) {
    const cs = compares[i].site;
    const cp3 = latLonToVec(cs.lat, cs.lon, 1.01);
    if (isOccludedByMoon(cp3, basis.C, 0.997)) continue;
    const cp2 = projectGlobePoint(cp3, basis, W, H);
    if (!cp2) continue;
    ctx.fillStyle = i === 0 ? th.sun : i === 1 ? th.earth : PALETTE[i % PALETTE.length];
    ctx.beginPath();
    ctx.arc(cp2.sx, cp2.sy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#070b14";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /* 5. Active Surface Pin (ring + stalk + head) */
  const pinNormal = latLonToVec(g.pinLat, g.pinLon, 1);
  const pinBase = latLonToVec(g.pinLat, g.pinLon, 1.002);
  const pinHead = latLonToVec(g.pinLat, g.pinLon, 1.095);
  const pinOccluded = isOccludedByMoon(pinBase, basis.C, 0.996);

  if (!pinOccluded) {
    const pb = siteBasis(g.pinLat, g.pinLon);
    const pulse = 1 + 0.35 * Math.sin(now / 320);
    const ringR = 0.032 * pulse;
    const ringAlpha = Math.max(0.15, Math.min(1, 0.9 - 0.4 * (pulse - 0.65)));
    ctx.strokeStyle = `rgba(34, 211, 238, ${ringAlpha.toFixed(2)})`;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let k = 0; k <= 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const ca = Math.cos(a) * ringR, sa = Math.sin(a) * ringR;
      const rp = {
        x: pinBase.x + ca * pb.N.x + sa * pb.E.x,
        y: pinBase.y + ca * pb.N.y + sa * pb.E.y,
        z: pinBase.z + ca * pb.N.z + sa * pb.E.z,
      };
      const p2 = projectGlobePoint(rp, basis, W, H);
      if (!p2) continue;
      if (k === 0) ctx.moveTo(p2.sx, p2.sy);
      else ctx.lineTo(p2.sx, p2.sy);
    }
    ctx.stroke();

    const p0 = projectGlobePoint(pinBase, basis, W, H);
    const p1 = projectGlobePoint(pinHead, basis, W, H);
    if (p0 && p1) {
      ctx.strokeStyle = "#67e8f9";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p0.sx, p0.sy);
      ctx.lineTo(p1.sx, p1.sy);
      ctx.stroke();

      ctx.fillStyle = "#22d3ee";
      ctx.beginPath();
      ctx.arc(p1.sx, p1.sy, 4.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#070b14";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /* 6. Sun & Earth 3D Arrows from Pin (amber #f59e0b, blue #38bdf8; fade to 0.18 when below horizon) */
  const drawVectorArrow = (dirVec, hex, rgbaFade, isClear) => {
    const alpha = isClear ? 1.0 : 0.18;
    const origin = { x: pinNormal.x * 1.005, y: pinNormal.y * 1.005, z: pinNormal.z * 1.005 };
    const len = 0.5;
    const tip = {
      x: origin.x + dirVec.x * len,
      y: origin.y + dirVec.y * len,
      z: origin.z + dirVec.z * len,
    };
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = hex;
    ctx.fillStyle = hex;
    ctx.lineWidth = 2.4;
    let tip2 = null, prev2 = null;
    const steps = 10;
    ctx.beginPath();
    let drawing = false;
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const wp = {
        x: origin.x + (tip.x - origin.x) * f,
        y: origin.y + (tip.y - origin.y) * f,
        z: origin.z + (tip.z - origin.z) * f,
      };
      if (isOccludedByMoon(wp, basis.C, 0.996)) {
        drawing = false;
        continue;
      }
      const sp = projectGlobePoint(wp, basis, W, H);
      if (!sp) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(sp.sx, sp.sy); drawing = true; }
      else ctx.lineTo(sp.sx, sp.sy);
      if (s === steps - 1) prev2 = sp;
      if (s === steps) tip2 = sp;
    }
    ctx.stroke();

    if (tip2 && prev2) {
      const ang = Math.atan2(tip2.sy - prev2.sy, tip2.sx - prev2.sx);
      const headLen = 9, headW = 4.5;
      ctx.beginPath();
      ctx.moveTo(tip2.sx, tip2.sy);
      ctx.lineTo(tip2.sx - headLen * Math.cos(ang) + headW * Math.sin(ang), tip2.sy - headLen * Math.sin(ang) - headW * Math.cos(ang));
      ctx.lineTo(tip2.sx - headLen * Math.cos(ang) - headW * Math.sin(ang), tip2.sy - headLen * Math.sin(ang) + headW * Math.cos(ang));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  };

  drawVectorArrow(g.sunVec, "#f59e0b", "rgba(245, 158, 11, 0.22)", g.sunClear);
  drawVectorArrow(g.earthVec, "#38bdf8", "rgba(56, 189, 248, 0.22)", g.earthClear);

  /* 7. Floating Crisp HTML Pin Label */
  if (g.pinLabel) {
    const camToHead = normVec3({ x: basis.C.x - pinHead.x, y: basis.C.y - pinHead.y, z: basis.C.z - pinHead.z });
    const facing = dotVec3(pinNormal, camToHead) > 0.05 && !pinOccluded;
    const pHead = projectGlobePoint(pinHead, basis, W, H);
    if (facing && pHead) {
      const tx = Math.max(8, Math.min(W - 140, Math.round(pHead.sx + 12)));
      const ty = Math.max(8, Math.min(H - 28, Math.round(pHead.sy - 14)));
      g.pinLabel.style.transform = `translate(${tx}px, ${ty}px)`;
      g.pinLabel.style.opacity = "1";
      g.pinLabel.textContent = g.pinName || `${g.pinLat.toFixed(2)}°, ${g.pinLon.toFixed(2)}°`;
    } else {
      g.pinLabel.style.opacity = "0";
    }
  }
}

function initMoonGlobe() {
  const mount = $("moonGlobeMount");
  const canvas = $("moonGlobeCanvas");
  if (!mount || !canvas) return;

  const glCanvas = document.createElement("canvas");
  const glInfo = initMoonGlobeWebGL(glCanvas);

  /* Build 2200 deterministic stars on a shell (60..120 radii) */
  const stars = [];
  let sSeed = 424242;
  const srnd = () => { sSeed = (sSeed * 1664525 + 1013904223) >>> 0; return sSeed / 4294967296; };
  for (let i = 0; i < 2200; i++) {
    const u = srnd() * 2 - 1;
    const phi = srnd() * Math.PI * 2;
    const rt = Math.sqrt(1 - u * u);
    const rad = 60 + srnd() * 60;
    stars.push({
      x: rad * rt * Math.cos(phi),
      y: rad * u,
      z: rad * rt * Math.sin(phi),
      size: srnd() > 0.88 ? 1.8 : 1.1,
      alpha: (0.28 + srnd() * 0.55).toFixed(2),
    });
  }

  /* Build 30-deg selenographic lat/lon grid segments at r = 1.003 */
  const gridSegs = [];
  const pushSeg = (a, b) => gridSegs.push({
    a, b, m: normVec3({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  });
  for (let lat = -60; lat <= 60; lat += 30) {
    for (let lon = -180; lon < 180; lon += 6) {
      pushSeg(latLonToVec(lat, lon, 1.003), latLonToVec(lat, lon + 6, 1.003));
    }
  }
  for (let lon = -180; lon < 180; lon += 30) {
    for (let lat = -84; lat < 84; lat += 6) {
      pushSeg(latLonToVec(lat, lon, 1.003), latLonToVec(lat + 6, lon, 1.003));
    }
  }

  const initVec = normVec3({ x: 3.3, y: 0.7, z: 0.6 });
  const initDist = Math.hypot(3.3, 0.7, 0.6);

  moonGlobe = {
    mount,
    canvas,
    ctx: canvas.getContext("2d"),
    pinLabel: $("pinLabel"),
    glCanvas,
    glInfo,
    stars,
    gridSegs,
    camDir: initVec,
    dist: initDist,
    initDir: { ...initVec },
    initDist,
    velAz: 0,
    velPol: 0,
    fly: null,
    dragging: false,
    showGrid: true,
    pinLat: -89.55,
    pinLon: 129.4,
    sunVec: latLonToVec(0, 20),
    earthVec: latLonToVec(0, 0),
    sunClear: false,
    earthClear: false,
  };

  /* Pointer drag-to-orbit & click-to-pin (5 px drag threshold) */
  let down = null, lastPt = null;
  canvas.addEventListener("pointerdown", e => {
    down = { x: e.clientX, y: e.clientY };
    lastPt = { x: e.clientX, y: e.clientY };
    moonGlobe.dragging = true;
    moonGlobe.fly = null;
    if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener("pointermove", e => {
    if (!moonGlobe.dragging || !lastPt) return;
    const dx = e.clientX - lastPt.x;
    const dy = e.clientY - lastPt.y;
    lastPt = { x: e.clientX, y: e.clientY };
    const sens = 0.0055 * (moonGlobe.dist / 3.2);
    const dAz = -dx * sens;
    const dPol = dy * sens;
    let { lat, lon } = vecToLatLon(moonGlobe.camDir);
    lon += dAz / D2R;
    lat = Math.max(-85, Math.min(85, lat + dPol / D2R));
    moonGlobe.camDir = latLonToVec(lat, lon);
    moonGlobe.velAz = dAz;
    moonGlobe.velPol = dPol;
  });

  const endDrag = (e) => {
    if (!moonGlobe.dragging) return;
    moonGlobe.dragging = false;
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    lastPt = null;
    if (moved > 5) return; /* drag, not click */

    const card = $("moonGlobeCard");
    if (card && !card.classList.contains("is-fullscreen")) {
      setGlobeFullscreen(true);
      return;
    }

    const W = mount.clientWidth, H = mount.clientHeight;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const basis = getGlobeBasis(moonGlobe);

    /* Prefer nearby visible preset site dot within 12 px */
    let bestSite = null, bestPx = 12;
    for (const s of SITES) {
      const p3 = latLonToVec(s.lat, s.lon, 1.004);
      if (isOccludedByMoon(p3, basis.C, 0.997)) continue;
      const p2 = projectGlobePoint(p3, basis, W, H);
      if (!p2) continue;
      const d = Math.hypot(p2.sx - clickX, p2.sy - clickY);
      if (d < bestPx) { bestPx = d; bestSite = s; }
    }
    if (bestSite) {
      $("siteSelect").value = bestSite.id;
      $("customCoords").hidden = true;
      moonGlobe.pinLat = bestSite.lat;
      moonGlobe.pinLon = bestSite.lon;
      flyGlobeTo(bestSite.lat, bestSite.lon, null, true);
      loadScenario();
      return;
    }

    /* Raycast click point onto unit Moon sphere */
    const ndcX = (clickX / rect.width) * 2 - 1;
    const ndcY = -(clickY / rect.height) * 2 + 1;
    const aspect = W / Math.max(H, 1);
    const rd = normVec3({
      x: basis.F.x + ndcX * basis.tanHalf * aspect * basis.R.x + ndcY * basis.tanHalf * basis.U.x,
      y: basis.F.y + ndcX * basis.tanHalf * aspect * basis.R.y + ndcY * basis.tanHalf * basis.U.y,
      z: basis.F.z + ndcX * basis.tanHalf * aspect * basis.R.z + ndcY * basis.tanHalf * basis.U.z,
    });
    const b = dotVec3(basis.C, rd);
    const c = dotVec3(basis.C, basis.C) - 1;
    const disc = b * b - c;
    if (disc < 0) return; /* clicked empty space */
    const tHit = -b - Math.sqrt(disc);
    if (tHit <= 0) return;
    const hit = {
      x: basis.C.x + tHit * rd.x,
      y: basis.C.y + tHit * rd.y,
      z: basis.C.z + tHit * rd.z,
    };
    const pos = vecToLatLon(hit);
    const lat = Math.round(pos.lat * 100) / 100;
    const lon = Math.round(pos.lon * 100) / 100;
    $("siteSelect").value = "custom";
    $("customCoords").hidden = false;
    $("latInput").value = lat;
    $("lonInput").value = lon;
    moonGlobe.pinLat = lat;
    moonGlobe.pinLon = lon;
    flyGlobeTo(lat, lon, null, true);
    loadScenario();
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", () => { moonGlobe.dragging = false; down = null; lastPt = null; });

  canvas.addEventListener("wheel", e => {
    e.preventDefault();
    moonGlobe.fly = null;
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    moonGlobe.dist = Math.max(1.35, Math.min(7, moonGlobe.dist * factor));
  }, { passive: false });

  /* Toolbar controls */
  const zoomBy = k => {
    moonGlobe.fly = null;
    moonGlobe.dist = Math.max(1.35, Math.min(7, moonGlobe.dist * k));
  };
  if ($("globeZoomIn")) $("globeZoomIn").addEventListener("click", () => zoomBy(0.82));
  if ($("globeZoomOut")) $("globeZoomOut").addEventListener("click", () => zoomBy(1.22));
  if ($("globeFocusBtn")) {
    $("globeFocusBtn").addEventListener("click", () => flyGlobeTo(moonGlobe.pinLat, moonGlobe.pinLon, 2.3, true, false));
  }
  if ($("globeGridBtn")) {
    $("globeGridBtn").addEventListener("click", () => {
      moonGlobe.showGrid = !moonGlobe.showGrid;
      $("globeGridBtn").classList.toggle("active", moonGlobe.showGrid);
      $("globeGridBtn").setAttribute("aria-pressed", String(moonGlobe.showGrid));
    });
  }
  if ($("globeResetBtn")) {
    $("globeResetBtn").addEventListener("click", () => {
      moonGlobe.velAz = 0;
      moonGlobe.velPol = 0;
      moonGlobe.fly = {
        from: { ...moonGlobe.camDir },
        to: { ...moonGlobe.initDir },
        d0: moonGlobe.dist,
        d1: moonGlobe.initDist,
        t0: performance.now(),
      };
    });
  }

  if ($("globePlayBtn")) {
    $("globePlayBtn").addEventListener("click", togglePlay);
  }
  const fsBtn = $("globeFullscreenBtn");
  if (fsBtn) {
    fsBtn.addEventListener("click", () => {
      const card = $("moonGlobeCard");
      setGlobeFullscreen(!(card && card.classList.contains("is-fullscreen")));
    });
  }
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      const card = $("moonGlobeCard");
      if (card && card.classList.contains("is-fullscreen")) {
        setGlobeFullscreen(false);
      }
    }
  });

  requestAnimationFrame(renderMoonGlobeFrame);
}

function setGlobeFullscreen(on) {
  const card = $("moonGlobeCard");
  if (!card) return;
  const isFs = Boolean(on);
  card.classList.toggle("is-fullscreen", isFs);
  document.body.style.overflow = isFs ? "hidden" : "";
  const btn = $("globeFullscreenBtn");
  if (btn) {
    btn.textContent = isFs ? "✕ Exit Fullscreen" : "⛶ Fullscreen";
    btn.setAttribute("aria-expanded", String(isFs));
    btn.setAttribute("aria-label", isFs ? "Exit fullscreen 3D Moon Globe" : "Expand 3D Moon Globe fullscreen");
  }
  const sub = $("globeCardSub");
  if (sub) {
    sub.textContent = isFs
      ? "Drag to rotate · Scroll to zoom · Click surface or preset dot to pin & evaluate · Esc to exit"
      : "Click Moon to expand fullscreen · Drag to rotate";
  }
  hideTooltip(true);
}

function init() {
  const now = new Date();
  $("startInput").value =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth()+1)}-${pad(now.getUTCDate())}T${pad(now.getUTCHours())}:00`;
  $("siteSelect").addEventListener("change", () => {
    $("customCoords").hidden = $("siteSelect").value !== "custom";
  });
  $("horizonSelect").addEventListener("change", () => {
    if (current) renderScenario();
    if (compares.length) renderCompare();
  });
  $("loadBtn").addEventListener("click", loadScenario);
  $("compareBtn").addEventListener("click", addCompare);
  const triggerUpload = () => { if ($("uploadCsvInput")) $("uploadCsvInput").click(); };
  if ($("downloadCsvBtn")) $("downloadCsvBtn").addEventListener("click", downloadCollaborationCSV);
  if ($("downloadCsvBottomBtn")) $("downloadCsvBottomBtn").addEventListener("click", downloadCollaborationCSV);
  if ($("uploadCsvBtn")) $("uploadCsvBtn").addEventListener("click", triggerUpload);
  if ($("uploadCsvBottomBtn")) $("uploadCsvBottomBtn").addEventListener("click", triggerUpload);
  if ($("uploadCsvInput")) {
    $("uploadCsvInput").addEventListener("change", async e => {
      const f = e.target.files && e.target.files[0];
      try { if (f) await uploadCollaborationCSV(f); }
      finally { e.target.value = ""; }
    });
  }
  $("clearCompare").addEventListener("click", () => {
    compares = []; saveCompares(); updateCompareCount(); renderCompare();
  });
  $("scrub").addEventListener("input", scrubFromSlider);
  $("playBtn").addEventListener("click", togglePlay);
  $("nowBtn").addEventListener("click", () => setScrub(Date.now()));
  $("startInput").addEventListener("keydown", e => { if (e.key === "Enter") loadScenario(); });

  let rsz;
  window.addEventListener("resize", () => {
    if ($("planner").hidden) return;
    clearTimeout(rsz);
    rsz = setTimeout(() => {
      if ($("planner").hidden) return;
      if (current) drawAll();
      if (compares.length) renderCompare();
    }, 150);
  });

  if (typeof ResizeObserver !== "undefined") {
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
      if ($("planner").hidden) return;
      cancelAnimationFrame(roRaf);
      roRaf = requestAnimationFrame(() => {
        if ($("planner").hidden) return;
        if (current) drawAll();
        if (compares.length) renderCompare();
      });
    });
    const grid = document.querySelector(".charts-grid");
    const cmpBox = document.querySelector("#compareView .chartbox");
    if (grid) ro.observe(grid);
    if (cmpBox) ro.observe(cmpBox);
  }

  populateSelect();
  initMetricCards();
  initTooltips();
  initMoonGlobe();
  updateCompareCount();
  initSplash();
}

/* ---------------- splash screen ---------------- */

function enterPlanner() {
  const splash = $("splash"), planner = $("planner"), video = $("splashVideo");
  if (video) video.pause();
  hideTooltip(true);
  splash.hidden = true;
  planner.hidden = false;
  $("gate").hidden = false;
  requestAnimationFrame(() => {
    if (!current) {
      loadScenario();
    } else {
      drawAll();
      if (compares.length) renderCompare();
    }
    const heading = $("plannerHeading");
    if (heading) {
      if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      heading.focus();
    }
  });
}

function returnToLanding() {
  if (playing) togglePlay();
  setGlobeFullscreen(false);
  hideTooltip(true);
  const planner = $("planner"), splash = $("splash"), video = $("splashVideo");
  planner.hidden = true;
  splash.hidden = false;
  splash.classList.remove("gone");
  if (video && splash.dataset.videoState !== "fallback") {
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }
  $("splashSkip").focus();
}

function initSplash() {
  const splash = $("splash"), video = $("splashVideo");
  const markFallback = () => { splash.dataset.videoState = "fallback"; };
  if (video) {
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      markFallback();
    }
    video.addEventListener("error", markFallback);
    const srcEl = video.querySelector("source");
    if (srcEl) srcEl.addEventListener("error", markFallback);
    const p = video.play();
    if (p && typeof p.catch === "function") p.catch(markFallback);
  }
  $("splashSkip").addEventListener("click", enterPlanner);
  const homeBtn = $("homeBtn");
  if (homeBtn) homeBtn.addEventListener("click", returnToLanding);
}

document.addEventListener("DOMContentLoaded", init);
