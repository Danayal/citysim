import * as THREE from 'three';
import { CELL, WORLD, CATALOG, worldToCell, inBounds, cellToWorld } from './constants.js';

// Orbit camera tuned for one-thumb play:
//  - pan tool: 1-finger drag pans, tap inspects
//  - build tool: 1-finger tap/drag builds, 2-finger gesture moves camera
//  - pinch = zoom, twist = rotate (always)
export class Input {
  constructor(canvas, camera, callbacks) {
    this.canvas = canvas;
    this.camera = camera;
    this.cb = callbacks; // {onTap, onPaint, onPaintEnd, onHover, getTool}

    this.target = new THREE.Vector3(10, 0, 0);
    this.yaw = -Math.PI / 4;
    this.pitch = 0.85;
    this.dist = 110;

    this.pointers = new Map();
    this.tapInfo = null;
    this.pinch = null;
    this.painting = false;
    this.lastPaintCell = -1;

    this.ray = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.dist = clamp(this.dist * (1 + Math.sign(e.deltaY) * 0.1), 18, 220);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    // block iOS double-tap zoom / scroll
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    this.apply();
  }

  groundPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1
    );
    this.ray.setFromCamera(ndc, this.camera);
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out) ? out : null;
  }

  cellAt(e) {
    const p = this.groundPoint(e);
    if (!p) return null;
    const [x, z] = worldToCell(p.x, p.z);
    return inBounds(x, z) ? [x, z] : null;
  }

  isBuildTool() {
    const t = this.cb.getTool();
    return t && t !== 'pan' && t !== 'inspect' && t !== 'heatmap';
  }

  down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
    if (this.pointers.size === 1) {
      this.tapInfo = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.isBuildTool() && e.button === 0 && CATALOG[this.cb.getTool()]?.drag) {
        this.painting = true;
        this.lastPaintCell = -1;
        this.paintAt(e);
      }
    } else {
      // second finger: abort painting, switch to camera gesture
      this.painting = false;
      this.tapInfo = null;
      if (this.pointers.size === 2) this.startPinch();
    }
  }

  startPinch() {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      d: Math.hypot(a.x - b.x, a.y - b.y),
      ang: Math.atan2(b.y - a.y, b.x - a.x),
      cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
      dist: this.dist, yaw: this.yaw,
    };
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) { this.hover(e); return; }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (this.pointers.size === 2 && this.pinch) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.dist = clamp(this.pinch.dist * (this.pinch.d / Math.max(20, d)), 18, 220);
      this.yaw = this.pinch.yaw - (ang - this.pinch.ang);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.panBy(cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch.cx = cx; this.pinch.cy = cy;
      this.apply();
      return;
    }

    if (this.pointers.size === 1) {
      if (this.tapInfo && Math.hypot(e.clientX - this.tapInfo.x, e.clientY - this.tapInfo.y) > 12)
        this.tapInfo = null;
      if (this.painting) { this.paintAt(e); return; }
      if (p.button === 2 || e.ctrlKey) { // desktop rotate
        this.yaw -= dx * 0.006;
        this.pitch = clamp(this.pitch + dy * 0.005, 0.3, 1.45);
      } else {
        this.panBy(dx, dy);
      }
      this.apply();
    }
  }

  panBy(dx, dy) {
    const k = this.dist * 0.0014;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    this.target.x -= (dx * cos - dy * sin) * k;
    this.target.z -= (dx * sin + dy * cos) * k;
    const m = WORLD * 0.6;
    this.target.x = clamp(this.target.x, -m, m);
    this.target.z = clamp(this.target.z, -m, m);
  }

  up(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.painting && this.pointers.size === 0) {
      this.painting = false;
      this.tapInfo = null; // the drag already placed; don't double-fire a tap
      this.cb.onPaintEnd?.();
    }
    if (this.tapInfo && performance.now() - this.tapInfo.t < 400 && this.pointers.size === 0) {
      const cell = this.cellAt(e);
      const pt = this.groundPoint(e);
      if (cell || pt) this.cb.onTap(cell, pt, e);
      this.tapInfo = null;
    }
  }

  hover(e) {
    if (e.pointerType === 'mouse') {
      const cell = this.cellAt(e);
      this.cb.onHover?.(cell);
    }
  }

  paintAt(e) {
    const cell = this.cellAt(e);
    if (!cell) return;
    const key = cell[1] * 1000 + cell[0];
    if (key === this.lastPaintCell) return;
    this.lastPaintCell = key;
    this.cb.onPaint(cell);
  }

  flyTo(x, z) {
    const [wx, wz] = cellToWorld(x, z);
    this.target.set(wx, 0, wz);
    this.apply();
  }

  apply() {
    const c = this.camera;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(this.pitch) * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * Math.cos(this.pitch) * this.dist
    );
    c.lookAt(this.target);
  }

  // gentle cinematic orbit (used on the start screen)
  orbit(dt) {
    this.yaw += dt * 0.05;
    this.apply();
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
