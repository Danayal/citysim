import * as THREE from 'three';
import { WORLD } from './constants.js';

const SKY = {
  night: new THREE.Color(0x0c1430), dawn: new THREE.Color(0xf2a65e),
  day: new THREE.Color(0x9ed3e8), dusk: new THREE.Color(0xe88a5e),
};
const STORM_SKY = new THREE.Color(0xb78d52);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    scene.background = SKY.day.clone();
    scene.fog = new THREE.Fog(SKY.day.clone(), 180, 520);

    this.sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = WORLD * 0.65;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 10, far: 500 });
    this.sun.shadow.bias = -0.0004;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfdfff, 0xc9a06a, 0.9);
    scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0);
    scene.add(this.moon);

    this.night = 0;      // 0 day .. 1 night
    this.storm = 0;      // 0 clear .. 1 sandstorm

    // sandstorm particles
    const sn = 600, sp = new Float32Array(sn * 3);
    for (let i = 0; i < sn; i++) {
      sp[i * 3] = (Math.random() - 0.5) * WORLD * 1.4;
      sp[i * 3 + 1] = Math.random() * 20;
      sp[i * 3 + 2] = (Math.random() - 0.5) * WORLD * 1.4;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.sand = new THREE.Points(sg, new THREE.PointsMaterial({
      color: 0xd8b070, size: 1.6, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.sand.frustumCulled = false;
    scene.add(this.sand);

    // fireworks: a pool of point bursts
    const fn = 500, fp = new Float32Array(fn * 3), fc = new Float32Array(fn * 3);
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    this.fw = new THREE.Points(fg, new THREE.PointsMaterial({
      size: 1.1, vertexColors: true, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.fw.frustumCulled = false;
    scene.add(this.fw);
    this.fwVel = new Float32Array(fn * 3);
    this.fwLife = 0;

    // rocket (launches from the Space Elevator)
    const rocket = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0xf2f6f8 }));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 8),
      new THREE.MeshBasicMaterial({ color: 0xc0392b }));
    nose.position.y = 2.7;
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 3.2, 8),
      new THREE.MeshBasicMaterial({ color: 0xffb340, transparent: true, opacity: 0.9 }));
    flame.rotation.x = Math.PI;
    flame.position.y = -3.4;
    rocket.add(body, nose, flame);
    rocket.visible = false;
    scene.add(rocket);
    this.rocket = rocket;
    this.rocketT = -1;
  }

  launchRocket(wx, wz) {
    this.rocket.position.set(wx, 2, wz);
    this.rocket.visible = true;
    this.rocketT = 0;
  }

  launchFireworks(cx = 0, cz = 0) {
    const pos = this.fw.geometry.attributes.position.array;
    const col = this.fw.geometry.attributes.color.array;
    const c = new THREE.Color();
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const burst = (i / (n / 5)) | 0;
      const bx = cx + (burst - 2) * 14, by = 35 + (burst % 3) * 12, bz = cz + ((burst * 7) % 3 - 1) * 12;
      pos[i * 3] = bx; pos[i * 3 + 1] = by; pos[i * 3 + 2] = bz;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const v = 6 + Math.random() * 9;
      this.fwVel[i * 3] = v * Math.sin(ph) * Math.cos(th);
      this.fwVel[i * 3 + 1] = v * Math.cos(ph);
      this.fwVel[i * 3 + 2] = v * Math.sin(ph) * Math.sin(th);
      c.setHSL([0.12, 0.0, 0.5, 0.33, 0.83][burst], 0.95, 0.65);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    this.fw.geometry.attributes.position.needsUpdate = true;
    this.fw.geometry.attributes.color.needsUpdate = true;
    this.fwLife = 3.2;
  }

  // hour: 0..24 game time
  update(dt, hour, stormActive) {
    // night factor
    const dayness = hour > 6 && hour < 18 ? 1 : hour <= 5 || hour >= 19 ? 0
      : hour <= 6 ? (hour - 5) : (19 - hour);
    this.night = 1 - dayness;

    // sun path
    const ang = ((hour - 6) / 12) * Math.PI; // sunrise->sunset over horizon
    this.sun.position.set(Math.cos(ang) * 160, Math.max(8, Math.sin(ang) * 200), 60);
    this.sun.intensity = 2.3 * Math.max(0, Math.sin(ang)) * (1 - this.storm * 0.7);
    this.moon.intensity = this.night * 0.35;
    this.moon.position.set(-80, 120, -60);
    this.hemi.intensity = 0.25 + dayness * 0.7 * (1 - this.storm * 0.5);

    // sky color
    const sky = new THREE.Color();
    if (hour >= 5 && hour < 7) sky.lerpColors(SKY.night, SKY.dawn, (hour - 5) / 2);
    else if (hour >= 7 && hour < 9) sky.lerpColors(SKY.dawn, SKY.day, (hour - 7) / 2);
    else if (hour >= 9 && hour < 17) sky.copy(SKY.day);
    else if (hour >= 17 && hour < 19) sky.lerpColors(SKY.day, SKY.dusk, (hour - 17) / 2);
    else if (hour >= 19 && hour < 20.5) sky.lerpColors(SKY.dusk, SKY.night, (hour - 19) / 1.5);
    else sky.copy(SKY.night);

    // sandstorm blend
    this.storm += ((stormActive ? 1 : 0) - this.storm) * Math.min(1, dt * 0.5);
    sky.lerp(STORM_SKY, this.storm * 0.85);
    this.scene.background.copy(sky);
    this.scene.fog.color.copy(sky);
    this.scene.fog.near = 180 - this.storm * 140;
    this.scene.fog.far = 520 - this.storm * 360;

    // blowing sand
    this.sand.material.opacity = this.storm * 0.8;
    if (this.storm > 0.02) {
      const p = this.sand.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += dt * 38; p[i + 2] += dt * 9;
        if (p[i] > WORLD * 0.7) p[i] = -WORLD * 0.7;
        if (p[i + 2] > WORLD * 0.7) p[i + 2] = -WORLD * 0.7;
      }
      this.sand.geometry.attributes.position.needsUpdate = true;
    }

    // fireworks
    if (this.fwLife > 0) {
      this.fwLife -= dt;
      this.fw.material.opacity = Math.min(1, this.fwLife);
      const p = this.fw.geometry.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) {
        p[i] += this.fwVel[i] * dt;
        p[i + 1] += (this.fwVel[i + 1] -= dt * 6) * dt;
        p[i + 2] += this.fwVel[i + 2] * dt;
      }
      this.fw.geometry.attributes.position.needsUpdate = true;
    } else this.fw.material.opacity = 0;

    // rocket ascent
    if (this.rocketT >= 0) {
      this.rocketT += dt;
      const t = this.rocketT;
      this.rocket.position.y = 2 + t * t * 14;
      this.rocket.rotation.y += dt * 0.6;
      if (t > 7) { this.rocketT = -1; this.rocket.visible = false; }
    }

    return this.night;
  }
}

// Tiny WebAudio synth for UI feedback (no assets needed).
export class Sounds {
  constructor() { this.ctx = null; this.muted = false; }
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }
  tone(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
    if (this.muted) return;
    this.ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(t); o.stop(t + dur);
  }
  tap() { this.tone(700, 0.06, 'triangle', 0.06); }
  build() { this.tone(180, 0.12, 'square', 0.08, 60); this.tone(420, 0.1, 'triangle', 0.06); }
  deny() { this.tone(180, 0.18, 'sawtooth', 0.06, -60); }
  cash() { this.tone(880, 0.09, 'sine', 0.08); setTimeout(() => this.tone(1320, 0.12, 'sine', 0.08), 70); }
  boom() { this.tone(70, 0.5, 'sine', 0.2, -30); }
  whoosh() { this.tone(300, 0.35, 'sawtooth', 0.04, 500); }
}
