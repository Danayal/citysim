import { N, T, K, Z, M, idx, coastCol, START_MONEY, CATALOG } from './constants.js';

export function newGrid() {
  const terrain = new Uint8Array(N * N);
  for (let z = 0; z < N; z++) {
    const c = coastCol(z);
    for (let x = 0; x < N; x++) {
      terrain[idx(x, z)] = x < c - 1 ? T.WATER : x < c + 1 ? T.BEACH : T.SAND;
    }
  }
  return {
    terrain,
    kind: new Uint8Array(N * N),     // K.*
    zone: new Uint8Array(N * N),     // Z.*
    bIndex: new Int16Array(N * N).fill(-1),
    metro: new Uint8Array(N * N),    // M.*
  };
}

export function newState() {
  return {
    version: 1,
    cityName: 'New Dubai',
    money: START_MONEY,
    day: 1,
    hour: 8,
    speed: 1,                 // 0 paused, 1 normal, 2 fast
    grid: newGrid(),
    buildings: [],            // {key, x, z, w, d, level, zone, active, age}
    stats: {
      pop: 0, jobs: 0, happiness: 60, tourists: 0, traffic: 0, ridership: 0,
      power: { cap: 0, use: 0 }, water: { cap: 0, use: 0 },
      demand: { r: 30, c: 0, i: 0 },
      income: 0, expense: 0,
    },
    milestone: 0,             // next milestone index
    goals: {},                // id -> true when done
    palmBuilt: false,
    event: null,              // {type, hoursLeft, name}
    muted: false,
    cameraHint: true,
  };
}

// ---- Derived helpers -----------------------------------------------------

export function buildingAt(state, x, z) {
  const b = state.grid.bIndex[idx(x, z)];
  return b >= 0 ? state.buildings[b] : null;
}

export function eachCellOf(b, fn) {
  for (let dz = 0; dz < (b.d || 1); dz++)
    for (let dx = 0; dx < (b.w || 1); dx++) fn(b.x + dx, b.z + dz);
}

export function defOf(b) { return CATALOG[b.key] || null; }

// ---- Save / load ---------------------------------------------------------

const SAVE_KEY = 'mirage-dubai-save-v1';

function u8ToB64(a) {
  let s = '';
  for (let i = 0; i < a.length; i += 4096) s += String.fromCharCode.apply(null, a.subarray(i, i + 4096));
  return btoa(s);
}
function b64ToU8(s) {
  const bin = atob(s), a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export function serialize(state) {
  return JSON.stringify({
    version: state.version, cityName: state.cityName, money: Math.round(state.money),
    day: state.day, hour: state.hour, speed: state.speed,
    terrain: u8ToB64(state.grid.terrain), kind: u8ToB64(state.grid.kind),
    zone: u8ToB64(state.grid.zone), metro: u8ToB64(state.grid.metro),
    buildings: state.buildings.filter(b => b),
    milestone: state.milestone, goals: state.goals, palmBuilt: state.palmBuilt,
    muted: state.muted, stats: state.stats, popEver: state._popEver || 0,
  });
}

export function saveGame(state) {
  try { localStorage.setItem(SAVE_KEY, serialize(state)); return true; }
  catch { return false; }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d.version !== 1) return null;
    const state = newState();
    Object.assign(state, {
      cityName: d.cityName, money: d.money, day: d.day, hour: d.hour,
      speed: d.speed || 1, milestone: d.milestone || 0, goals: d.goals || {},
      palmBuilt: !!d.palmBuilt, muted: !!d.muted, _popEver: d.popEver || 0,
    });
    if (d.stats) Object.assign(state.stats, d.stats);
    state.grid.terrain.set(b64ToU8(d.terrain));
    state.grid.kind.set(b64ToU8(d.kind));
    state.grid.zone.set(b64ToU8(d.zone));
    state.grid.metro.set(b64ToU8(d.metro));
    state.buildings = d.buildings || [];
    // rebuild bIndex from buildings
    state.grid.bIndex.fill(-1);
    state.buildings.forEach((b, i) => eachCellOf(b, (x, z) => { state.grid.bIndex[idx(x, z)] = i; }));
    return state;
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export function wipeSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }
