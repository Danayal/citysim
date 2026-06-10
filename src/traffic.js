import * as THREE from 'three';
import { N, CELL, K, M, MAX_CARS, idx, cellToWorld } from './constants.js';
import { GeoBuilder } from './geom.js';
import { findPath, tripEndpoints, highwayConnected, metroComponents } from './roads.js';

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

    this.cars = [];                       // {path, seg, t, speed, color}
    this.counts = new Float32Array(N * N); // cars per road cell (approx)
    this.endpoints = [];
    this.metroStations = 0;
    this.endpointsDirty = true;
    this.congestion = 0;                  // 0..1 citywide
    this.ridership = 0;

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
  }

  invalidate() { this.endpointsDirty = true; this.trainDirty = true; }

  targetCars(state) {
    const ridershipCut = Math.min(0.5, this.metroStations * 0.04);
    return Math.min(MAX_CARS, Math.floor((state.stats.pop / 11 + state.stats.tourists / 7) * (1 - ridershipCut)) + (highwayConnected(state) ? 4 : 0));
  }

  refresh(state) {
    if (!this.endpointsDirty) return;
    this.endpointsDirty = false;
    this.endpoints = tripEndpoints(state);
    if (highwayConnected(state)) this.endpoints.push(idx(N - 1, 24));
    const { stationsByComp } = metroComponents(state);
    this.metroStations = stationsByComp.reduce((a, s) => a + (s.length >= 2 ? s.length : 0), 0);
    this.rebuildTrainPath(state, stationsByComp);
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

  spawn(state) {
    if (this.endpoints.length < 2) return;
    const a = this.endpoints[(Math.random() * this.endpoints.length) | 0];
    const b = this.endpoints[(Math.random() * this.endpoints.length) | 0];
    if (a === b) return;
    const path = findPath(state.grid.kind, a % N, (a / N) | 0, b % N, (b / N) | 0);
    if (!path || path.length < 3) return;
    this.cars.push({
      path, seg: 0, t: Math.random() * 0.5,
      speed: 2.6 + Math.random() * 1.2,
      color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
    });
    this.counts[path[0]]++;
  }

  update(dt, state) {
    this.refresh(state);
    const want = this.targetCars(state);
    if (this.cars.length < want && Math.random() < 0.3) this.spawn(state);
    while (this.cars.length > want + 10) {
      const c = this.cars.pop();
      this.counts[c.path[c.seg]]--;
    }

    let jam = 0, onRoad = 0;
    const kind = state.grid.kind;
    for (let ci = this.cars.length - 1; ci >= 0; ci--) {
      const c = this.cars[ci];
      const cell = c.path[c.seg];
      if (kind[cell] !== K.ROAD || (c.seg + 1 < c.path.length && kind[c.path[c.seg + 1]] !== K.ROAD)) {
        // road bulldozed under us — vanish
        this.counts[cell] = Math.max(0, this.counts[cell] - 1);
        this.cars.splice(ci, 1);
        continue;
      }
      const load = this.counts[cell];
      const slow = 1 / (1 + 0.4 * Math.max(0, load - 2));
      if (load > 3) jam++;
      onRoad++;
      c.t += (c.speed * slow * dt) / 1; // t in cells
      while (c.t >= 1) {
        c.t -= 1;
        this.counts[cell] = Math.max(0, this.counts[cell] - 1);
        c.seg++;
        if (c.seg >= c.path.length - 1) { this.cars.splice(ci, 1); c.dead = true; break; }
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
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, new THREE.Color(c.color));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.updateTrain(dt);
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
