import * as THREE from 'three';
import { CELL, WORLD, Z, idx, N, K, cellToWorld } from './constants.js';
import { GeoBuilder, swapGeometry } from './geom.js';

// Palette
const WHITE = 0xf4efe3, CREAM = 0xe9dfc8, GLASS = 0x86c8e8, GLASS2 = 0x6aa8d8,
  STEEL = 0xb9c4cc, GOLD = 0xd4af37, DARK = 0x4a4f57, ROOF = 0xcdc3ab,
  WARM = 0xffd98a, TEAL = 0x2fa3a8, REDST = 0xc0392b, GREEN = 0x2f8f4e;

function rnd(seed) { let h = Math.sin(seed * 127.1) * 43758.5453; return h - Math.floor(h); }

// ---------------------------------------------------------------------------
// Template drawing. Each draws centered at origin within a w×d cell footprint.
// solid: lit geometry. glow: night-window geometry (MeshBasic, glows at night).
// ---------------------------------------------------------------------------
function windows(glow, w, h, d, floors, cols, y0 = 0.8, color = WARM) {
  // strips of windows on +x/-x and +z/-z faces
  for (let f = 0; f < floors; f++) {
    const y = y0 + f * ((h - y0) / floors);
    for (let c = 0; c < cols; c++) {
      const t = (c + 0.5) / cols - 0.5;
      if (rnd(f * 13 + c * 7) < 0.25) continue; // some windows dark
      glow.box(0.06, 0.5, 0.55, w / 2 + 0.02, y, t * d, color);
      glow.box(0.06, 0.5, 0.55, -w / 2 - 0.02, y, t * d, color);
      glow.box(0.55, 0.5, 0.06, t * w, y, d / 2 + 0.02, color);
      glow.box(0.55, 0.5, 0.06, t * w, y, -d / 2 - 0.02, color);
    }
  }
}

const DRAW = {
  // --- zoned: residential ---
  r1(s, g) { // courtyard villa
    s.box(2.6, 1.5, 2.6, 0, 0, 0, CREAM);
    s.box(2.8, 0.25, 2.8, 0, 1.5, 0, ROOF);
    s.box(0.9, 0.9, 0.9, 0.7, 1.75, 0.7, CREAM);
    s.dome(0.45, 0.7, 2.65, 0.7, TEAL, 10);
    s.box(3.4, 0.5, 0.15, 0, 0, -1.6, CREAM); // wall
    g.box(0.5, 0.5, 0.06, -0.5, 0.7, 1.32, WARM);
    g.box(0.5, 0.5, 0.06, 0.6, 0.7, 1.32, WARM);
  },
  r2(s, g) { // apartment block
    s.box(3.0, 6, 2.8, 0, 0, 0, WHITE);
    s.box(3.2, 0.3, 3.0, 0, 6, 0, ROOF);
    s.box(0.8, 0.5, 0.8, 0.8, 6.3, 0.6, STEEL); // AC unit
    windows(g, 3.0, 6, 2.8, 4, 3);
  },
  r3(s, g) { // marina tower
    s.cyl(1.7, 1.5, 14, 0, 0, 0, GLASS, 12);
    s.cyl(1.5, 0.9, 2.2, 0, 14, 0, WHITE, 12);
    s.cyl(0.08, 0.08, 2.5, 0, 16, 0, STEEL, 6);
    for (let f = 0; f < 8; f++)
      g.torus(1.62 - f * 0.02, 0.05, 0, 1.6 + f * 1.6, 0, WARM, { x: Math.PI / 2 }, 18);
  },
  // --- zoned: commercial ---
  c1(s, g) { // shop with awning
    s.box(2.8, 2.0, 2.4, 0, 0, 0, CREAM);
    s.box(3.0, 0.12, 1.0, 0, 1.9, 1.6, REDST);
    g.box(2.2, 0.9, 0.06, 0, 0.8, 1.22, 0xaffaff);
  },
  c2(s, g) { // department store
    s.box(3.2, 4.2, 3.0, 0, 0, 0, WHITE);
    s.box(3.4, 0.4, 3.2, 0, 4.2, 0, GOLD);
    windows(g, 3.2, 4.2, 3.0, 3, 3, 0.7, 0xaffaff);
  },
  c3(s, g) { // glass office tower
    s.box(2.6, 11, 2.6, 0, 0, 0, GLASS2, { y: Math.PI / 4 });
    s.box(2.0, 2.5, 2.0, 0, 11, 0, GLASS, { y: Math.PI / 4 });
    s.cyl(0.07, 0.07, 2.2, 0, 13.5, 0, STEEL, 6);
    for (let f = 0; f < 7; f++) {
      g.box(2.7, 0.35, 2.7, 0, 1.2 + f * 1.5, 0, 0xbfeaff, { y: Math.PI / 4 });
    }
  },
  // --- zoned: industrial ---
  i1(s, g) { // warehouse
    s.box(3.2, 2.2, 2.8, 0, 0, 0, 0xcfc6b2);
    s.cyl(1.4, 1.4, 3.2, 0, 2.0, 0, STEEL, 3, { z: Math.PI / 2 }, 1, 0.5);
    g.box(1.2, 1.0, 0.06, 0.6, 0.6, 1.42, WARM);
  },
  i2(s, g) { // factory
    s.box(3.4, 3.0, 3.0, 0, 0, 0, 0xb9b1a0);
    s.cyl(0.35, 0.3, 3.0, 1.1, 3.0, 0.8, 0x8d8678, 8);
    s.cyl(0.35, 0.3, 2.2, 0.3, 3.0, 0.8, 0x8d8678, 8);
    g.box(2.6, 0.7, 0.06, -0.2, 1.0, 1.52, WARM);
  },
  i3(s, g) { // logistics hub
    s.box(3.6, 4.5, 3.2, 0, 0, 0, 0xa9b6bd);
    s.box(1.2, 6.5, 1.2, 1.0, 0, -0.8, 0x90a0a8);
    s.box(3.8, 0.3, 3.4, 0, 4.5, 0, DARK);
    windows(g, 3.6, 4.5, 3.2, 3, 3, 0.8, 0xcfe8ff);
  },

  // --- utilities ---
  solar(s, g) {
    s.box(7.4, 0.3, 7.4, 0, 0, 0, 0xd9cba2);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      s.box(2.0, 0.12, 1.4, (c - 1) * 2.4, 0.7, (r - 1) * 2.4, 0x1d3f6e, { x: -0.45 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
      s.cyl(0.08, 0.08, 0.7, (c - 1) * 2.4, 0, (r - 1) * 2.4, STEEL, 6);
  },
  gas(s, g) {
    s.box(5.5, 3.4, 5.0, 0, 0, 0, 0xb9b1a0);
    s.cyl(0.6, 0.5, 6.5, -1.6, 3.4, -1.2, 0xd8d2c4, 10);
    s.cyl(0.6, 0.5, 5.0, 0.2, 3.4, -1.2, 0xd8d2c4, 10);
    s.cyl(1.5, 1.5, 2.0, 1.8, 0, 1.6, STEEL, 12);
    g.box(0.4, 0.4, 0.4, -1.6, 9.6, -1.2, 0xff8855); // stack light
    windows(g, 5.5, 3.4, 5.0, 2, 3, 0.8, WARM);
  },
  desal(s, g) {
    s.box(6.5, 2.2, 6.0, 0, 0, 0, WHITE);
    s.cyl(1.3, 1.3, 3.4, -1.7, 0, -1.4, 0x3a86c8, 14);
    s.cyl(1.3, 1.3, 3.4, 1.7, 0, -1.4, 0x3a86c8, 14);
    s.cyl(0.3, 0.3, 5.0, -3.4, 0.4, 1.5, TEAL, 8, { z: Math.PI / 2 }); // intake pipe
    g.box(3.0, 0.6, 0.06, 0, 1.0, 3.02, 0xaffaff);
  },
  tank(s, g) {
    s.cyl(1.2, 1.4, 1.6, 0, 3.2, 0, 0x3a86c8, 12);
    s.dome(1.4, 0, 4.8, 0, WHITE, 12);
    for (const a of [0, 2.1, 4.2]) s.cyl(0.12, 0.12, 3.2, Math.sin(a), 0, Math.cos(a), STEEL, 6);
  },

  // --- services ---
  school(s, g) {
    s.box(6.5, 2.4, 2.2, 0, 0, -2.0, CREAM);
    s.box(2.2, 2.4, 4.0, -2.15, 0, 0.9, CREAM);
    s.box(2.2, 2.4, 4.0, 2.15, 0, 0.9, CREAM);
    s.box(3.4, 0.1, 3.0, 0, 0.02, 1.4, 0x4f9f6a); // yard
    s.box(0.1, 1.8, 0.1, 0, 2.4, -2.0, STEEL);
    s.box(0.7, 0.45, 0.05, 0.36, 3.7, -2.0, REDST); // flag
    windows(g, 6.5, 2.4, 2.2, 1, 5, 1.1);
  },
  hospital(s, g) {
    s.box(5.5, 5.0, 4.5, 0, 0, 0, WHITE);
    s.box(2.5, 1.2, 2.5, 0, 5.0, 0, WHITE);
    s.box(1.4, 0.25, 0.25, 0, 5.6, 2.3, REDST); // crescent-ish marker
    s.box(0.25, 1.4, 0.25, 0, 5.05, 2.3, REDST);
    windows(g, 5.5, 5.0, 4.5, 4, 4, 0.8, 0xcfe8ff);
  },
  police(s, g) {
    s.box(3.0, 2.6, 2.8, 0, 0, 0, 0xdfe6ea);
    s.box(3.1, 0.4, 2.9, 0, 1.4, 0, 0x1f4e79);
    g.box(0.4, 0.3, 0.4, 0, 2.7, 0, 0x66aaff);
  },
  fire(s, g) {
    s.box(3.0, 2.6, 2.8, 0, 0, 0, 0xd9534f);
    s.box(1.6, 1.7, 0.1, 0, 0, 1.42, 0x7a2f2d); // garage door
    s.cyl(0.5, 0.5, 4.2, -1.0, 0, -0.9, 0xc8c2b4, 8); // hose tower
    g.box(0.4, 0.3, 0.4, 0, 2.7, 0, 0xff6666);
  },
  mosque(s, g) {
    s.box(4.6, 2.6, 4.0, 0, 0, -0.4, WHITE);
    s.dome(1.7, 0, 2.6, -0.4, GOLD, 14);
    s.cyl(0.3, 0.25, 6.5, 2.9, 0, 2.6, WHITE, 8);   // minaret
    s.dome(0.4, 2.9, 6.5, 2.6, GOLD, 8);
    s.cyl(0.3, 0.25, 6.5, -2.9, 0, 2.6, WHITE, 8);
    s.dome(0.4, -2.9, 6.5, 2.6, GOLD, 8);
    s.box(1.2, 1.6, 0.1, 0, 0, 1.62, 0x7a5a2e);     // arch door
    g.box(0.9, 1.1, 0.06, 0, 0.4, 1.66, WARM);
    g.box(0.3, 0.3, 0.3, 2.9, 5.9, 2.6, WARM);
    g.box(0.3, 0.3, 0.3, -2.9, 5.9, 2.6, WARM);
  },
  park(s, g) {
    s.box(3.6, 0.12, 3.6, 0, 0, 0, GREEN);
    s.cyl(0.7, 0.7, 0.25, 0, 0.1, 0, 0x8fd4e8, 10); // pond
    s.box(0.9, 0.4, 0.35, -1.2, 0.1, 1.2, 0x9a6a3c); // bench
  },
  souk(s, g) {
    for (let i = 0; i < 3; i++) {
      s.box(2.0, 1.8, 5.6, (i - 1) * 2.2, 0, 0, CREAM);
      s.cyl(1.0, 1.0, 5.6, (i - 1) * 2.2, 1.6, 0, [REDST, GOLD, TEAL][i], 3, { x: Math.PI / 2 }, 1, 0.55);
    }
    s.box(6.8, 0.5, 0.6, 0, 1.8, 2.9, 0x9a6a3c);
    g.box(1.0, 0.8, 0.06, -2.2, 0.5, 2.82, WARM);
    g.box(1.0, 0.8, 0.06, 0, 0.5, 2.82, WARM);
    g.box(1.0, 0.8, 0.06, 2.2, 0.5, 2.82, WARM);
  },
  station(s, g) {
    s.box(3.2, 0.4, 3.2, 0, 5.6, 0, STEEL);          // platform at track height
    s.cyl(1.9, 0.2, 1.4, 0, 6.0, 0, GOLD, 8, null, 1, 0.8); // iconic shell roof
    s.box(0.5, 5.6, 0.5, -1.2, 0, -1.2, WHITE);      // pillars + lift
    s.box(0.5, 5.6, 0.5, 1.2, 0, 1.2, WHITE);
    s.box(1.2, 5.6, 1.2, 0, 0, 0, GLASS);
    g.box(3.0, 0.3, 0.06, 0, 6.2, 1.64, 0xaffaff);
  },

  // --- landmarks ---
  fountain(s, g) {
    s.cyl(3.4, 3.4, 0.5, 0, 0, 0, CREAM, 18);
    s.cyl(3.0, 3.0, 0.45, 0, 0.1, 0, 0x57c8e8, 18);
    s.cyl(0.25, 0.12, 3.6, 0, 0.4, 0, 0xbfeaff, 8);
    s.cyl(0.18, 0.08, 2.4, 1.4, 0.4, 0, 0xbfeaff, 8);
    s.cyl(0.18, 0.08, 2.4, -1.4, 0.4, 0, 0xbfeaff, 8);
    g.torus(3.0, 0.08, 0, 0.6, 0, 0x9fe8ff, { x: Math.PI / 2 }, 24);
  },
  frame(s, g) {
    s.box(1.2, 14, 1.2, -2.6, 0, 0, GOLD);
    s.box(1.2, 14, 1.2, 2.6, 0, 0, GOLD);
    s.box(6.4, 1.2, 1.2, 0, 14, 0, GOLD);
    s.box(6.0, 0.4, 1.4, 0, 0, 0, CREAM);
    g.box(6.0, 0.25, 0.25, 0, 13.6, 0.7, WARM);
    g.box(0.25, 12, 0.25, -2.6, 0.8, 0.7, WARM);
    g.box(0.25, 12, 0.25, 2.6, 0.8, 0.7, WARM);
  },
  burjalarab(s, g) {
    s.cyl(2.6, 2.6, 0.6, 0, 0, 0, CREAM, 16);        // island
    s.cyl(1.8, 0.5, 16, 0, 0.6, 0, WHITE, 12, null, 0.45, 1); // sail body
    s.add(new THREE.SphereGeometry(1.9, 12, 10, 0, Math.PI), GLASS,
      new THREE.Matrix4().compose(
        new THREE.Vector3(0.55, 8.2, 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)),
        new THREE.Vector3(0.5, 0.95, 0.5)));
    s.cyl(0.1, 0.1, 4.5, 0, 15.5, 0, STEEL, 6);      // mast
    s.box(2.6, 0.18, 2.0, 1.6, 11.5, 0, 0x3fae68);   // helipad
    s.cyl(0.15, 0.15, 2.2, 1.6, 10.4, 0, STEEL, 6);
    for (let f = 0; f < 9; f++) g.box(0.08, 0.5, 1.4 - f * 0.1, 0.95 - f * 0.04, 1.4 + f * 1.55, 0, 0xaffaff);
  },
  museum(s, g) {
    s.box(6.0, 1.2, 5.0, 0, 0, 0, CREAM);            // plinth
    s.torus(3.4, 1.5, 0, 5.4, 0, 0xc8ccd2, { y: Math.PI / 2 }, 28); // the ring
    g.torus(3.4, 0.35, 0, 5.4, 0.9, WARM, { y: Math.PI / 2 }, 28);  // calligraphy band
  },
  mall(s, g) {
    s.box(10.5, 3.2, 9.5, 0, 0, 0, CREAM);
    s.box(4.5, 1.6, 4.0, -1.5, 3.2, -1.0, GLASS);    // atrium
    s.dome(2.2, 2.5, 3.2, 2.2, GLASS, 14);
    s.box(2.0, 4.8, 2.0, 4.0, 0, -3.4, GOLD);        // hotel wing
    s.cyl(1.6, 1.6, 0.4, -2.8, 3.2, 2.6, 0x57c8e8, 14); // aquarium dome hint
    windows(g, 10.5, 3.2, 9.5, 2, 7, 0.9, 0xaffaff);
  },
  // --- the future ---
  vertfarm(s, g) {
    s.box(5.0, 9, 4.2, 0, 0, 0, GLASS);
    for (let f = 0; f < 6; f++) s.box(5.4, 0.35, 4.6, 0, 1.1 + f * 1.4, 0, GREEN);
    s.box(5.4, 0.4, 4.6, 0, 9, 0, WHITE);
    for (let f = 0; f < 6; f++) g.box(5.45, 0.18, 4.65, 0, 0.75 + f * 1.4, 0, 0xc8ffd0);
  },
  droneport(s, g) {
    s.box(6.5, 0.8, 6.0, 0, 0, 0, 0x3c4450);
    s.cyl(1.6, 1.6, 0.15, -1.4, 0.8, -1.2, 0x2a313b, 14);
    s.cyl(1.6, 1.6, 0.15, 1.6, 0.8, 1.4, 0x2a313b, 14);
    s.cyl(0.5, 0.7, 4.2, 2.4, 0.8, -2.0, WHITE, 8);          // control tower
    s.dome(0.8, 2.4, 5.0, -2.0, GLASS, 10);
    for (const [dx, dz] of [[-1.4, -1.2], [1.6, 1.4]]) {     // parked drones
      s.box(0.9, 0.18, 0.9, dx, 1.0, dz, 0xe8eef2);
      s.sphere(0.28, dx, 1.25, dz, 0x57c8e8, 8);
    }
    g.torus(1.6, 0.07, -1.4, 0.92, -1.2, 0x6ef2ff, { x: Math.PI / 2 }, 18);
    g.torus(1.6, 0.07, 1.6, 0.92, 1.4, 0x6ef2ff, { x: Math.PI / 2 }, 18);
  },
  hyperloop(s, g) {
    s.box(5.5, 3.0, 4.5, 0, 0, 0, WHITE);
    s.cyl(1.5, 1.5, 7.6, 0, 2.6, 0, 0xc8d2da, 14, { z: Math.PI / 2 }); // the tube
    s.cyl(1.7, 1.7, 0.6, -3.4, 1.9, 0, STEEL, 14, { z: Math.PI / 2 });
    s.cyl(1.7, 1.7, 0.6, 3.4, 1.9, 0, STEEL, 14, { z: Math.PI / 2 });
    g.box(7.4, 0.14, 0.4, 0, 4.2, 1.45, 0x6ef2ff);
    g.box(3.4, 0.8, 0.06, 0, 0.9, 2.27, 0xaffaff);
  },
  skyport(s, g) {
    s.cyl(0.5, 0.6, 6.5, 0, 0, 0, STEEL, 8);
    s.cyl(2.0, 1.85, 0.4, 0, 6.5, 0, 0x2a313b, 16);
    s.box(1.3, 0.12, 0.28, 0, 6.92, 0, 0xffd75e);            // H marking
    s.box(0.28, 0.12, 1.1, -0.5, 6.92, 0, 0xffd75e);
    s.box(0.28, 0.12, 1.1, 0.5, 6.92, 0, 0xffd75e);
    g.torus(1.9, 0.09, 0, 6.95, 0, 0x6ef2ff, { x: Math.PI / 2 }, 20);
  },
  robopolice(s, g) {
    s.box(4.2, 8.5, 3.6, 0, 0, 0, 0x232a33, { y: Math.PI / 8 });
    s.box(4.4, 0.5, 3.8, 0, 8.5, 0, 0x1f4e79, { y: Math.PI / 8 });
    s.sphere(0.9, 0, 9.4, 0, GLASS, 10);                     // sensor orb
    for (let f = 0; f < 5; f++) g.box(4.3, 0.16, 3.7, 0, 1.4 + f * 1.5, 0, 0x66aaff, { y: Math.PI / 8 });
  },
  fusion(s, g) {
    s.box(6.8, 1.2, 6.4, 0, 0, 0, 0xd8d2c4);
    s.cyl(2.4, 2.0, 4.2, 0, 1.2, 0, WHITE, 16);
    s.dome(2.0, 0, 5.4, 0, STEEL, 16);
    s.cyl(0.5, 0.4, 3.2, 2.7, 1.2, 2.4, 0xc8d2da, 8);
    s.cyl(0.5, 0.4, 3.2, -2.7, 1.2, 2.4, 0xc8d2da, 8);
    g.torus(2.55, 0.22, 0, 3.2, 0, 0x4dfff0, { x: Math.PI / 2 }, 24); // plasma ring
    g.box(0.5, 0.5, 0.5, 0, 5.8, 0, 0x4dfff0);
  },
  arcology(s, g) {
    s.cyl(5.4, 5.0, 1.2, 0, 0, 0, CREAM, 18);
    s.dome(5.0, 0, 1.2, 0, GLASS, 18);                       // the dome
    for (let f = 0; f < 3; f++) s.cyl(3.6 - f * 1.1, 3.2 - f * 1.1, 1.3, 0, 1.2 + f * 1.4, 0, WHITE, 14); // terraces
    s.cyl(0.5, 0.3, 6.8, 0, 1.2, 0, STEEL, 8);               // core spire
    s.box(2.2, 1.4, 0.6, 0, 0, 5.0, WHITE);                  // entrance
    for (let f = 0; f < 3; f++) g.torus(3.5 - f * 1.1, 0.08, 0, 2.4 + f * 1.4, 0, WARM, { x: Math.PI / 2 }, 18);
    g.torus(4.6, 0.1, 0, 2.4, 0, 0x9fe8ff, { x: Math.PI / 2 }, 24);
  },
  spaceelevator(s, g) {
    s.cyl(3.2, 2.6, 2.0, 0, 0, 0, 0x2a313b, 12);             // anchor base
    s.cyl(1.4, 0.9, 10, 0, 2.0, 0, STEEL, 10);
    s.cyl(0.55, 0.4, 30, 0, 12, 0, 0xc8d2da, 8);             // ribbon tower
    s.cyl(0.22, 0.16, 38, 0, 42, 0, 0x9aa6ae, 6);            // tether
    s.sphere(1.5, 0, 82, 0, WHITE, 12);                      // counterweight
    s.torus(1.9, 0.18, 0, 82, 0, GOLD, { x: Math.PI / 2 }, 16);
    for (let f = 0; f < 7; f++) g.torus(0.9 - f * 0.07, 0.07, 0, 4 + f * 5.5, 0, 0x6ef2ff, { x: Math.PI / 2 }, 12);
    g.box(0.6, 0.6, 0.6, 0, 82, 0, 0xaffaff);
  },

  burj(s, g) {
    // Three-lobed telescoping spire.
    const tiers = [[2.6, 10], [2.1, 18], [1.6, 26], [1.15, 34], [0.75, 42], [0.42, 50]];
    for (const [r, top] of tiers) {
      s.cyl(r, r * 0.92, top, 0, 0, 0, 0xcfd8df, 6);
      for (let lobe = 0; lobe < 3; lobe++) {
        const a = lobe * Math.PI * 2 / 3;
        s.cyl(r * 0.55, r * 0.5, top * 0.92, Math.sin(a) * r, 0, Math.cos(a) * r, 0xc2ccd4, 6);
      }
    }
    s.cyl(0.1, 0.02, 12, 0, 50, 0, STEEL, 6);
    for (let f = 0; f < 16; f++) {
      const r = 2.6 - f * 0.14;
      g.torus(Math.max(0.3, r), 0.05, 0, 1.5 + f * 3.0, 0, 0xbfe6ff, { x: Math.PI / 2 }, 12);
    }
    g.box(0.3, 0.3, 0.3, 0, 51, 0, 0xffffff); // spire beacon
  },
};

// Map building record -> draw key
function drawKey(b) {
  if (b.zone === Z.R) return 'r' + b.level;
  if (b.zone === Z.C) return 'c' + b.level;
  if (b.zone === Z.I) return 'i' + b.level;
  return b.key;
}

const templateCache = new Map();
function getTemplate(key) {
  let t = templateCache.get(key);
  if (!t) {
    const s = new GeoBuilder(), g = new GeoBuilder();
    (DRAW[key] || DRAW.c1)(s, g);
    t = { solid: s.snapshot(), glow: g.snapshot() };
    templateCache.set(key, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
export class CityMeshes {
  constructor(scene) {
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    this.solid = new THREE.Mesh(new THREE.BufferGeometry(), this.solidMat);
    this.solid.castShadow = true;
    this.solid.receiveShadow = true;
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
    this.glow.visible = false;
    scene.add(this.solid, this.glow);

    this.zoneMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthWrite: false });
    this.zoneMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.zoneMat);
    scene.add(this.zoneMesh);
  }

  rebuild(state) {
    const s = new GeoBuilder(), g = new GeoBuilder();
    for (const b of state.buildings) {
      if (!b) continue;
      const t = getTemplate(drawKey(b));
      const wx = (b.x + (b.w || 1) / 2) * CELL - WORLD / 2;
      const wz = (b.z + (b.d || 1) / 2) * CELL - WORLD / 2;
      s.paste(t.solid, wx, 0, wz);
      if (b.active !== false) g.paste(t.glow, wx, 0, wz);
      if (b.active === false) { // dark "abandoned" tint marker
        s.box((b.w || 1) * CELL * 0.9, 0.15, (b.d || 1) * CELL * 0.9, wx, 0.01, wz, 0x55504a);
      }
    }
    swapGeometry(this.solid, s.build());
    swapGeometry(this.glow, g.build());
  }

  // translucent colored tiles on zoned-but-empty cells
  rebuildZones(state) {
    const g = new GeoBuilder();
    const { zone, kind } = state.grid;
    const colors = { [Z.R]: 0x4caf50, [Z.C]: 0x42a5f5, [Z.I]: 0xffb74d };
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (zone[i] !== Z.NONE && kind[i] === K.EMPTY) {
        const [wx, wz] = cellToWorld(x, z);
        g.box(CELL * 0.86, 0.08, CELL * 0.86, wx, 0.05, wz, colors[zone[i]]);
      }
    }
    swapGeometry(this.zoneMesh, g.build());
  }

  // 0 = day, 1 = full night
  setNight(n) {
    this.glow.visible = n > 0.05;
    this.glowMat.opacity = n;
  }
}
