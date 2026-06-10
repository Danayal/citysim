// Bundles the whole game (Three.js included) into one self-contained HTML
// file you can open directly in Safari — no server, no install.
// Usage: node tools/build_single.js   (needs esbuild, e.g. in /tmp/node_modules)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const esbuild = path.join(process.env.ESBUILD_DIR || '/tmp/node_modules', '.bin', 'esbuild');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });

execFileSync(esbuild, [
  path.join(root, 'src', 'main.js'),
  '--bundle', '--minify', '--format=iife',
  `--alias:three=${path.join(root, 'vendor', 'three.module.js')}`,
  `--outfile=${path.join(out, 'bundle.js')}`,
], { stdio: 'inherit' });

const js = fs.readFileSync(path.join(out, 'bundle.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const icon = fs.readFileSync(path.join(root, 'icons', 'icon-180.png')).toString('base64');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Mirage City: Dubai</title>
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0c1430">
<link rel="icon" href="data:image/png;base64,${icon}">
<link rel="apple-touch-icon" href="data:image/png;base64,${icon}">
<style>${css}</style>
</head>
<body>
<canvas id="game"></canvas>
<div id="topbar"></div>
<div id="toast" class="hidden"></div>
<div id="panels"></div>
<div id="bottombar">
  <div id="hint">Drag to look around · pinch to zoom</div>
  <div id="items" class="hidden"></div>
  <div id="cats"></div>
</div>
<div id="modal" class="hidden"></div>
<script>${js}</script>
</body>
</html>`;

const file = path.join(out, 'MirageCityDubai.html');
fs.writeFileSync(file, html);
fs.unlinkSync(path.join(out, 'bundle.js'));
console.log('wrote', file, (fs.statSync(file).size / 1024 / 1024).toFixed(2), 'MB');
