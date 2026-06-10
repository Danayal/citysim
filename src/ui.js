import { CATALOG, CATEGORIES, MILESTONES } from './constants.js';
import { GOALS } from './simulation.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const fmt = (n) => 'AED ' + Math.round(n).toLocaleString('en-US');

export class UI {
  constructor(state, sounds, cb) {
    this.state = state;
    this.sounds = sounds;
    this.cb = cb;           // {onTool, onSpeed, onNewCity, onHeatmap}
    this.tool = 'pan';
    this.category = 'transport';
    this.buildBars();
    this.buildToolbar();
    this.buildPanels();
    this.toastTimer = null;
  }

  // ---- top HUD -----------------------------------------------------------
  buildBars() {
    const top = $('#topbar');
    top.innerHTML = `
      <div class="hud-row">
        <span id="cityname"></span>
        <span id="money" class="gold"></span>
        <span id="pop">👥 0</span>
        <span id="happy">😐 60%</span>
        <span id="clock">☀️ Day 1</span>
        <span id="eventbadge" class="hidden"></span>
      </div>
      <div class="hud-row small">
        <span id="powerbar" title="Power">⚡ <i></i></span>
        <span id="waterbar" title="Water">💧 <i></i></span>
        <span class="demand">R<b id="dr"></b>C<b id="dc"></b>I<b id="di"></b></span>
        <span id="traffic">🚗 0%</span>
        <span id="tourists">🧳 0</span>
        <span class="spacer"></span>
        <button id="speed0" class="spd">⏸</button>
        <button id="speed1" class="spd on">▶</button>
        <button id="speed2" class="spd">⏩</button>
        <button id="btn-goals">🎯</button>
        <button id="btn-menu">☰</button>
      </div>`;
    [0, 1, 2].forEach(i => $('#speed' + i).addEventListener('click', () => {
      this.sounds.tap(); this.cb.onSpeed(i); this.refreshSpeed(i);
    }));
    $('#btn-goals').addEventListener('click', () => { this.sounds.tap(); this.togglePanel('goals'); });
    $('#btn-menu').addEventListener('click', () => { this.sounds.tap(); this.togglePanel('menu'); });
  }

  refreshSpeed(i) {
    [0, 1, 2].forEach(s => $('#speed' + s).classList.toggle('on', s === i));
  }

  // ---- bottom toolbar ------------------------------------------------------
  buildToolbar() {
    const cats = $('#cats');
    for (const c of CATEGORIES) {
      const b = el('button', 'cat', `${c.icon}<span>${c.name}</span>`);
      b.dataset.id = c.id;
      b.addEventListener('click', () => { this.sounds.tap(); this.setCategory(c.id); });
      cats.appendChild(b);
    }
    const pan = el('button', 'cat', `🖐️<span>Look</span>`);
    pan.dataset.id = 'pan';
    pan.addEventListener('click', () => { this.sounds.tap(); this.setTool('pan'); });
    cats.prepend(pan);
    this.setCategory('transport');
    this.setTool('pan');
  }

  setCategory(id) {
    this.category = id;
    document.querySelectorAll('.cat').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    const items = $('#items');
    items.innerHTML = '';
    items.classList.remove('hidden');
    for (const [key, def] of Object.entries(CATALOG)) {
      if (def.cat !== id) continue;
      const locked = def.unlock && this.maxPop() < def.unlock;
      const b = el('button', 'item' + (locked ? ' locked' : ''),
        `<span class="i">${def.icon}</span><span class="n">${def.name}</span>` +
        `<span class="c">${locked ? '🔒 ' + def.unlock + ' pop' : def.cost ? fmt(def.cost) : ''}</span>`);
      b.dataset.key = key;
      b.addEventListener('click', () => {
        if (def.unlock && this.maxPop() < def.unlock) {
          this.sounds.deny();
          this.toast(`🔒 Unlocks at ${def.unlock} residents`);
          return;
        }
        this.sounds.tap();
        this.setTool(key);
        this.toast(`${def.icon} ${def.name} — ${def.desc || ''}`, 3500);
      });
      items.appendChild(b);
    }
  }

  maxPop() { return Math.max(this.state.stats.pop, this.state._popEver || 0); }

  setTool(key) {
    this.tool = key;
    if (key === 'heatmap') this.cb.onHeatmap();
    document.querySelectorAll('.item').forEach(b => b.classList.toggle('on', b.dataset.key === key));
    document.querySelector('.cat[data-id="pan"]')?.classList.toggle('on', key === 'pan');
    if (key === 'pan') $('#items').classList.add('hidden');
    this.cb.onTool(key);
    $('#hint').textContent = key === 'pan'
      ? 'Drag to look around · pinch to zoom · twist to rotate'
      : CATALOG[key]?.drag
        ? 'Drag with one finger to build · two fingers to move camera'
        : 'Tap to place · two fingers to move camera';
  }

  // ---- panels --------------------------------------------------------------
  buildPanels() {
    const root = $('#panels');
    root.appendChild(el('div', 'panel hidden', '')).id = 'p-inspect';
    const goals = root.appendChild(el('div', 'panel hidden'));
    goals.id = 'p-goals';
    const menu = root.appendChild(el('div', 'panel hidden'));
    menu.id = 'p-menu';
    menu.innerHTML = `
      <h3>🏗️ Mirage City: Dubai</h3>
      <button id="m-sound"></button>
      <button id="m-save">💾 Save now</button>
      <button id="m-new">🗑️ Start a new city</button>
      <button id="m-close">Close</button>
      <p class="tiny">Tip: install via Share → “Add to Home Screen” to play full-screen offline.</p>`;
    $('#m-sound').addEventListener('click', () => {
      this.state.muted = this.sounds.muted = !this.sounds.muted;
      this.refreshMenu(); this.sounds.tap();
    });
    $('#m-save').addEventListener('click', () => { this.cb.onSave(); this.toast('💾 Saved'); });
    $('#m-new').addEventListener('click', () => {
      if (confirm('Bulldoze EVERYTHING and start fresh?')) this.cb.onNewCity();
    });
    $('#m-close').addEventListener('click', () => this.togglePanel(null));
  }

  refreshMenu() {
    $('#m-sound').textContent = this.sounds.muted ? '🔇 Sound: off' : '🔊 Sound: on';
  }

  togglePanel(which) {
    for (const id of ['inspect', 'goals', 'menu']) {
      const p = $('#p-' + id);
      const show = which === id && p.classList.contains('hidden');
      p.classList.toggle('hidden', !show);
      if (show && id === 'goals') this.renderGoals();
      if (show && id === 'menu') this.refreshMenu();
    }
  }

  renderGoals() {
    const p = $('#p-goals');
    const rows = GOALS.map(g => {
      const done = this.state.goals[g.id];
      return `<div class="goal ${done ? 'done' : ''}">${done ? '✅' : '⬜'} ${g.text} <span class="gold">+${g.reward}</span></div>`;
    }).join('');
    const m = MILESTONES[this.state.milestone];
    p.innerHTML = `<h3>🎯 Goals</h3>${rows}
      <h3>🏆 Next milestone</h3>
      <div class="goal">${m ? `${m.pop} residents → <b>${m.title}</b> <span class="gold">+${m.reward}</span>` : 'All milestones achieved — your skyline is legend.'}</div>
      <button onclick="this.parentElement.classList.add('hidden')">Close</button>`;
  }

  showInspect(info) {
    const p = $('#p-inspect');
    if (!info) { p.classList.add('hidden'); return; }
    $('#p-goals').classList.add('hidden');
    $('#p-menu').classList.add('hidden');
    p.innerHTML = `<h3>${info.icon || ''} ${info.title}</h3>` +
      info.lines.map(l => `<div class="goal">${l}</div>`).join('') +
      `<button onclick="this.parentElement.classList.add('hidden')">Close</button>`;
    p.classList.remove('hidden');
  }

  // ---- HUD refresh -----------------------------------------------------------
  updateHUD() {
    const st = this.state, s = st.stats;
    $('#cityname').textContent = '🏜️ ' + st.cityName;
    $('#money').textContent = fmt(st.money);
    $('#money').classList.toggle('bad', st.money < 0);
    $('#pop').textContent = '👥 ' + s.pop.toLocaleString();
    $('#happy').textContent = (s.happiness >= 70 ? '😊 ' : s.happiness >= 45 ? '😐 ' : '😠 ') + s.happiness + '%';
    const h = Math.floor(st.hour);
    const icon = h >= 6 && h < 18 ? '☀️' : '🌙';
    $('#clock').textContent = `${icon} Day ${st.day} · ${String(h).padStart(2, '0')}:00`;
    setBar('#powerbar i', s.power.use, s.power.cap);
    setBar('#waterbar i', s.water.use, s.water.cap);
    $('#dr').style.height = 3 + s.demand.r * 0.09 + 'px';
    $('#dc').style.height = 3 + s.demand.c * 0.09 + 'px';
    $('#di').style.height = 3 + s.demand.i * 0.09 + 'px';
    $('#traffic').textContent = '🚗 ' + Math.round(s.traffic * 100) + '%';
    $('#traffic').classList.toggle('bad', s.traffic > 0.4);
    $('#tourists').textContent = '🧳 ' + s.tourists;
    const ev = st.event;
    const badge = $('#eventbadge');
    badge.classList.toggle('hidden', !ev);
    if (ev) badge.textContent = ev.name;
    // unlock refresh on landmark tab
    if (this.category === 'landmarks') {
      document.querySelectorAll('.item.locked').forEach(b => {
        const def = CATALOG[b.dataset.key];
        if (def.unlock && this.maxPop() >= def.unlock) this.setCategory('landmarks');
      });
    }
  }

  // ---- events from sim ---------------------------------------------------
  handleSimEvents(events, effects, input) {
    for (const e of events) {
      switch (e.type) {
        case 'toast': this.toast(e.text); break;
        case 'deny': this.toast('🚫 ' + e.text, 1800); this.sounds.deny(); break;
        case 'build': this.sounds.build(); break;
        case 'cash': if (e.amount > 0) this.sounds.cash(); break;
        case 'goal': this.toast(`🎯 Goal complete: ${e.text} <b class="gold">+${fmt(e.reward)}</b>`, 4200); this.sounds.cash(); break;
        case 'event': this.toast(e.event.name, 4000); this.sounds.whoosh(); break;
        case 'levelup': this.sounds.tone(520, 0.12, 'triangle', 0.07, 180); break;
        case 'wonder': this.toast('🌟 A Wonder rises! Tourists incoming.', 3600); this.sounds.cash(); break;
        case 'fireworks': effects.launchFireworks(); this.sounds.boom(); break;
        case 'milestone':
          this.modal(`🏆 ${e.title}`, `${e.blurb}<br><br><b class="gold">Reward: ${fmt(e.reward)}</b>`);
          effects.launchFireworks();
          this.sounds.boom();
          break;
      }
    }
  }

  toast(html, ms = 2600) {
    const t = $('#toast');
    t.innerHTML = html;
    t.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  modal(title, html) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-card"><h2>${title}</h2><p>${html}</p><button id="modal-ok">Continue</button></div>`;
    m.classList.remove('hidden');
    $('#modal-ok').addEventListener('click', () => m.classList.add('hidden'));
  }
}

function setBar(sel, use, cap) {
  const i = $(sel);
  const r = cap > 0 ? Math.min(1, use / cap) : 1;
  i.style.width = (cap > 0 ? Math.round(r * 100) : 100) + '%';
  i.parentElement.classList.toggle('bad', use > cap);
}
