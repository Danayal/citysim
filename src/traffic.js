import * as THREE from 'three';
import { N, CELL, K, M, Z, MAX_CARS, idx, cellToWorld, CATALOG } from './constants.js';
import { GeoBuilder } from './geom.js';
import { findPath, highwayConnected, metroComponents } from './roads.js';
import { buildingName } from './citizens.js';

const CAR_COLORS = [0xffffff, 0xf2f2f2, 0x222831, 0xc0392b, 0xd4af37, 0x2980b9, 0x8e8e93, 0xe8e0d0];

function carGeometry() {
  const g = new GeoBuilder();
  g.box(1.5, 0.45, 0.8, 0, 0.18, 0, 0xffffff);
  g.box(0.8, 0.35, 0.7, -0.05, 0.6, 0, 0x9fd8ee);
  return g.build();
}

export class Traffic {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(carGeometry(), new THREE.MeshLambertMaterial(), MAX_CARS);
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CARS * 3), 3);
    scene.add(this.mesh);

    this.cars = [];                        // {path, seg, t, speed, color, scale, kind, label, citizen, onArrive}
    this.counts = new Float32Array(N * N); // cars per road cell (approx)
    this.instanceCars = new Array(MAX_CARS).fill(null); // instanceId -> car (for tap)
    this.metroStations = 0;
    this.modalCut = 0;                     // share of trips diverted to metro/tech
    this.endpointsDirty = true;
    this.congestion = 0;                   // 0..1 citywide
    this.ambientTimer = 0;

    // metro train
    this.trainPath = null;
    this.trainPos = 0; this.trainDir = 1;
    const tg = new GeoBuilder();
    tg.box(3.0, 0.9, 1.1, 0, 0, 0, 0xe8eef2);
    tg.box(3.0, 0.25, 1.15, 0, 0.85, 0, 0xc0392b);
    tg.box(0.4, 0.5, 1.0, 1.35, 0.2, 0, 0x2a3a4a);
    this.train = new THREE.InstancedMesh(tg.build(), new THREE.MeshLambertMaterial({ vertexColors: true }), 3);
    this.train.count = 0;
    scene.add(this.train);
    this.dummy = new THREE.Object3D();

    // flying sky-taxis (appear once 2+ skyports exist)
    const xg = new GeoBuilder();
    xg.box(1.3, 0.5, 0.8, 0, 0, 0, 0xe8eef2);
    xg.box(0.7, 0.4, 0.7, 0, 0.45, 0, 0x57c8e8);
    xg.box(2.4, 0.06, 0.18, 0, 0.95, 0, 0x2a313b);   // rotor bar
    xg.box(0.18, 0.06, 2.4, 0, 0.95, 0, 0x2a313b);
    this.taxis = new THREE.InstancedMesh(xg.build(), new THREE.MeshLambertMaterial({ vertexColors: true }), 6);
    this.taxis.count = 0;
    scene.add(this.taxis);
    this.skyports = [];
    this.taxiState = [...Array(6)].map((_, i) => ({ a: 0, b: 0, t: 1 + i * 0.17 }));
  }

  invalidate() { this.endpointsDirty = true; this.trainDirty = true; }

  refresh(state) {
    if (!this.endpointsDirty) return;
    this.endpointsDirty = false;
    const { stationsByComp } = metroComponents(state);
    this.metroStations = stationsByComp.reduce((a, s) => a + (s.length >= 2 ? s.length : 0), 0);
    this.modalCut = Math.min(0.65, this.metroStations * 0.04 + (state.stats.trafficCut || 0));
    this.rebuildTrainPath(state, stationsByComp);
    this.skyports = state.buildings
      .filter(b => b && b.key === 'skyport')
      .map(b => cellToWorld(b.x, b.z));
  }

  // Every car is a trip with a purpose. Returns the car (or null if the
  // traveller took the metro / hyperloop / a drone instead).
  spawnTrip({ path, kind, label, citizen, onArrive, color, scale }) {
    if (!path || path.length < 2 || this.cars.length >= MAX_CARS ||
        (kind === 'citizen' && Math.random() < this.modalCut)) {
      onArrive?.();
      return null;
    }
    const car = {
      path, seg: 0, t: 0,
      speed: 2.6 + Math.random() * 1.2,
      color: color ?? CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
      scale: scale || 1, kind, label, citizen: citizen || null, onArrive,
    };
    this.cars.push(car);
    this.counts[path[0]]++;
    return car;
  }

  carWorldPos(car) {
    const cur = car.path[car.seg], nxt = car.path[Math.min(car.seg + 1, car.path.length - 1)];
    const [ax, az] = cellToWorld(cur % N, (cur / N) | 0);
    const [bx, bz] = cellToWorld(nxt % N, (nxt / N) | 0);
    return [ax + (bx - ax) * car.t, az + (bz - az) * car.t];
  }

  // Ambient economy traffic: factory deliveries and tourist arrivals.
  ambient(state) {
    const kind = state.grid.kind;
    const roadOf = (b) => {
      for (let dz = -1; dz <= (b.d || 1); dz++) for (let dx = -1; dx <= (b.w || 1); dx++) {
        const x = b.x + dx, z = b.z + dz;
        if (x >= 0 && z >= 0 && x < N && z < N && kind[idx(x, z)] === K.ROAD) return [x, z];
      }
      return null;
    };
    const go = (fromB, toB, fromCell, toCell, kind2, label, scale, color) => {
      const a = fromCell || (fromB && roadOf(fromB)), b = toCell || (toB && roadOf(toB));
      if (!a || !b) return;
      const path = findPath(state.grid.kind, a[0], a[1], b[0], b[1]);
      if (path) this.spawnTrip({ path, kind: kind2, label, scale, color });
    };
    const hw = highwayConnected(state) ? [N - 1, 24] : null;
    const factories = state.buildings.filter(b => b && b.zone === Z.I && b.active !== false && !b.burning);
    const shops = state.buildings.filter(b => b && b.zone === Z.C && b.active !== false && !b.burning);
    const sights = state.buildings.filter(b => b && (CATALOG[b.key]?.tourism || (b.zone === Z.C && b.level >= 2)));
    if (factories.length && Math.random() < 0.55) {
      const f = factories[(Math.random() * factories.length) | 0];
      const dest = shops.length && Math.random() < 0.7 ? shops[(Math.random() * shops.length) | 0] : null;
      go(f, dest, null, dest ? null : hw, 'freight',
        `📦 Freight from ${buildingName(f)} ${dest ? 'to ' + buildingName(dest) : 'to the highway'}`,
        1.35, 0xd8d2c4);
    }
    if (hw && sights.length && Math.random() < Math.min(0.8, state.stats.tourists / 120 + 0.1)) {
      const s = sights[(Math.random() * sights.length) | 0];
      go(null, s, hw, null, 'tourist', `🧳 Tourists visiting ${buildingName(s)}`, 1, 0xffffff);
    }
  }

  rebuildTrainPath(state, stationsByComp) {
    // Longest track run: BFS twice over the biggest component (graph diameter).
    const { metro } = state.grid;
    let best = null;
    let anyTrack = -1;
    for (let i = 0; i < N * N; i++) if (metro[i] !== M.NONE) { anyTrack = i; break; }
    if (anyTrack >= 0) {
      const far1 = bfsFarthest(metro, anyTrack);
      const far2 = bfsFarthest(metro, far1.node);
      best = far2.path;
    }
    this.trainPath = best && best.length >= 4 ? best : null;
    this.trainPos = 0; this.trainDir = 1;
    this.train.count = this.trainPath ? 3 : 0;
  }

  update(dt, state) {
    this.refresh(state);
    if ((this.ambientTimer += dt) > 0.9) { this.ambientTimer = 0; this.ambient(state); }

    let jam = 0, onRoad = 0;
    const kind = state.grid.kind;
    for (let ci = this.cars.length - 1; ci >= 0; ci--) {
      const c = this.cars[ci];
      const cell = c.path[c.seg];
      if (kind[cell] !== K.ROAD || (c.seg + 1 < c.path.length && kind[c.path[c.seg + 1]] !== K.ROAD)) {
        // road bulldozed under us — deliver the passenger anyway, drop the car
        this.counts[cell] = Math.max(0, this.counts[cell] - 1);
        this.cars.splice(ci, 1);
        c.onArrive?.();
        continue;
      }
      const load = this.counts[cell];
      const slow = 1 / (1 + 0.4 * Math.max(0, load - 2));
      if (load > 3) jam++;
      onRoad++;
      c.t += c.speed * slow * dt; // t in cells
      while (c.t >= 1) {
        c.t -= 1;
        this.counts[c.path[c.seg]] = Math.max(0, this.counts[c.path[c.seg]] - 1);
        c.seg++;
        if (c.seg >= c.path.length - 1) {
          this.cars.splice(ci, 1);
          c.onArrive?.();
          break;
        }
        this.counts[c.path[c.seg]]++;
      }
    }
    this.congestion = onRoad ? jam / onRoad : 0;

    // write instances
    const d = this.dummy;
    let n = 0;
    for (const c of this.cars) {
      if (n >= MAX_CARS) break;
      const cur = c.path[c.seg], nxt = c.path[Math.min(c.seg + 1, c.path.length - 1)];
      const [ax, az] = cellToWorld(cur % N, (cur / N) | 0);
      const [bx, bz] = cellToWorld(nxt % N, (nxt / N) | 0);
      const dx = bx - ax, dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      // drive on the right: offset perpendicular to travel direction
      const ox = (-dz / len) * 0.85, oz = (dx / len) * 0.85;
      d.position.set(ax + dx * c.t + ox, 0.22, az + dz * c.t + oz);
      d.rotation.set(0, Math.atan2(dx, dz) + Math.PI / 2, 0);
      d.scale.setScalar(c.scale || 1);
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, new THREE.Color(c.color));
      this.instanceCars[n] = c;
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.updateTrain(dt);
    this.updateTaxis(dt);
  }

  updateTaxis(dt) {
    const ports = this.skyports;
    if (ports.length < 2) { this.taxis.count = 0; return; }
    const n = Math.min(6, ports.length * 2);
    this.taxis.count = n;
    const d = this.dummy;
    for (let i = 0; i < n; i++) {
      const s = this.taxiState[i];
      if (s.t >= 1) {
        s.a = (Math.random() * ports.length) | 0;
        do { s.b = (Math.random() * ports.length) | 0; } while (s.b === s.a);
        s.t = 0;
      }
      const [ax, az] = ports[s.a], [bx, bz] = ports[s.b];
      const len = Math.hypot(bx - ax, bz - az);
      s.t = Math.min(1, s.t + dt * 14 / Math.max(20, len));
      const e = s.t * s.t * (3 - 2 * s.t); // smoothstep cruise
      const x = ax + (bx - ax) * e, z = az + (bz - az) * e;
      const y = 7.2 + Math.sin(s.t * Math.PI) * 9; // climb then descend
      d.position.set(x, y, z);
      d.rotation.set(0, Math.atan2(bx - ax, bz - az) + Math.PI / 2, Math.sin(s.t * Math.PI) * 0.08);
      d.updateMatrix();
      this.taxis.setMatrixAt(i, d.matrix);
    }
    this.taxis.instanceMatrix.needsUpdate = true;
  }

  updateTrain(dt) {
    if (!this.trainPath) { this.train.count = 0; return; }
    this.train.count = 3;
    const path = this.trainPath;
    this.trainPos += this.trainDir * dt * 4.5; // cells/sec
    const maxPos = path.length - 1.01;
    if (this.trainPos >= maxPos) { this.trainPos = maxPos; this.trainDir = -1; }
    if (this.trainPos <= 0) { this.trainPos = 0; this.trainDir = 1; }
    const d = this.dummy;
    for (let car = 0; car < 3; car++) {
      const p = Math.max(0, Math.min(maxPos, this.trainPos - this.trainDir * car * 0.85));
      const i0 = Math.floor(p), t = p - i0;
      const a = path[i0], b = path[Math.min(i0 + 1, path.length - 1)];
      const [ax, az] = cellToWorld(a % N, (a / N) | 0);
      const [bx, bz] = cellToWorld(b % N, (b / N) | 0);
      const dx = bx - ax, dz = bz - az;
      d.position.set(ax + dx * t, 5.8, az + dz * t);
      d.rotation.set(0, Math.atan2(dx, dz) + Math.PI / 2, 0);
      d.updateMatrix();
      this.train.setMatrixAt(car, d.matrix);
    }
    this.train.instanceMatrix.needsUpdate = true;
  }
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dist = new Int32Array(N * N);
const par = new Int32Array(N * N);
const q = new Int32Array(N * N);

function bfsFarthest(metro, start) {
  dist.fill(-1); par.fill(-1);
  let head = 0, tail = 0;
  q[tail++] = start; dist[start] = 0;
  let far = start;
  while (head < tail) {
    const cur = q[head++];
    if (dist[cur] > dist[far]) far = cur;
    const cx = cur % N, cz = (cur / N) | 0;
    for (const [dx, dz] of DIRS) {
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const ni = nz * N + nx;
      if (metro[ni] !== M.NONE && dist[ni] === -1) { dist[ni] = dist[cur] + 1; par[ni] = cur; q[tail++] = ni; }
    }
  }
  const path = [];
  let p = far;
  while (p !== -1) { path.push(p); p = par[p]; }
  path.reverse();
  return { node: far, path };
}
