import {
  N, T, K, Z, M, idx, inBounds, CATALOG, ZONE_STATS, MILESTONES, SERVICES, HW_Z,
} from './constants.js';
import { eachCellOf } from './state.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export const GOALS = [
  { id: 'highway', text: 'Connect a road to the highway ramp (east edge)', reward: 800 },
  { id: 'zoner',   text: 'Paint 8 Homes zones beside a road', reward: 500 },
  { id: 'power',   text: 'Provide power and water', reward: 800 },
  { id: 'pop100',  text: 'Reach 100 residents', reward: 1000 },
  { id: 'school',  text: 'Build a school', reward: 600 },
  { id: 'metro',   text: 'Open a metro line with 2 stations', reward: 1200 },
  { id: 'wonder',  text: 'Build your first Wonder', reward: 1500 },
];

export class Sim {
  constructor(state) {
    this.state = state;
    this.dirty = { terrain: true, city: true, roads: true, metro: true, zones: true, palms: true };
    this.queue = [];          // UI/effect events: {type, ...}
    this.coverage = {};       // svc -> Uint8Array
    for (const s of SERVICES) this.coverage[s] = new Uint8Array(N * N);
    this.pollution = new Uint8Array(N * N);
    this.coverageDirty = true;
    this.hourAcc = 0;
  }

  emit(ev) { this.queue.push(ev); }
  drain() { const q = this.queue; this.queue = []; return q; }

  // ---- placement -------------------------------------------------------
  canPlace(key, x, z) {
    const def = CATALOG[key], st = this.state, g = st.grid;
    if (!def) return { ok: false, reason: '?' };
    if (st.money < def.cost) return { ok: false, reason: 'Not enough dirhams' };
    if (def.unlock && this.popEver() < def.unlock) return { ok: false, reason: `Unlocks at ${def.unlock} residents` };

    if (def.special === 'palm') return this.canPlacePalm(x, z);
    if (key === 'road' || def.zone) {
      if (!inBounds(x, z)) return { ok: false, reason: '' };
      const i = idx(x, z);
      if (g.terrain[i] === T.WATER) return { ok: false, reason: 'That is the sea' };
      if (g.kind[i] !== K.EMPTY) return { ok: false, reason: 'Occupied' };
      return { ok: true };
    }
    if (def.metro) {
      if (!inBounds(x, z)) return { ok: false, reason: '' };
      const i = idx(x, z);
      if (g.metro[i] !== M.NONE) return { ok: false, reason: 'Track exists' };
      if (g.kind[i] === K.BLDG) return { ok: false, reason: 'Blocked by building' };
      return { ok: true }; // metro may cross water & roads (elevated)
    }
    if (def.onTrack) {
      if (!inBounds(x, z)) return { ok: false, reason: '' };
      if (g.metro[idx(x, z)] !== M.TRACK) return { ok: false, reason: 'Place on metro track' };
      return { ok: true };
    }
    // standard building w×d
    const w = def.w || 1, d = def.d || 1;
    let touchesWater = false;
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
      const cx = x + dx, cz = z + dz;
      if (!inBounds(cx, cz)) return { ok: false, reason: 'Out of bounds' };
      const i = idx(cx, cz);
      if (g.terrain[i] === T.WATER) return { ok: false, reason: 'That is the sea' };
      if (g.kind[i] !== K.EMPTY) return { ok: false, reason: 'Occupied' };
    }
    // coast check: any footprint cell adjacent to water
    if (def.coast) {
      for (let dz = -1; dz <= d; dz++) for (let dx = -1; dx <= w; dx++) {
        const cx = x + dx, cz = z + dz;
        if (inBounds(cx, cz) && g.terrain[idx(cx, cz)] === T.WATER) touchesWater = true;
      }
      if (!touchesWater) return { ok: false, reason: 'Must touch the sea' };
    }
    return { ok: true };
  }

  place(key, x, z) {
    const chk = this.canPlace(key, x, z);
    if (!chk.ok) { if (chk.reason) this.emit({ type: 'deny', text: chk.reason }); return false; }
    const def = CATALOG[key], st = this.state, g = st.grid;

    if (def.special === 'palm') return this.placePalm(x, z);

    if (key === 'road') {
      g.kind[idx(x, z)] = K.ROAD;
      g.zone[idx(x, z)] = Z.NONE;
      st.money -= def.cost;
      this.dirty.roads = this.dirty.palms = true;
      return true;
    }
    if (def.zone) {
      g.zone[idx(x, z)] = def.zone;
      st.money -= def.cost;
      this.dirty.zones = this.dirty.palms = true;
      return true;
    }
    if (def.metro) {
      g.metro[idx(x, z)] = M.TRACK;
      st.money -= def.cost;
      this.dirty.metro = true;
      return true;
    }
    if (def.onTrack) {
      g.metro[idx(x, z)] = M.STATION;
      st.money -= def.cost;
      const b = { key, x, z, w: 1, d: 1, level: 1, zone: 0, active: true, age: 0, station: true };
      st.buildings.push(b); // station visual only; doesn't occupy ground kind
      this.dirty.metro = this.dirty.city = true;
      this.coverageDirty = true;
      this.emit({ type: 'build', key });
      return true;
    }
    const b = { key, x, z, w: def.w || 1, d: def.d || 1, level: 1, zone: 0, active: true, age: 0 };
    st.buildings.push(b);
    const bi = st.buildings.length - 1;
    eachCellOf(b, (cx, cz) => { g.kind[idx(cx, cz)] = K.BLDG; g.bIndex[idx(cx, cz)] = bi; g.zone[idx(cx, cz)] = Z.NONE; });
    st.money -= def.cost;
    this.dirty.city = this.dirty.palms = this.dirty.zones = true;
    this.coverageDirty = true;
    this.emit({ type: 'build', key });
    if (def.cat === 'landmarks' || def.cat === 'future') this.emit({ type: 'wonder', key, x, z });
    if (key === 'burj' || key === 'spaceelevator') this.emit({ type: 'fireworks', x, z });
    return true;
  }

  bulldoze(x, z) {
    const st = this.state, g = st.grid, i = idx(x, z);
    if (!inBounds(x, z)) return false;
    if (g.kind[i] === K.ROAD) {
      g.kind[i] = K.EMPTY;
      st.money += CATALOG.road.cost * 0.25;
      this.dirty.roads = true;
      return true;
    }
    const bi = g.bIndex[i];
    if (bi >= 0) {
      const b = st.buildings[bi];
      const def = CATALOG[b.key];
      eachCellOf(b, (cx, cz) => { g.kind[idx(cx, cz)] = K.EMPTY; g.bIndex[idx(cx, cz)] = -1; });
      st.buildings[bi] = null;
      st.money += (def ? def.cost : 100) * 0.25;
      this.compactBuildings();
      this.dirty.city = this.dirty.zones = this.dirty.palms = true;
      this.coverageDirty = true;
      return true;
    }
    if (g.metro[i] !== M.NONE) {
      if (g.metro[i] === M.STATION) {
        const si = st.buildings.findIndex(b => b && b.station && b.x === x && b.z === z);
        if (si >= 0) { st.buildings[si] = null; this.compactBuildings(); this.dirty.city = true; }
        this.coverageDirty = true;
      }
      g.metro[i] = M.NONE;
      st.money += CATALOG.metro.cost * 0.25;
      this.dirty.metro = true;
      return true;
    }
    if (g.zone[i] !== Z.NONE) {
      g.zone[i] = Z.NONE;
      this.dirty.zones = this.dirty.palms = true;
      return true;
    }
    return false;
  }

  compactBuildings() {
    const st = this.state;
    st.buildings = st.buildings.filter(b => b);
    st.grid.bIndex.fill(-1);
    st.buildings.forEach((b, bi) => {
      if (!b.station) eachCellOf(b, (x, z) => { st.grid.bIndex[idx(x, z)] = bi; });
    });
  }

  // ---- Palm Island -------------------------------------------------------
  // Palm Jumeirah in miniature: trunk pointing at the shore (+x), fronds
  // fanning seaward, a crescent breakwater around the tip.
  palmCells(x, z) {
    const set = new Set();
    const add = (cx, cz) => { if (inBounds(cx, cz)) set.add(idx(cx, cz)); };
    for (let t = 0; t < 5; t++) { add(x + t, z); add(x + t, z + 1); }  // trunk
    for (const a of [-0.95, -0.5, 0, 0.5, 0.95]) {                      // fronds
      for (let r = 1; r <= 4; r++)
        add(x - Math.round(r * Math.cos(a)), z + Math.round(r * Math.sin(a) * 1.5));
    }
    for (let i = -4; i <= 4; i++) {                                     // crescent
      const th = i * 0.23;
      add(x - Math.round(6 * Math.cos(th)), z + Math.round(6 * Math.sin(th)));
      add(x + 1 - Math.round(6 * Math.cos(th)), z + Math.round(6 * Math.sin(th)));
    }
    return [...set].map(i => [i % N, (i / N) | 0]);
  }

  waterPalmCells(x, z) {
    return this.palmCells(x, z).filter(([cx, cz]) => this.state.grid.terrain[idx(cx, cz)] === T.WATER);
  }

  canPlacePalm(x, z) {
    if (this.state.palmBuilt) return { ok: false, reason: 'Only one Palm Island' };
    if (!inBounds(x, z)) return { ok: false, reason: '' };
    if (this.state.grid.terrain[idx(x, z)] !== T.WATER)
      return { ok: false, reason: 'Tap the open sea' };
    if (this.waterPalmCells(x, z).length < 25)
      return { ok: false, reason: 'Needs more open sea — tap further out' };
    return { ok: true };
  }

  placePalm(x, z) {
    const chk = this.canPlacePalm(x, z);
    if (!chk.ok) { if (chk.reason) this.emit({ type: 'deny', text: chk.reason }); return false; }
    for (const [cx, cz] of this.waterPalmCells(x, z)) this.state.grid.terrain[idx(cx, cz)] = T.PALM;
    this.state.money -= CATALOG.palm.cost;
    this.state.palmBuilt = true;
    this.dirty.terrain = this.dirty.palms = true;
    this.emit({ type: 'toast', text: '🏝️ Palm Island reclaimed from the Gulf! Build on it.' });
    this.emit({ type: 'wonder', key: 'palm', x, z });
    return true;
  }

  popEver() { return Math.max(this.state.stats.pop, this.state._popEver || 0); }

  // ---- coverage & pollution ---------------------------------------------
  recomputeCoverage() {
    if (!this.coverageDirty) return;
    this.coverageDirty = false;
    for (const s of SERVICES) this.coverage[s].fill(0);
    this.pollution.fill(0);
    for (const b of this.state.buildings) {
      if (!b) continue;
      const def = CATALOG[b.key];
      if (def && def.svc && def.radius) this.splat(this.coverage[def.svc], b, def.radius);
      if (def && def.pollution) this.splat(this.pollution, b, 6);
    }
    // industry pollutes; metro stations grant joy-lite (counted via 'joy')
    for (const b of this.state.buildings) {
      if (!b) continue;
      if (b.zone === Z.I && b.level >= 2) this.splat(this.pollution, b, 4);
      if (b.station) this.splat(this.coverage.joy, b, 4);
    }
  }

  splat(map, b, r) {
    const cx = b.x + (b.w || 1) / 2, cz = b.z + (b.d || 1) / 2;
    const r2 = r * r;
    for (let z = Math.max(0, Math.floor(cz - r)); z < Math.min(N, cz + r); z++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(N, cx + r); x++) {
        const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
        if (dx * dx + dz * dz <= r2) map[idx(x, z)] = 1;
      }
  }

  // ---- per-building happiness --------------------------------------------
  happinessOf(b, powerOK, waterOK, congestion) {
    const i = idx(b.x, b.z);
    let h = 50;
    if (this.coverage.edu[i]) h += 9;
    if (this.coverage.health[i]) h += 9;
    if (this.coverage.safety[i]) h += 7;
    if (this.coverage.fire[i]) h += 5;
    if (this.coverage.joy[i]) h += 12;
    if (this.pollution[i]) h -= 16;
    if (!powerOK) h -= 22;
    if (!waterOK) h -= 22;
    h -= congestion * 18;
    if (this.state.event?.type === 'sandstorm') h -= 8;
    if (this.state.event?.type === 'festival') h += 8;
    return Math.max(0, Math.min(100, h));
  }

  // ---- hourly tick ---------------------------------------------------------
  tickHour(congestion, metroStations) {
    const st = this.state, g = st.grid;
    this.recomputeCoverage();

    // capacities
    let powerCap = 0, waterCap = 0, powerUse = 0, waterUse = 0;
    let pop = 0, jobs = 0, jobsC = 0, jobsI = 0, tourism = 0, soukIncome = 0, trafficCut = 0;
    for (const b of st.buildings) {
      if (!b) continue;
      const def = CATALOG[b.key];
      if (def) {
        powerCap += def.power || 0; waterCap += def.water || 0;
        tourism += def.tourism || 0; soukIncome += def.income || 0;
        trafficCut += def.trafficCut || 0;
        if (def.jobs) jobsC += def.jobs;
      }
      if (b.zone) {
        const zs = ZONE_STATS[b.zone][b.level - 1];
        powerUse += zs.power; waterUse += zs.water;
      } else if (def?.use) {
        powerUse += def.use.power || 0; waterUse += def.use.water || 0;
      } else if (def && !def.power && !def.water) {
        powerUse += 2; waterUse += 1; // services sip utilities
      }
    }
    if (st.event?.type === 'heatwave') powerUse = Math.ceil(powerUse * 1.35);
    // Brownout model: a shortage darkens a stable *fraction* of buildings
    // (never the whole city) so shortages are visible, painful, and — unlike
    // an all-or-nothing cutoff — always recoverable by adding capacity.
    const powerFrac = powerUse > 0 ? Math.min(1, powerCap / powerUse) : 1;
    const waterFrac = waterUse > 0 ? Math.min(1, waterCap / waterUse) : 1;
    const frac = powerFrac * waterFrac;
    const powerOK = powerFrac >= 1, waterOK = waterFrac >= 1;
    if (frac < 1 && !this._shortageWarned) {
      this._shortageWarned = true;
      this.emit({
        type: 'toast',
        text: powerFrac < waterFrac
          ? '⚡ Power shortage — districts are going dark! Build more capacity.'
          : '💧 Water shortage — the taps are sputtering! Build desalination.',
      });
    }
    if (frac >= 1) this._shortageWarned = false;

    // building activity, pop & jobs
    let ci = 0; // stable per-building brownout lottery
    const lit = () => frac >= 1 || ((ci++ * 0.618034) % 1) < frac;
    for (const b of st.buildings) {
      if (!b) continue;
      const bdef = CATALOG[b.key];
      if (bdef?.pop && lit()) pop += bdef.pop; // arcologies house people
      if (!b.zone) continue;
      const on = lit();
      if (on !== (b.active !== false)) this.dirty.city = true;
      b.active = on;
      const zs = ZONE_STATS[b.zone][b.level - 1];
      if (on) {
        if (b.zone === Z.R) pop += zs.pop;
        else if (b.zone === Z.C) jobsC += zs.jobs;
        else jobsI += zs.jobs;
      }
      b.age++;
    }
    jobs = jobsC + jobsI;

    // happiness (sampled over residential)
    let hSum = 0, hN = 0;
    for (const b of st.buildings) {
      if (!b || b.zone !== Z.R) continue;
      hSum += this.happinessOf(b, powerOK, waterOK, congestion); hN++;
    }
    const happiness = hN ? hSum / hN : 60;

    // tourists
    const tourists = Math.round(tourism * (happiness / 100) * (st.event?.type === 'festival' ? 1.6 : 1));

    // demand
    const workers = pop * 0.55;
    const demand = {
      r: clamp((jobs + 30 - workers) * 1.6 + (happiness - 50) * 0.8, 0, 100),
      c: clamp((pop * 0.32 + tourists * 0.5 - jobsC) * 2.5, 0, 100),
      i: clamp((pop * 0.22 - jobsI) * 2.5, 0, 100),
    };

    Object.assign(st.stats, {
      pop, jobs, happiness: Math.round(happiness), tourists,
      traffic: congestion, ridership: metroStations * 9,
      trafficCut: Math.min(0.35, trafficCut),
      power: { cap: powerCap, use: powerUse }, water: { cap: waterCap, use: waterUse },
      demand,
    });
    st._popEver = Math.max(st._popEver || 0, pop);

    // growth & upgrades
    if (powerCap > 0 && waterCap > 0) this.grow(demand, powerOK && waterOK);
    this.tryUpgrade(happiness);

    // clock
    st.hour++;
    if (st.hour >= 24) { st.hour = 0; st.day++; this.tickDay(soukIncome); }
    if (st.event && --st.event.hoursLeft <= 0) {
      this.emit({ type: 'toast', text: st.event.endText || 'The skies clear.' });
      st.event = null;
    }

    this.checkGoals();
    this.checkMilestone();
  }

  grow(demand, utilitiesOK) {
    if (!utilitiesOK) return;
    const st = this.state, g = st.grid;
    const wantR = demand.r > 8 ? 1 + (demand.r / 35 | 0) : 0;
    const wantC = demand.c > 8 ? 1 + (demand.c / 35 | 0) : 0;
    const wantI = demand.i > 8 ? 1 + (demand.i / 35 | 0) : 0;
    const want = { [Z.R]: wantR, [Z.C]: wantC, [Z.I]: wantI };
    // collect growable cells
    const candidates = { [Z.R]: [], [Z.C]: [], [Z.I]: [] };
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      if (g.zone[i] === Z.NONE || g.kind[i] !== K.EMPTY) continue;
      let road = false;
      for (const [dx, dz] of DIRS)
        if (inBounds(x + dx, z + dz) && g.kind[idx(x + dx, z + dz)] === K.ROAD) { road = true; break; }
      if (road) candidates[g.zone[i]].push(i);
    }
    for (const zt of [Z.R, Z.C, Z.I]) {
      for (let n = 0; n < want[zt] && candidates[zt].length; n++) {
        const pick = candidates[zt].splice((Math.random() * candidates[zt].length) | 0, 1)[0];
        const x = pick % N, z = (pick / N) | 0;
        const b = { key: 'zoned', x, z, w: 1, d: 1, level: 1, zone: zt, active: true, age: 0 };
        st.buildings.push(b);
        g.kind[pick] = K.BLDG;
        g.bIndex[pick] = st.buildings.length - 1;
        this.dirty.city = this.dirty.zones = this.dirty.palms = true;
      }
    }
  }

  tryUpgrade(happiness) {
    const st = this.state;
    const zoned = st.buildings.filter(b => b && b.zone && b.active !== false && b.level < 3 && b.age > 8);
    if (!zoned.length) return;
    const b = zoned[(Math.random() * zoned.length) | 0];
    const i = idx(b.x, b.z);
    const needs2 = this.coverage.edu[i] && happiness > 52;
    const needs3 = needs2 && this.coverage.health[i] && this.coverage.joy[i] && happiness > 65;
    if ((b.level === 1 && needs2) || (b.level === 2 && needs3)) {
      if (Math.random() < 0.5) {
        b.level++; b.age = 0;
        this.dirty.city = true;
        this.emit({ type: 'levelup', x: b.x, z: b.z, level: b.level, zone: b.zone });
      }
    }
  }

  tickDay(soukIncome) {
    const st = this.state, s = st.stats;
    let income = s.pop * 2.2 + s.jobs * 2.8 + s.tourists * 4 + soukIncome;
    let expense = 0;
    const g = st.grid;
    for (let i = 0; i < N * N; i++) {
      if (g.kind[i] === K.ROAD) expense += CATALOG.road.maint;
      if (g.metro[i] !== M.NONE) expense += CATALOG.metro.maint;
    }
    for (const b of st.buildings) {
      if (!b) continue;
      const def = CATALOG[b.key];
      if (def) expense += def.maint || 0;
    }
    income *= 1 + (s.happiness - 50) / 250; // happy citizens pay gladly
    s.income = Math.round(income); s.expense = Math.round(expense);
    st.money += income - expense;
    if (st.money < 0) this.emit({ type: 'toast', text: '💸 Treasury empty! Raise income or bulldoze upkeep.' });
    this.emit({ type: 'cash', amount: Math.round(income - expense) });

    // random events
    if (!st.event) {
      const r = Math.random();
      if (r < 0.10) st.event = { type: 'sandstorm', name: '🌪️ Sandstorm!', hoursLeft: 6, endText: 'The sandstorm passes. Everyone shakes out their shoes.' };
      else if (r < 0.17) st.event = { type: 'heatwave', name: '🥵 Heatwave', hoursLeft: 10, endText: 'The heatwave breaks. ACs sigh in relief.' };
      else if (r < 0.25 && s.tourists > 20) st.event = { type: 'festival', name: '🎆 Shopping Festival', hoursLeft: 12, endText: 'The festival ends. The malls glitter on.' };
      if (st.event) this.emit({ type: 'event', event: st.event });
    }
  }

  checkMilestone() {
    const st = this.state;
    const m = MILESTONES[st.milestone];
    if (m && st.stats.pop >= m.pop) {
      st.milestone++;
      st.money += m.reward;
      this.emit({ type: 'milestone', title: m.title, blurb: m.blurb, reward: m.reward });
      this.emit({ type: 'fireworks' });
    }
  }

  checkGoals() {
    const st = this.state, g = st.grid;
    const done = (id) => st.goals[id];
    const finish = (goal) => {
      st.goals[goal.id] = true;
      st.money += goal.reward;
      this.emit({ type: 'goal', text: goal.text, reward: goal.reward });
    };
    for (const goal of GOALS) {
      if (done(goal.id)) continue;
      let ok = false;
      switch (goal.id) {
        case 'highway': ok = g.kind[idx(N - 1, HW_Z)] === K.ROAD; break;
        case 'zoner': { let n = 0; for (let i = 0; i < N * N; i++) if (g.zone[i] === Z.R) n++; ok = n >= 8; break; }
        case 'power': ok = st.stats.power.cap > 0 && st.stats.water.cap > 0; break;
        case 'pop100': ok = st.stats.pop >= 100; break;
        case 'school': ok = st.buildings.some(b => b && b.key === 'school'); break;
        case 'metro': {
          let stations = 0;
          for (let i = 0; i < N * N; i++) if (g.metro[i] === M.STATION) stations++;
          ok = stations >= 2; break;
        }
        case 'wonder': ok = st.palmBuilt || st.buildings.some(b => b && CATALOG[b.key]?.cat === 'landmarks'); break;
      }
      if (ok) finish(goal);
    }
  }

  // ---- inspect -----------------------------------------------------------
  inspect(x, z) {
    if (!inBounds(x, z)) return null;
    const st = this.state, g = st.grid, i = idx(x, z);
    this.recomputeCoverage();
    const bi = g.bIndex[i];
    if (bi >= 0) {
      const b = st.buildings[bi];
      const def = CATALOG[b.key];
      const zs = b.zone ? ZONE_STATS[b.zone][b.level - 1] : null;
      const names = { [Z.R]: ['Desert Villa', 'Apartment Block', 'Marina Tower'], [Z.C]: ['Corner Shop', 'Department Store', 'Glass Office Tower'], [Z.I]: ['Warehouse', 'Factory', 'Logistics Hub'] };
      return {
        title: b.zone ? names[b.zone][b.level - 1] : def?.name || '?',
        icon: b.zone ? ['', '🏠', '🏬', '🏭'][b.zone] : def?.icon,
        lines: [
          b.zone ? `Level ${b.level} / 3` : null,
          zs?.pop ? `👥 ${zs.pop} residents` : null,
          zs?.jobs ? `💼 ${zs.jobs} jobs` : null,
          def?.tourism ? `🧳 +${def.tourism} tourists` : null,
          b.active === false ? '⚠️ No power or water!' : null,
          this.coverage.edu[i] ? '🏫 School nearby' : '🏫 No school coverage',
          this.coverage.health[i] ? '🏥 Clinic nearby' : '🏥 No clinic coverage',
          this.coverage.joy[i] ? '😊 Leisure nearby' : null,
          this.pollution[i] ? '🏭 Polluted air' : null,
        ].filter(Boolean),
      };
    }
    if (g.kind[i] === K.ROAD) return { title: 'Road', icon: '🛣️', lines: ['Drag Bulldoze to remove.'] };
    if (g.metro[i] === M.TRACK) return { title: 'Metro Track', icon: '🚝', lines: ['Add a station here.'] };
    if (g.terrain[i] === T.WATER) return { title: 'The Arabian Gulf', icon: '🌊', lines: ['Warm. Salty. Full of potential islands.'] };
    if (g.zone[i] !== Z.NONE) return { title: 'Zoned Land', icon: '🏗️', lines: ['Waiting for a road, power and water.'] };
    return { title: 'Open Desert', icon: '🏜️', lines: ['Endless sand, endless possibility.'] };
  }
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
