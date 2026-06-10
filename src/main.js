import * as THREE from 'three';
import { CELL, WORLD, CATALOG, cellToWorld } from './constants.js';
import { newState, loadGame, saveGame, wipeSave } from './state.js';
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

let heatmapOn = false;
let heatTimer = 0;

const ui = new UI(state, sounds, {
  onTool(key) { ghost.visible = false; },
  onSpeed(i) { state.speed = i; },
  onSave() { saveGame(state); },
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
    if (tool === 'bulldoze') { if (sim.bulldoze(cell[0], cell[1])) sounds.build(); return; }
    placeWithFootprint(tool, cell[0], cell[1]);
  },
  onPaint(cell) {
    sounds.ensure();
    const tool = ui.tool;
    if (tool === 'bulldoze') { sim.bulldoze(cell[0], cell[1]); return; }
    if (CATALOG[tool]?.drag) sim.place(tool, cell[0], cell[1]);
  },
  onPaintEnd() { traffic.invalidate(); },
  onHover(cell) { updateGhost(cell); },
});

// center camera on the highway ramp side of the coast
input.target.set(WORLD * 0.1, 0, 0);
input.apply();

function placeWithFootprint(key, x, z) {
  const def = CATALOG[key];
  if (!def) return;
  // center footprint on tap
  const ox = x - Math.floor((def.w || 1) / 2), oz = z - Math.floor((def.d || 1) / 2);
  const tx = def.special === 'palm' ? x : ox, tz = def.special === 'palm' ? z : oz;
  if (sim.place(key, tx, tz)) {
    traffic.invalidate();
    updateGhost(null);
  } else {
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
let hudTimer = 0, saveTimer = 0;
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

