// Headless smoke test: drives the real simulation without a renderer.
// Usage: node tools/smoke.js   (run from repo root; needs Node >= 18)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In the browser an import map resolves "three" to vendor/three.module.js.
// For Node, drop a local package shim so the same source files import cleanly.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shim = path.join(root, 'node_modules', 'three');
fs.mkdirSync(shim, { recursive: true });
fs.writeFileSync(path.join(shim, 'package.json'),
  JSON.stringify({ name: 'three', type: 'module', main: './three.module.js' }));
fs.copyFileSync(path.join(root, 'vendor', 'three.module.js'), path.join(shim, 'three.module.js'));

const { N, K, Z, idx, HW_Z, coastCol } = await import('../src/constants.js');
const { newState, saveGame, loadGame } = await import('../src/state.js');
const { Sim } = await import('../src/simulation.js');
const { findPath, tripEndpoints, highwayConnected, metroComponents } = await import('../src/roads.js');

// minimal browser shims for state.js save/load
const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};
globalThis.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

let failures = 0;
const check = (name, cond) => {
  console.log((cond ? '  ok ' : 'FAIL ') + name);
  if (!cond) failures++;
};

const state = newState();
const sim = new Sim(state);
state.money = 1e9; // sandbox budget for the test

// 1. terrain sanity
check('coast generates water on the west', state.grid.terrain[idx(0, 24)] === 0);
check('east side is sand', state.grid.terrain[idx(40, 24)] === 2);

// 2. build a road from the highway west, plus a north-south spine
for (let x = N - 1; x >= 14; x--) sim.place('road', x, HW_Z);
for (let z = 10; z <= 38; z++) sim.place('road', 20, z);
check('highway connected', highwayConnected(state));
check('road cells exist', state.grid.kind[idx(30, HW_Z)] === K.ROAD);

// 3. zones along the spine
for (let z = 10; z <= 38; z++) {
  sim.place('zoneR', 19, z);
  sim.place('zoneC', 21, z);
}
for (let x = 24; x <= 30; x++) sim.place('zoneI', x, HW_Z + 1);
check('zone painted', state.grid.zone[idx(19, 12)] === Z.R);

// 4. utilities + services
check('desal rejected inland', !sim.canPlace('desal', 30, 30).ok);
let desalSpot = null;
for (let z = 8; z <= 40 && !desalSpot; z++)
  for (let x = 2; x <= 16 && !desalSpot; x++)
    if (sim.canPlace('desal', x, z).ok) desalSpot = [x, z];
check('desal placeable along the coast', !!desalSpot);
sim.place('desal', desalSpot[0], desalSpot[1]);
sim.place('solar', 24, 12);
sim.place('gas', 24, 16);
sim.place('school', 16, 14);
sim.place('hospital', 16, 20);
sim.place('mosque', 16, 26);
sim.place('park', 18, 30);
check('buildings placed', state.buildings.length >= 6);

// 5. run a week of game time
for (let h = 0; h < 200; h++) sim.tickHour(0.1, 0);
check('population grew', state.stats.pop > 50);
check('jobs appeared', state.stats.jobs > 0);
check('power capacity online', state.stats.power.cap > 0);
check('happiness sane', state.stats.happiness >= 0 && state.stats.happiness <= 100);
check('some buildings leveled up or grew', state.buildings.some(b => b && b.zone));
check('goal: highway done', !!state.goals.highway);
check('goal: power done', !!state.goals.power);

// 6. traffic graph
const eps = tripEndpoints(state);
check('trip endpoints found', eps.length > 4);
const p = findPath(state.grid.kind, N - 1, HW_Z, 20, 12);
check('path from highway to spine', p && p.length > 10);

// 7. metro
for (let x = 16; x <= 34; x++) sim.place('metro', x, 8); // clear row, no buildings
sim.place('station', 18, 8);
sim.place('station', 32, 8);
const { stationsByComp } = metroComponents(state);
check('metro: 2 stations in one component', stationsByComp.some(s => s.length === 2));
for (let h = 0; h < 2; h++) sim.tickHour(0.1, 2);
check('goal: metro done', !!state.goals.metro);

// 8. palm island in open water
let palmSpot = null;
for (let z = 8; z <= 40 && !palmSpot; z++)
  for (let x = 1; x <= 9 && !palmSpot; x++)
    if (sim.canPlacePalm(x, z).ok) palmSpot = [x, z];
check('palm island placeable somewhere in the sea', !!palmSpot);
if (palmSpot) {
  sim.placePalm(palmSpot[0], palmSpot[1]);
  let palmCells = 0;
  for (let i = 0; i < N * N; i++) if (state.grid.terrain[i] === 3) palmCells++;
  check('palm island reclaimed >= 25 cells', palmCells >= 25);
}

// 9. bulldoze refund + bIndex integrity
const before = state.buildings.filter(Boolean).length;
sim.bulldoze(16, 14); // the school
check('bulldoze removed building', state.buildings.filter(Boolean).length === before - 1);
let orphan = false;
for (let i = 0; i < N * N; i++) {
  const bi = state.grid.bIndex[i];
  if (bi >= 0 && !state.buildings[bi]) orphan = true;
}
check('no orphan bIndex entries', !orphan);

// 10. save / load round trip
state.money = 12345;
check('save works', saveGame(state));
const loaded = loadGame();
check('load works', !!loaded);
check('money survives', loaded.money === 12345);
check('grid survives', loaded.grid.kind[idx(20, 20)] === state.grid.kind[idx(20, 20)]);
check('buildings survive', loaded.buildings.length === state.buildings.filter(Boolean).length);

// 11. milestone fired
check('milestone reached', state.milestone >= 1);

// 12. future tech
state._popEver = 99999; // unlock everything
state.money = 1e9;
sim.place('fusion', 36, 12);
sim.place('arcology', 36, 30);
sim.place('hyperloop', 40, 30);
sim.place('skyport', 40, 12);
sim.place('skyport', 40, 36);
const popBefore = state.stats.pop;
sim.tickHour(0.1, 0);
check('fusion adds big power', state.stats.power.cap >= 800);
check('arcology houses 400', state.stats.pop >= popBefore + 400);
check('tech cuts traffic', state.stats.trafficCut >= 0.15);
sim.tickHour(0.1, 0);
check('future buildings persist in save', (() => {
  saveGame(state);
  const l2 = loadGame();
  return l2.buildings.some(b => b.key === 'arcology') && l2.buildings.some(b => b.key === 'fusion');
})());

console.log(failures ? `\n${failures} FAILURES` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
