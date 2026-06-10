import * as THREE from 'three';
import { N, CELL, K, M, idx, inBounds, cellToWorld } from './constants.js';
import { GeoBuilder, swapGeometry } from './geom.js';

const ASPHALT = 0x3a3f47, SIDEWALK = 0xcfc6b2, LINE = 0xf5e9c8;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class Roads {
  constructor(scene) {
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.mesh.receiveShadow = true;
    this.metroMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.metroMesh.castShadow = true;
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }));
    this.heat = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.heat.visible = false;
    scene.add(this.mesh, this.metroMesh, this.glow, this.heat);
  }

  rebuild(state) {
    const g = new GeoBuilder(), glow = new GeoBuilder();
    const { kind } = state.grid;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      if (kind[idx(x, z)] !== K.ROAD) continue;
      const [wx, wz] = cellToWorld(x, z);
      g.box(CELL, 0.12, CELL, wx, 0, wz, ASPHALT);
      const conn = DIRS.map(([dx, dz]) =>
        (inBounds(x + dx, z + dz) && kind[idx(x + dx, z + dz)] === K.ROAD) || (x + dx === N && z + dz === 24));
      // sidewalk corners on edges that have no connection
      if (!conn[0]) g.box(0.5, 0.2, CELL, wx + CELL / 2 - 0.25, 0.06, wz, SIDEWALK);
      if (!conn[1]) g.box(0.5, 0.2, CELL, wx - CELL / 2 + 0.25, 0.06, wz, SIDEWALK);
      if (!conn[2]) g.box(CELL, 0.2, 0.5, wx, 0.06, wz + CELL / 2 - 0.25, SIDEWALK);
      if (!conn[3]) g.box(CELL, 0.2, 0.5, wx, 0.06, wz - CELL / 2 + 0.25, SIDEWALK);
      // center dashes for straight segments
      if (conn[0] && conn[1] && !conn[2] && !conn[3]) g.box(1.4, 0.02, 0.18, wx, 0.13, wz, LINE);
      if (conn[2] && conn[3] && !conn[0] && !conn[1]) g.box(0.18, 0.02, 1.4, wx, 0.13, wz, LINE);
      // street lamp glow dots (checkerboard so it's sparse)
      if ((x + z) % 2 === 0) glow.box(0.25, 0.12, 0.25, wx + 1.55, 1.9, wz + 1.55, 0xffe2a8);
    }
    swapGeometry(this.mesh, g.build());
    swapGeometry(this.glow, glow.build());
  }

  rebuildMetro(state) {
    const g = new GeoBuilder();
    const { metro } = state.grid;
    const H = 5.0; // guideway height
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const m = metro[idx(x, z)];
      if (m === M.NONE) continue;
      const [wx, wz] = cellToWorld(x, z);
      g.box(1.6, 0.5, 1.6, wx, H, wz, 0xdfe6ea);                 // guideway hub
      g.cyl(0.28, 0.34, H, wx, 0, wz, 0xc8c2b4, 8);              // pillar
      for (const [dx, dz] of [[1, 0], [0, 1]]) {                 // beams to + neighbors
        const nx = x + dx, nz = z + dz;
        if (inBounds(nx, nz) && metro[idx(nx, nz)] !== M.NONE) {
          g.box(dx ? CELL : 1.4, 0.5, dz ? CELL : 1.4, wx + dx * CELL / 2, H, wz + dz * CELL / 2, 0xdfe6ea);
        }
      }
    }
    swapGeometry(this.metroMesh, g.build());
  }

  // congestion heatmap overlay; counts = Float32Array per cell
  rebuildHeat(state, counts) {
    const g = new GeoBuilder();
    const { kind } = state.grid;
    const c = new THREE.Color();
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (kind[i] !== K.ROAD) continue;
      const v = Math.min(1, counts[i] / 5);
      c.setHSL(0.33 - 0.33 * v, 0.9, 0.5);
      const [wx, wz] = cellToWorld(x, z);
      g.box(CELL * 0.9, 0.05, CELL * 0.9, wx, 0.16, wz, c.getHex());
    }
    swapGeometry(this.heat, g.build());
  }

  setNight(n) { this.glow.material.opacity = n; this.glow.visible = n > 0.05; }
}

// ---------------------------------------------------------------------------
// Pathfinding over the road network (BFS, grid cells).
// ---------------------------------------------------------------------------
const prev = new Int32Array(N * N);
const queue = new Int32Array(N * N);

export function findPath(kind, sx, sz, tx, tz) {
  const start = idx(sx, sz), target = idx(tx, tz);
  if (kind[start] !== K.ROAD || kind[target] !== K.ROAD) return null;
  if (start === target) return [start];
  prev.fill(-2);
  prev[start] = -1;
  let head = 0, tail = 0;
  queue[tail++] = start;
  while (head < tail) {
    const cur = queue[head++];
    const cx = cur % N, cz = (cur / N) | 0;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (!inBounds(nx, nz)) continue;
      const ni = idx(nx, nz);
      if (prev[ni] !== -2 || kind[ni] !== K.ROAD) continue;
      prev[ni] = cur;
      if (ni === target) {
        const path = [ni];
        let p = cur;
        while (p !== -1) { path.push(p); p = prev[p]; }
        path.reverse();
        return path;
      }
      queue[tail++] = ni;
    }
  }
  return null;
}

// List of road cells adjacent to at least one building (trip endpoints).
export function tripEndpoints(state) {
  const { kind, bIndex } = state.grid;
  const out = [];
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (kind[idx(x, z)] !== K.ROAD) continue;
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (inBounds(nx, nz) && bIndex[idx(nx, nz)] >= 0) { out.push(idx(x, z)); break; }
    }
  }
  return out;
}

// Does any road touch the east-edge highway row?
export function highwayConnected(state) {
  return state.grid.kind[idx(N - 1, 24)] === K.ROAD;
}

// Connected metro components & station groups (for ridership rules).
export function metroComponents(state) {
  const { metro } = state.grid;
  const comp = new Int16Array(N * N).fill(-1);
  let nComp = 0;
  const stationsByComp = [];
  for (let i = 0; i < N * N; i++) {
    if (metro[i] === M.NONE || comp[i] !== -1) continue;
    const stations = [];
    let head = 0, tail = 0;
    queue[tail++] = i; comp[i] = nComp;
    while (head < tail) {
      const cur = queue[head++];
      if (metro[cur] === M.STATION) stations.push(cur);
      const cx = cur % N, cz = (cur / N) | 0;
      for (const [dx, dz] of DIRS) {
        const nx = cx + dx, nz = cz + dz;
        if (!inBounds(nx, nz)) continue;
        const ni = idx(nx, nz);
        if (metro[ni] !== M.NONE && comp[ni] === -1) { comp[ni] = nComp; queue[tail++] = ni; }
      }
    }
    stationsByComp.push(stations);
    nComp++;
  }
  return { comp, stationsByComp };
}
