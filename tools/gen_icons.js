// Generates icons/icon-180.png and icons/icon-512.png (no dependencies).
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeIcon(S) {
  const img = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    img[i] = r; img[i + 1] = g; img[i + 2] = b; img[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, r, g, b) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) set(x, y, r, g, b);
  };
  const u = S / 100; // unit

  // dusk sky gradient
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = Math.round(12 + t * 180), g = Math.round(20 + t * 90), b = Math.round(48 + t * 30);
    for (let x = 0; x < S; x++) set(x, y, r, g, b);
  }
  // sun
  const sx = 70 * u, sy = 58 * u, sr = 11 * u;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = (x - sx) ** 2 + (y - sy) ** 2;
    if (d < sr * sr) set(x, y, 255, 205, 95);
  }
  // sea
  rect(0, Math.round(76 * u), S, S, 20, 110, 140);
  // sand strip
  rect(0, Math.round(70 * u), S, Math.round(76 * u), 226, 201, 143);
  // skyline silhouettes (navy)
  const sky = (x0, w, hTop) => rect(Math.round(x0 * u), Math.round(hTop * u), Math.round((x0 + w) * u), Math.round(70 * u), 16, 24, 48);
  sky(8, 7, 42); sky(18, 6, 50); sky(26, 9, 36); sky(38, 6, 46); sky(58, 8, 40); sky(70, 6, 48); sky(80, 9, 44);
  // Burj Khalifa: tapering gold-edged spire
  for (let i = 0; i < 5; i++) {
    const w = 9 - i * 1.7, top = 38 - i * 7.5;
    rect(Math.round((48 - w / 2) * u), Math.round(top * u), Math.round((48 + w / 2) * u), Math.round(70 * u), 16, 24, 48);
  }
  rect(Math.round(47.4 * u), Math.round(3 * u), Math.round(48.6 * u), Math.round(70 * u), 16, 24, 48);
  // golden window lights
  for (let i = 0; i < 60; i++) {
    const x = Math.round((10 + (i * 13) % 80) * u), y = Math.round((40 + (i * 7) % 28) * u);
    rect(x, y, x + Math.max(1, Math.round(u)), y + Math.max(1, Math.round(u)), 255, 215, 94);
  }
  return png(S, S, img);
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon-180.png'), makeIcon(180));
fs.writeFileSync(path.join(out, 'icon-512.png'), makeIcon(512));
console.log('icons written');
