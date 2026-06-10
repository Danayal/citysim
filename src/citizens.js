import { Z, CATALOG, idx, inBounds, K, N } from './constants.js';
import { findPath } from './roads.js';

// Agent layer: a capped pool of named citizens, each living in a real house,
// working a real job, driving real routes. Each agent is a "featured
// household" — the population number stays statistical, but every car on the
// road belongs to someone you can tap.
const FIRST = ['Ahmed', 'Fatima', 'Omar', 'Layla', 'Hassan', 'Aisha', 'Khalid', 'Mariam', 'Yusuf', 'Noor',
  'Zayed', 'Hessa', 'Saeed', 'Amna', 'Rashid', 'Salama', 'Hamdan', 'Latifa', 'Majid', 'Shamma',
  'Ali', 'Dana', 'Tariq', 'Reem', 'Faisal', 'Maha', 'Sultan', 'Alya', 'Nasser', 'Moza'];
const LAST = ['Al-Maktoum', 'Al-Falasi', 'Al-Suwaidi', 'Al-Mansouri', 'Al-Qasimi', 'Al-Mazrouei',
  'Al-Shamsi', 'Al-Nuaimi', 'Al-Ketbi', 'Al-Marri', 'Al-Habtoor', 'Al-Awadhi', 'Al-Hashimi',
  'Khan', 'Patel', 'Fernandes', 'Haddad', 'Bukhari', 'Rahimi', 'Osman'];
const FACES = ['👨', '👩', '🧔', '👵', '👴', '👱‍♀️', '🧕', '👨‍🦱', '👩‍🦰', '🧑'];
const C_ROLES = ['shopkeeper', 'barista', 'gold trader', 'concierge', 'perfume seller', 'tour guide', 'chef', 'cashier'];
const I_ROLES = ['crane operator', 'logistics planner', 'warehouse lead', 'engineer', 'dock worker', 'technician'];
const LEISURE = ['sipping karak chai', 'haggling for spices', 'photographing the skyline', 'feeding seagulls',
  'playing tawla', 'showing off a new falcon photo', 'eating shawarma', 'window-shopping for gold'];

export const AGENT_CAP = 240;
const JOY_KEYS = new Set(['park', 'souk', 'mosque', 'fountain', 'mall', 'frame', 'museum', 'burjalarab', 'burj', 'spaceelevator', 'vertfarm']);

export function buildingName(b) {
  if (!b) return '?';
  if (b.rubble) return 'Burnt Ruins';
  const names = {
    [Z.R]: ['Desert Villa', 'Apartment Block', 'Marina Tower'],
    [Z.C]: ['Corner Shop', 'Department Store', 'Glass Office Tower'],
    [Z.I]: ['Warehouse', 'Factory', 'Logistics Hub'],
  };
  return b.zone ? names[b.zone][b.level - 1] : (CATALOG[b.key]?.name || '?');
}

let nextId = 1;

export class Citizens {
  constructor() {
    this.list = [];
    this.dirty = true;
    this.stats = { employment: 1, avgCommute: 0, agents: 0 };
  }

  invalidate() { this.dirty = true; }

  agentsFor(b) { return b.zone === Z.R ? [2, 4, 6][b.level - 1] : 0; }
  slotsFor(b) {
    if (b.rubble || b.burning) return 0;
    if (b.zone === Z.C || b.zone === Z.I) return [2, 4, 6][b.level - 1];
    const def = CATALOG[b.key];
    return def?.jobs ? Math.min(6, Math.ceil(def.jobs / 20)) : 0;
  }

  newCitizen(home) {
    const id = nextId++;
    return {
      id,
      name: FIRST[id * 7 % FIRST.length] + ' ' + LAST[id * 13 % LAST.length],
      face: FACES[id % FACES.length],
      home, work: null, role: null,
      state: 'home',          // home|toWork|work|toHome|toLeisure|leisure|mosque
      shift: id % 3,          // staggered rush hours
      hap: 65, commuteLen: 0, noRoad: false,
      car: null, leisureSpot: null, leisureLine: LEISURE[id % LEISURE.length],
    };
  }

  // Reconcile agents with the building stock (homes appear/burn/get bulldozed).
  sync(state) {
    // cheap change signature so growth during long tick batches is noticed
    let sig = state.buildings.length | 0;
    for (const b of state.buildings) sig = (sig * 31 + (b ? b.level + (b.rubble ? 7 : 0) + (b.burning ? 13 : 0) : 3)) | 0;
    if (!this.dirty && sig === this._sig) return;
    this._sig = sig;
    this.dirty = false;
    const alive = new Set(state.buildings.filter(Boolean));
    this.list = this.list.filter(c => alive.has(c.home) && !c.home.rubble);
    for (const c of this.list) {
      if (c.work && (!alive.has(c.work) || this.slotsFor(c.work) === 0)) { c.work = null; c.role = null; }
      if (c.leisureSpot && !alive.has(c.leisureSpot)) { c.leisureSpot = null; if (c.state === 'leisure' || c.state === 'toLeisure') c.state = 'home'; }
      // in-flight cars clean themselves up via their onArrive callback
    }
    const byHome = new Map();
    for (const c of this.list) byHome.set(c.home, (byHome.get(c.home) || 0) + 1);
    for (const b of state.buildings) {
      if (!b || b.zone !== Z.R || b.rubble) continue;
      let want = this.agentsFor(b) - (byHome.get(b) || 0);
      while (want-- > 0 && this.list.length < AGENT_CAP) this.list.push(this.newCitizen(b));
    }
    // job market: fill openings with the nearest unemployed citizen
    const staff = new Map();
    for (const c of this.list) if (c.work) staff.set(c.work, (staff.get(c.work) || 0) + 1);
    const openings = [];
    for (const b of state.buildings) {
      if (!b) continue;
      const free = this.slotsFor(b) - (staff.get(b) || 0);
      for (let i = 0; i < free; i++) openings.push(b);
    }
    for (const c of this.list) {
      if (c.work || !openings.length) continue;
      let best = -1, bd = 1e9;
      for (let i = 0; i < openings.length; i++) {
        const w = openings[i];
        const d = Math.abs(w.x - c.home.x) + Math.abs(w.z - c.home.z);
        if (d < bd) { bd = d; best = i; }
      }
      const w = openings.splice(best, 1)[0];
      c.work = w;
      c.role = (w.zone === Z.I ? I_ROLES : C_ROLES)[c.id % 6];
    }
  }

  roadBeside(state, b) {
    const { kind } = state.grid;
    for (let dz = -1; dz <= (b.d || 1); dz++) for (let dx = -1; dx <= (b.w || 1); dx++) {
      const x = b.x + dx, z = b.z + dz;
      if (inBounds(x, z) && kind[idx(x, z)] === K.ROAD) return [x, z];
    }
    return null;
  }

  travel(c, from, to, newState, arriveState, state, traffic) {
    const a = this.roadBeside(state, from), b = this.roadBeside(state, to);
    c.state = newState;
    if (!a || !b) { c.noRoad = true; c.state = arriveState; return; }
    const path = findPath(state.grid.kind, a[0], a[1], b[0], b[1]);
    if (!path || path.length < 2) { c.noRoad = true; c.state = arriveState; return; }
    c.noRoad = false;
    c.commuteLen = path.length;
    const car = traffic.spawnTrip({
      path, kind: 'citizen', citizen: c,
      onArrive: () => { c.car = null; c.state = arriveState; },
    });
    if (car) c.car = car; else c.state = arriveState; // roads full — they got a ride
  }

  nearestJoy(state, c) {
    let best = null, bd = 1e9;
    for (const b of state.buildings) {
      if (!b || b.rubble || b.burning) continue;
      if (!(JOY_KEYS.has(b.key) || (b.zone === Z.C && b.level >= 2))) continue;
      const d = Math.abs(b.x - c.home.x) + Math.abs(b.z - c.home.z);
      if (d < bd && d > 2) { bd = d; best = b; }
    }
    return bd <= 26 ? best : null;
  }

  tickHour(state, sim, traffic) {
    this.sync(state);
    const hour = state.hour, friday = state.day % 7 === 5;
    let employed = 0, commuteSum = 0, commuteN = 0, hapSum = 0;
    for (const c of this.list) {
      const ws = 8 + c.shift, we = 16 + c.shift;
      if (c.work) {
        employed++;
        if (hour === ws && (c.state === 'home' || c.state === 'leisure'))
          this.travel(c, c.home, c.work, 'toWork', 'work', state, traffic);
        if (hour === we && c.state === 'work')
          this.travel(c, c.work, c.home, 'toHome', 'home', state, traffic);
      }
      if (friday && hour === 12 && (c.state === 'home' || c.state === 'leisure')) c.state = 'mosque';
      if (c.state === 'mosque' && hour === 14) c.state = 'home';
      if (c.state === 'home' && hour === 19 + (c.id % 3) && Math.random() < 0.45) {
        const spot = this.nearestJoy(state, c);
        if (spot) { c.leisureSpot = spot; this.travel(c, c.home, spot, 'toLeisure', 'leisure', state, traffic); }
      }
      if (c.state === 'leisure' && (hour === 23 || hour === 0)) c.state = 'home';

      // personal happiness — employment, commute and neighbourhood
      const hi = idx(c.home.x, c.home.z);
      let h = 55 + (c.work ? 14 : -18);
      if (c.commuteLen > 0) h += c.commuteLen <= 10 ? 8 : c.commuteLen > 22 ? -14 : 0;
      if (c.noRoad) h -= 12;
      if (sim.coverage.joy[hi]) h += 8;
      if (sim.pollution[hi]) h -= 10;
      c.hap = Math.max(5, Math.min(100, Math.round(h)));
      hapSum += c.hap;
      if (c.work && c.commuteLen) { commuteSum += c.commuteLen; commuteN++; }
    }
    this.stats = {
      agents: this.list.length,
      employment: this.list.length ? employed / this.list.length : 1,
      avgCommute: commuteN ? commuteSum / commuteN : 0,
      mood: this.list.length ? Math.round(hapSum / this.list.length) : 65,
    };
  }

  residentsOf(b) { return this.list.filter(c => c.home === b); }
  workersOf(b) { return this.list.filter(c => c.work === b); }

  describe(c) {
    switch (c.state) {
      case 'home': return c.noRoad && c.work ? 'stuck at home — no road to work!' : 'relaxing at home';
      case 'toWork': return `driving to work at ${buildingName(c.work)}` + (c.commuteLen > 22 ? ' (and hating this commute)' : '');
      case 'work': return `working as ${c.role || 'staff'} at ${buildingName(c.work)}`;
      case 'toHome': return 'driving home';
      case 'toLeisure': return `heading out to ${buildingName(c.leisureSpot)}`;
      case 'leisure': return `${c.leisureLine} at ${buildingName(c.leisureSpot)}`;
      case 'mosque': return 'at Friday prayers 🕌';
      default: return '...';
    }
  }

  whereIs(c) {
    // [building, orNull] for camera following when not in a car
    if (c.state === 'work') return c.work;
    if (c.state === 'leisure') return c.leisureSpot;
    return c.home;
  }
}
