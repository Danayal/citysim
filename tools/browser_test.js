// End-to-end render test: boots the game in headless Chrome, builds a city,
// and saves screenshots. Usage: node tools/browser_test.js
// Requires puppeteer (install anywhere and set PUPPETEER_DIR, default /tmp/node_modules).
const path = require('path');
const http = require('http');
const fs = require('fs');

const puppeteer = require(path.join(process.env.PUPPETEER_DIR || '/tmp/node_modules', 'puppeteer'));
const root = path.join(__dirname, '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(root, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nope'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise(r => server.listen(8123, r));
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--no-proxy-server', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  await page.goto('http://127.0.0.1:8123/', { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 4000));

  const booted = await page.evaluate(() => !!window.__game && !!window.__game.state);
  console.log('game booted:', booted);

  await page.screenshot({ path: '/tmp/shot-1-start.png' });

  // dismiss welcome modal
  await page.evaluate(() => document.getElementById('modal-ok')?.click());

  // build a city through the sim API (same code paths the touch UI calls)
  await page.evaluate(() => {
    const { sim, state, input } = window.__game;
    state.money = 1e9;
    for (let x = 47; x >= 14; x--) sim.place('road', x, 24);
    for (let z = 10; z <= 38; z++) sim.place('road', 20, z);
    for (let z = 26; z <= 38; z++) sim.place('road', 28, z);
    for (let x = 21; x <= 27; x++) sim.place('road', x, 32);
    for (let z = 10; z <= 38; z++) { sim.place('zoneR', 19, z); sim.place('zoneC', 21, z); }
    for (let x = 22; x <= 27; x++) { sim.place('zoneR', x, 31); sim.place('zoneC', x, 33); }
    for (let x = 30; x <= 38; x++) sim.place('zoneI', x, 25);
    let desal = null;
    for (let z = 8; z <= 40 && !desal; z++) for (let x = 2; x <= 16 && !desal; x++)
      if (sim.canPlace('desal', x, z).ok) desal = [x, z];
    sim.place('desal', desal[0], desal[1]);
    sim.place('solar', 24, 12); sim.place('gas', 24, 16);
    sim.place('school', 16, 14); sim.place('hospital', 16, 20);
    sim.place('mosque', 16, 26); sim.place('park', 18, 30); sim.place('souk', 23, 35);
    for (let x = 16; x <= 34; x++) sim.place('metro', x, 8);
    sim.place('station', 18, 8); sim.place('station', 32, 8);
    window.__game.tickHours(120);
    state._popEver = 99999; // unlock landmarks for the render test
    sim.place('fountain', 24, 28); sim.place('frame', 33, 30);
    sim.place('museum', 36, 33); sim.place('mall', 31, 35);
    let arab = null;
    for (let z = 30; z <= 44 && !arab; z++) for (let x = 2; x <= 16 && !arab; x++)
      if (sim.canPlace('burjalarab', x, z).ok) arab = [x, z];
    if (arab) sim.place('burjalarab', arab[0], arab[1]);
    sim.place('burj', 24, 20);
    let palm = null;
    for (let z = 8; z <= 40 && !palm; z++) for (let x = 1; x <= 9 && !palm; x++)
      if (sim.canPlacePalm(x, z).ok) palm = [x, z];
    if (palm) sim.placePalm(palm[0], palm[1]);
    window.__game.tickHours(48);
    state.hour = 14; // afternoon light
    input.target.set(0, 0, 10); input.yaw = -0.9; input.pitch = 0.7; input.dist = 120; input.apply();
  });
  await new Promise(r => setTimeout(r, 3000));
  // dismiss any milestone modal raised while fast-forwarding
  await page.evaluate(() => document.getElementById('modal')?.classList.add('hidden'));
  const stats = await page.evaluate(() => JSON.stringify(window.__game.state.stats));
  console.log('stats:', stats);
  await page.screenshot({ path: '/tmp/shot-2-city.png' });

  // night view
  await page.evaluate(() => { window.__game.state.hour = 21; });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: '/tmp/shot-3-night.png' });

  // UI interaction: select road tool and drag-paint on the canvas
  await page.evaluate(() => {
    window.__game.state.hour = 10;
    document.getElementById('modal')?.classList.add('hidden');
  });
  await page.tap('.cat[data-id="transport"]');
  await page.tap('.item[data-key="road"]');
  await new Promise(r => setTimeout(r, 400));
  const before = await page.evaluate(() => {
    let n = 0; const k = window.__game.state.grid.kind;
    for (let i = 0; i < k.length; i++) if (k[i] === 1) n++;
    return n;
  });
  await page.touchscreen.touchStart(120, 400);
  for (let i = 1; i <= 8; i++) await page.touchscreen.touchMove(120 + i * 18, 400);
  await page.touchscreen.touchEnd();
  await new Promise(r => setTimeout(r, 600));
  const after = await page.evaluate(() => {
    let n = 0; const k = window.__game.state.grid.kind;
    for (let i = 0; i < k.length; i++) if (k[i] === 1) n++;
    return n;
  });
  console.log('roads painted by touch drag:', after - before, '(before', before, '→ after', after + ')');
  await page.screenshot({ path: '/tmp/shot-4-paint.png' });

  // sandstorm + fireworks
  await page.evaluate(() => {
    window.__game.state.event = { type: 'sandstorm', name: '🌪️ Sandstorm!', hoursLeft: 6 };
    window.__game.effects.launchFireworks();
  });
  await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: '/tmp/shot-5-storm.png' });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
