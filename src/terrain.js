import * as THREE from 'three';
import { N, CELL, WORLD, T, K, Z, idx, inBounds, cellToWorld, HW_Z } from './constants.js';
import { GeoBuilder, swapGeometry } from './geom.js';

const SAND = 0xe2c98f, SAND2 = 0xd6ba7e, BEACH = 0xefe0b4, SHALLOW = 0x46b8c8, PALMSAND = 0xe8d4a0;

function hash(x, z) { // deterministic noise
  let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

export class Terrain {
  constructor(scene) {
    this.scene = scene;

    this.groundMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.ground = new THREE.Mesh(new THREE.BufferGeometry(), this.groundMat);
    this.ground.receiveShadow = true;
    scene.add(this.ground);

    // Sea: one big translucent plane below ground level.
    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD * 3, WORLD * 3),
      new THREE.MeshLambertMaterial({ color: 0x1486b8, transparent: true, opacity: 0.92 })
    );
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(-WORLD * 0.9, -0.55, 0);
    scene.add(sea);
    this.sea = sea;

    this.buildOuterDesert();
    this.buildHighwayRamp();
    this.buildBoats();
    this.buildCamels();

    // Palm trees (parks, island, beach) as one instanced mesh.
    this.palmGeo = makePalmGeometry();
    this.palmMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.palms = new THREE.InstancedMesh(this.palmGeo, this.palmMat, 400);
    this.palms.count = 0;
    this.palms.castShadow = true;
    scene.add(this.palms);
  }

  // Ground mesh: one quad per cell, colored by terrain type. Water cells are
  // omitted (the sea plane shows through).
  rebuild(state) {
    const g = new GeoBuilder();
    const ter = state.grid.terrain;
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const t = ter[idx(x, z)];
        if (t === T.WATER) continue;
        const [wx, wz] = cellToWorld(x, z);
        let c = t === T.BEACH ? BEACH : t === T.PALM ? PALMSAND : (hash(x, z) > 0.5 ? SAND : SAND2);
        g.box(CELL, 0.5, CELL, wx, -0.5, wz, c);
        if (t === T.BEACH) g.box(CELL, 0.2, CELL, wx - CELL * 0.5, -0.4, wz, SHALLOW); // wet edge hint
      }
    }
    swapGeometry(this.ground, g.build());
  }

  buildOuterDesert() {
    const g = new GeoBuilder();
    // Big apron of sand around the playable area (east/north/south).
    g.box(WORLD * 1.5, 0.5, WORLD * 3, WORLD / 2 + WORLD * 0.75 + 1, -0.52, 0, SAND2);
    g.box(WORLD, 0.5, WORLD, 0, -0.52, -WORLD + 1, SAND2);
    g.box(WORLD, 0.5, WORLD, 0, -0.52, WORLD - 1, SAND2);
    // Dunes: squashed cones scattered deterministically.
    for (let i = 0; i < 26; i++) {
      const a = hash(i, 7), b = hash(i, 13), s = 6 + hash(i, 3) * 14;
      const x = WORLD / 2 + 12 + a * WORLD * 0.55;
      const z = (b - 0.5) * WORLD * 2.2;
      const gb = new GeoBuilder();
      gb.cyl(s, 0.5, 2 + hash(i, 5) * 4, x, -0.4, z, hash(i, 9) > 0.5 ? SAND : SAND2, 7, null, 1, 0.6);
      g.paste(gb.snapshot(), 0, 0, 0);
    }
    const m = new THREE.Mesh(g.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  buildHighwayRamp() {
    // Glowing ramp marker where the outside highway meets the map edge.
    const g = new GeoBuilder();
    const [wx, wz] = cellToWorld(N - 1, HW_Z);
    g.box(WORLD * 0.5, 0.3, CELL * 0.9, WORLD / 2 + WORLD * 0.25, -0.18, wz, 0x3a3f47);
    for (let i = 0; i < 14; i++)
      g.box(0.5, 0.06, 1.6, WORLD / 2 + 3 + i * 6.5, 0.13, wz, 0xfff2b0);
    const m = new THREE.Mesh(g.build(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.scene.add(m);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 5, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.75 })
    );
    beacon.position.set(wx + CELL, 2.5, wz);
    this.scene.add(beacon);
    this.beacon = beacon;
  }

  buildBoats() {
    const g = new GeoBuilder();
    g.box(3.2, 0.7, 1.3, 0, 0, 0, 0x7a4f2b);                 // hull
    g.box(2.6, 0.3, 1.0, 0, 0.6, 0, 0x9a6a3c);
    g.cyl(0.07, 0.07, 3.4, 0.3, 0.7, 0, 0x5b3a1e, 6);        // mast
    g.add(new THREE.ConeGeometry(1.3, 2.6, 4), 0xfaf3e0,     // lateen sail
      new THREE.Matrix4().makeRotationZ(-0.5).setPosition(-0.4, 2.6, 0));
    this.boatGeo = g.build();
    this.boats = new THREE.InstancedMesh(this.boatGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 5);
    this.scene.add(this.boats);
    this.boatSeeds = [...Array(5)].map((_, i) => ({ off: i * 137, speed: 1.2 + hash(i, 1) * 1.5 }));
  }

  buildCamels() {
    const g = new GeoBuilder();
    g.box(1.6, 0.8, 0.7, 0, 0.9, 0, 0xb98e4f);               // body
    g.dome(0.45, 0, 1.65, 0, 0xb98e4f, 8);                   // hump
    g.box(0.35, 0.8, 0.3, 0.85, 1.2, 0, 0xb98e4f);           // neck
    g.box(0.5, 0.3, 0.3, 1.05, 1.95, 0, 0xa87c40);           // head
    for (const [lx, lz] of [[-0.55, -0.25], [-0.55, 0.25], [0.55, -0.25], [0.55, 0.25]])
      g.box(0.22, 0.9, 0.22, lx, 0, lz, 0xa87c40);           // legs
    this.camelGeo = g.build();
    this.camels = new THREE.InstancedMesh(this.camelGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), 6);
    this.scene.add(this.camels);
    this.camelState = [...Array(6)].map((_, i) => ({
      x: 0, z: 0, tx: 0, tz: 0, t: 1, seed: i, placed: false,
    }));
  }

  // Scatter palms: beach decoration + parks + palm island fronds.
  updatePalms(state) {
    const dummy = new THREE.Object3D();
    let n = 0;
    const put = (wx, wz, s) => {
      if (n >= 400) return;
      dummy.position.set(wx, 0, wz);
      dummy.rotation.y = hash(wx, wz) * Math.PI * 2;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.palms.setMatrixAt(n++, dummy.matrix);
    };
    const { terrain, kind, zone } = state.grid;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z), t = terrain[i];
      const [wx, wz] = cellToWorld(x, z);
      if (t === T.BEACH && kind[i] === K.EMPTY && hash(x, z) > 0.55)
        put(wx + (hash(x + 9, z) - 0.5) * 2, wz + (hash(x, z + 9) - 0.5) * 2, 0.8 + hash(x, z) * 0.5);
      if (t === T.PALM && kind[i] === K.EMPTY && zone[i] === Z.NONE && hash(x, z) > 0.45)
        put(wx, wz, 0.9 + hash(x, z) * 0.4);
    }
    for (const b of state.buildings) {
      if (!b || b.key !== 'park') continue;
      const [wx, wz] = cellToWorld(b.x, b.z);
      put(wx - 1.1, wz - 1.1, 1); put(wx + 1.1, wz + 0.8, 0.85); put(wx + 0.6, wz - 1.2, 0.7);
    }
    this.palms.count = n;
    this.palms.instanceMatrix.needsUpdate = true;
  }

  update(dt, time, state) {
    // Sea breathing.
    this.sea.position.y = -0.55 + Math.sin(time * 0.7) * 0.06;
    this.beacon.material.opacity = 0.45 + Math.sin(time * 3) * 0.3;

    // Dhows cruising the coast.
    const dummy = new THREE.Object3D();
    for (let i = 0; i < this.boatSeeds.length; i++) {
      const s = this.boatSeeds[i];
      const t = time * s.speed + s.off;
      const z = ((t * 2.2 + i * 53) % (WORLD * 1.4)) - WORLD * 0.7;
      const x = -WORLD / 2 - 6 - 10 * (0.5 + 0.5 * Math.sin(i * 2.1));
      dummy.position.set(x, -0.35 + Math.sin(t * 2) * 0.1, z);
      dummy.rotation.set(Math.sin(t * 1.7) * 0.05, Math.PI / 2, 0);
      dummy.updateMatrix();
      this.boats.setMatrixAt(i, dummy.matrix);
    }
    this.boats.instanceMatrix.needsUpdate = true;

    // Camels ambling between empty sand cells.
    const { terrain, kind } = state.grid;
    for (let i = 0; i < this.camelState.length; i++) {
      const c = this.camelState[i];
      if (!c.placed || c.t >= 1) {
        if (!c.placed) {
          const ok = this.randomSandCell(state, c.seed);
          if (!ok) continue;
          [c.x, c.z] = ok; c.placed = true;
        } else { c.x = c.tx; c.z = c.tz; }
        // pick a neighbor sand cell
        let tx = c.x, tz = c.z;
        for (let tries = 0; tries < 6; tries++) {
          const nx = c.x + Math.floor(hash(time + i, tries) * 3) - 1;
          const nz = c.z + Math.floor(hash(tries, time + i) * 3) - 1;
          if (inBounds(nx, nz) && terrain[idx(nx, nz)] === T.SAND && kind[idx(nx, nz)] === K.EMPTY) {
            tx = nx; tz = nz; break;
          }
        }
        c.tx = tx; c.tz = tz; c.t = 0;
      }
      c.t = Math.min(1, c.t + dt * 0.25);
      const [ax, az] = cellToWorld(c.x, c.z), [bx, bz] = cellToWorld(c.tx, c.tz);
      const wx = ax + (bx - ax) * c.t, wz = az + (bz - az) * c.t;
      dummy.position.set(wx, 0, wz);
      dummy.rotation.set(0, Math.atan2(bx - ax, bz - az) + Math.PI / 2, 0);
      dummy.scale.setScalar(0.9);
      dummy.updateMatrix();
      this.camels.setMatrixAt(i, dummy.matrix);
    }
    this.camels.instanceMatrix.needsUpdate = true;
  }

  randomSandCell(state, seed) {
    const { terrain, kind } = state.grid;
    for (let tries = 0; tries < 40; tries++) {
      const x = Math.floor(hash(seed, tries) * N), z = Math.floor(hash(tries, seed) * N);
      if (terrain[idx(x, z)] === T.SAND && kind[idx(x, z)] === K.EMPTY) return [x, z];
    }
    return null;
  }
}

function makePalmGeometry() {
  const g = new GeoBuilder();
  g.cyl(0.18, 0.12, 2.6, 0, 0, 0, 0x8a6a3c, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(new THREE.ConeGeometry(0.32, 2.0, 4),
      0x2f8f4e,
      new THREE.Matrix4()
        .makeRotationFromEuler(new THREE.Euler(Math.PI / 2.6 * Math.cos(a), 0, Math.PI / 2.6 * Math.sin(a)))
        .setPosition(Math.sin(a) * 0.8, 2.7, Math.cos(a) * 0.8));
  }
  return g.build();
}
