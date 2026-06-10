import * as THREE from 'three';
import { CELL, WORLD, CATALOG, cellToWorld } from './constants.js';
import { newState, loadGame, saveGame, wipeSave } from './state.js';
import { GeoBuilder, swapGeometry } from './geom.js';
import { Terrain } from './terrain.js';
import { CityMeshes } from './buildings.js';
import { Roads } from './roads.js';
import { Traffic } from './traffic.js';
import { Sim } from './simulation.js';
import { Effects, Sounds } from './effects.js';
import { Input } from './input.js';
import { UI } from './ui.js';

// ---- boot -------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 1200);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let state = loadGame() || newState();
let sim = new Sim(state);

const terrain = new Terrain(scene);
const city = new CityMeshes(scene);
const roads = new Roads(scene);
const traffic = new Traffic(scene);
const effects = new Effects(scene);
const sounds = new Sounds();
sounds.muted = state.muted;

// ghost preview for placement
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x44ff88, transparent: true, opacity: 0.4, depthWrite: false });
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat);
ghost.visible = false;
scene.add(ghost);

// drag-gesture preview (straight roads, zone rectangles)
const preview = new THREE.Mesh(new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
scene.add(preview);

let heatmapOn = false;
let heatTimer = 0;

// ---- undo ----------------------------------------------------------------
const undoStack = [];
function pushUndo() {
  if (undoStack.length >= 12) undoStack.shift();
  undoStack.push({
    kind: state.grid.kind.slice(), zone: state.grid.zone.slice(),
    metro: state.grid.metro.slice(), terrain: state.grid.terrain.slice(),
    bIndex: state.grid.bIndex.slice(),
    buildings: JSON.parse(JSON.stringify(state.buildings)),
    money: state.money, palmBuilt: state.palmBuilt,
  });
}
function undo() {
  const s = undoStack.pop();
  if (!s) { ui.toast('Nothing to undo', 1200); return; }
  state.grid.kind.set(s.kind); state.grid.zone.set(s.zone);
  state.grid.metro.set(s.metro); state.grid.terrain.set(s.terrain);
  state.grid.bIndex.set(s.bIndex);
  state.buildings = s.buildings;
  state.money = s.money;
  state.palmBuilt = s.palmBuilt;
  sim.coverageDirty = true;
  Object.assign(sim.dirty, { terrain: true, city: true, roads: true, metro: true, zones: true, palms: true });
  traffic.invalidate();
  sounds.tap();
  ui.toast('↩️ Undone', 1000);
}

let uiRef = null;
const ui = new UI(state, sounds, {
  onTool(key) { ghost.visible = false; clearPreview(); },
  onSpeed(i) { state.speed = i; },
  onSave() { saveGame(state); },
  onUndo() { undo(); },
  onNewCity() {
    wipeSave();
    state = newState();
    sim = new Sim(state);
    ui.state = state;
    traffic.cars.length = 0;
    traffic.counts.fill(0);
    traffic.invalidate();
    Object.assign(sim.dirty, { terrain: true, city: true, roads: true, metro: true, zones: true, palms: true });
    ui.togglePanel(null);
    ui.toast('🏜️ Fresh sand. Build something legendary.');
  },
  onHeatmap() {
    heatmapOn = !heatmapOn;
    roads.heat.visible = heatmapOn;
    ui.toast(heatmapOn ? '🌡️ Traffic heatmap ON' : 'Traffic heatmap off', 1500);
  },
});

uiRef = ui;
ui.refreshSpeed(state.speed);

const input = new Input(canvas, camera, {
  getTool: () => ui.tool,
  onTap(cell, point) {
    sounds.ensure();
    if (!cell) return;
    const tool = ui.tool;
    if (tool === 'pan' || tool === 'inspect') {
      ui.showInspect(sim.inspect(cell[0], cell[1]));
      sounds.tap();
      return;
    }
    if (tool === 'heatmap') return;
    placeWithFootprint(tool, cell[0], cell[1]);
  },
  onDragUpdate(a, b) { showPreview(ui.tool, a, b); },
  onDragCancel() { clearPreview(); },
  onDragEnd(a, b) {
    sounds.ensure();
    const tool = ui.tool;
    const cells = gestureCells(tool, a, b);
    clearPreview();
    pushUndo();
    let placed = 0;
    for (const [x, z] of cells) {
      if (tool === 'bulldoze') { if (sim.bulldoze(x, z)) placed++; continue; }
      const def = CATALOG[tool];
      if (def && state.money < def.cost) { ui.toast('🚫 Out of dirhams', 1500); break; }
      if (!sim.canPlace(tool, x, z).ok) continue; // skip blocked cells quietly (e.g. crossing a road)
      if (sim.place(tool, x, z)) placed++;
    }
    if (placed) sounds.build(); else undoStack.pop(); // nothing happened; don't waste an undo slot
    traffic.invalidate();
  },
  onHover(cell) { updateGhost(cell); },
});

// Cells covered by a drag gesture: an L-shaped run for roads/metro
// (dominant axis first — always straight), a rectangle for zones/bulldoze.
function gestureCells(tool, a, b) {
  const def = CATALOG[tool];
  const cells = [];
  if (tool === 'road' || def?.metro) {
    let [x, z] = a;
    const [tx, tz] = b;
    const dx = Math.sign(tx - x), dz = Math.sign(tz - z);
    if (Math.abs(tx - a[0]) >= Math.abs(tz - a[1])) {
      for (; x !== tx; x += dx) cells.push([x, z]);
      for (; ; z += dz) { cells.push([x, z]); if (z === tz) break; }
    } else {
      for (; z !== tz; z += dz) cells.push([x, z]);
      for (; ; x += dx) { cells.push([x, z]); if (x === tx) break; }
    }
  } else {
    const x0 = Math.min(a[0], b[0]), z0 = Math.min(a[1], b[1]);
    const x1 = Math.min(Math.max(a[0], b[0]), x0 + 13);
    const z1 = Math.min(Math.max(a[1], b[1]), z0 + 13);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) cells.push([x, z]);
  }
  return cells;
}

function showPreview(tool, a, b) {
  const def = CATALOG[tool];
  if (!def) return;
  const cells = gestureCells(tool, a, b);
  const g = new GeoBuilder();
  let cost = 0, n = 0;
  for (const [x, z] of cells) {
    const [wx, wz] = cellToWorld(x, z);
    let ok, color;
    if (tool === 'bulldoze') { ok = true; color = 0xffaa44; }
    else {
      ok = sim.canPlace(tool, x, z).ok;
      color = ok ? 0x55ff99 : 0xff5555;
      if (ok) { cost += def.cost; n++; }
    }
    g.box(CELL * 0.92, 0.3, CELL * 0.92, wx, 0.18, wz, color);
  }
  swapGeometry(preview, g.build());
  preview.visible = true;
  ui.setHint(tool === 'bulldoze'
    ? `${cells.length} tiles — release to demolish`
    : `${n} × ${def.name} — AED ${Math.round(cost).toLocaleString('en-US')} on release`);
}

function clearPreview() {
  preview.visible = false;
  uiRef?.resetHint(); // late-bound: clearPreview runs once during UI construction
}

// center camera on the highway ramp side of the coast
input.target.set(WORLD * 0.1, 0, 0);
input.apply();

function placeWithFootprint(key, x, z) {
  const def = CATALOG[key];
  if (!def) return;
  // center footprint on tap
  const ox = x - Math.floor((def.w || 1) / 2), oz = z - Math.floor((def.d || 1) / 2);
  const tx = def.special === 'palm' ? x : ox, tz = def.special === 'palm' ? z : oz;
  pushUndo();
  if (sim.place(key, tx, tz)) {
    traffic.invalidate();
    updateGhost(null);
  } else {
    undoStack.pop();
    const chk = sim.canPlace(key, tx, tz);
    if (!chk.ok && chk.reason) ui.toast('🚫 ' + chk.reason, 1800);
  }
}

function updateGhost(cell) {
  const tool = ui.tool;
  const def = CATALOG[tool];
  if (!cell || !def || tool === 'pan' || tool === 'inspect' || tool === 'heatmap') {
    ghost.visible = false;
    return;
  }
  const w = (def.w || 1), d = (def.d || 1);
  const ox = cell[0] - Math.floor(w / 2), oz = cell[1] - Math.floor(d / 2);
  const useX = def.special === 'palm' || def.drag ? cell[0] : ox;
  const useZ = def.special === 'palm' || def.drag ? cell[1] : oz;
  const chk = sim.canPlace(tool, useX, useZ);
  const [wx, wz] = cellToWorld(useX, useZ);
  ghost.scale.set((def.drag ? 1 : w) * CELL, 2, (def.drag ? 1 : d) * CELL);
  ghost.position.set(wx + (def.drag ? 0 : ((w - 1) * CELL) / 2), 1, wz + (def.drag ? 0 : ((d - 1) * CELL) / 2));
  ghostMat.color.set(chk.ok ? 0x44ff88 : 0xff5555);
  ghost.visible = true;
}

// ---- dirty-flag processing ----------------------------------------------
function processDirty() {
  const d = sim.dirty;
  if (d.terrain) { terrain.rebuild(state); d.terrain = false; d.palms = true; }
  if (d.city) { city.rebuild(state); d.city = false; traffic.invalidate(); }
  if (d.roads) { roads.rebuild(state); d.roads = false; traffic.invalidate(); }
  if (d.metro) { roads.rebuildMetro(state); d.metro = false; traffic.invalidate(); }
  if (d.zones) { city.rebuildZones(state); d.zones = false; }
  if (d.palms) { terrain.updatePalms(state); d.palms = false; }
}

// ---- game loop -------------------------------------------------------------
const HOURS_PER_SEC = [0, 0.55, 1.8]; // by speed setting
let hourAcc = 0;
let last = performance.now();
let hudTimer = 0, saveTimer = 0, rocketTimer = 60; // first launch shortly after build
let fpsAvg = 60, perfMode = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const time = now / 1000;

  // fixed-ish hourly simulation
  hourAcc += dt * HOURS_PER_SEC[state.speed];
  while (hourAcc >= 1) {
    hourAcc -= 1;
    sim.tickHour(traffic.congestion, traffic.metroStations || 0);
  }

  processDirty();
  ui.handleSimEvents(sim.drain(), effects, input);

  if (state.speed > 0) traffic.update(dt * (state.speed === 2 ? 1.6 : 1), state);
  terrain.update(dt, time, state);

  const hour = state.hour + hourAcc; // smooth fraction for lighting
  const night = effects.update(dt, hour % 24, state.event?.type === 'sandstorm');
  city.setNight(night);
  roads.setNight(night);

  if (heatmapOn && (heatTimer += dt) > 1.5) { heatTimer = 0; roads.rebuildHeat(state, traffic.counts); }

  if ((hudTimer += dt) > 0.25) { hudTimer = 0; ui.updateHUD(); }
  if ((saveTimer += dt) > 30) { saveTimer = 0; saveGame(state); }

  // rockets from the Space Elevator
  if ((rocketTimer += dt) > 75) {
    rocketTimer = 0;
    const se = state.buildings.find(b => b && b.key === 'spaceelevator');
    if (se) {
      const [wx, wz] = cellToWorld(se.x, se.z);
      effects.launchRocket(wx + CELL * 1.2, wz + CELL * 0.5);
      sounds.whoosh();
    }
  }

  // auto performance mode for older iPhones
  fpsAvg = fpsAvg * 0.97 + (1 / Math.max(dt, 0.001)) * 0.03;
  if (!perfMode && fpsAvg < 26 && time > 15) {
    perfMode = true;
    renderer.shadowMap.enabled = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.3));
    ui.toast('⚙️ Performance mode enabled for smoother play', 2600);
  }

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// save on background / close
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveGame(state);
});
window.addEventListener('pagehide', () => saveGame(state));

// first-run welcome
if (!Object.keys(state.goals).length && state.buildings.length === 0) {
  ui.modal('🏜️ Welcome to the Desert',
    `You hold the deed to a stretch of Gulf coastline.<br><br>
     1️⃣ Draw a <b>Road</b> from the glowing highway ramp (east edge).<br>
     2️⃣ Paint <b>Homes</b> zones beside it.<br>
     3️⃣ Add <b>Solar power</b> and a <b>Desalination plant</b>.<br><br>
     Then watch your mirage become a metropolis. 🌆`);
}

// PWA service worker
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// debug/test handle
window.__game = {
  get state() { return state; },
  get sim() { return sim; },
  ui, input, traffic, effects,
  tickHours(n) { for (let i = 0; i < n; i++) sim.tickHour(traffic.congestion, traffic.metroStations || 0); },
};

