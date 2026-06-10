import * as THREE from 'three';

// Builds merged, vertex-colored geometry from primitive shapes so an entire
// city renders in a handful of draw calls (critical for mobile GPUs).
export class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.col = []; }

  add(geometry, color, matrix) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (matrix) g.applyMatrix4(matrix);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const c = new THREE.Color(color);
    for (let i = 0; i < p.length; i += 3) {
      this.pos.push(p[i], p[i + 1], p[i + 2]);
      this.nrm.push(n[i], n[i + 1], n[i + 2]);
      this.col.push(c.r, c.g, c.b);
    }
    g.dispose();
    if (g !== geometry) geometry.dispose();
  }

  // Box with bottom at y0, centered at (x,z). rot = {x,y,z} radians (optional).
  box(w, h, d, x, y0, z, color, rot) {
    this.add(new THREE.BoxGeometry(w, h, d), color, mat(x, y0 + h / 2, z, rot));
  }

  // Cylinder/cone, bottom at y0. sx/sz squash for ellipses.
  cyl(rBottom, rTop, h, x, y0, z, color, seg = 10, rot, sx = 1, sz = 1) {
    const g = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
    g.scale(sx, 1, sz);
    this.add(g, color, mat(x, y0 + h / 2, z, rot));
  }

  // Dome (top half sphere) sitting on y0.
  dome(r, x, y0, z, color, seg = 12) {
    this.add(new THREE.SphereGeometry(r, seg, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      color, mat(x, y0, z));
  }

  sphere(r, x, y, z, color, seg = 10) {
    this.add(new THREE.SphereGeometry(r, seg, 8), color, mat(x, y, z));
  }

  torus(r, tube, x, y, z, color, rot, seg = 24) {
    this.add(new THREE.TorusGeometry(r, tube, 8, seg), color, mat(x, y, z, rot));
  }

  empty() { return this.pos.length === 0; }

  // Snapshot raw arrays (for cached templates).
  snapshot() {
    return { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col) };
  }

  // Append a snapshot translated by (dx,dy,dz).
  paste(snap, dx, dy, dz) {
    const { pos, nrm, col } = snap;
    for (let i = 0; i < pos.length; i += 3) {
      this.pos.push(pos[i] + dx, pos[i + 1] + dy, pos[i + 2] + dz);
      this.nrm.push(nrm[i], nrm[i + 1], nrm[i + 2]);
    }
    for (let i = 0; i < col.length; i++) this.col.push(col[i]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

function mat(x, y, z, rot) {
  const m = new THREE.Matrix4();
  if (rot) {
    m.makeRotationFromEuler(new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0));
  }
  m.setPosition(x, y, z);
  return m;
}

// Replace a mesh's geometry safely.
export function swapGeometry(mesh, geometry) {
  const old = mesh.geometry;
  mesh.geometry = geometry;
  if (old) old.dispose();
}
