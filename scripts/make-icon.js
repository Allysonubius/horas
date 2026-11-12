'use strict';
// Gera build/icon.png (512x512) sem dependências: um relógio branco sobre fundo azul.
// Uso: npm run icon
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 512;
const SS = 3; // superamostragem para suavizar as bordas
const BG = [37, 99, 235];
const FG = [255, 255, 255];

function distSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Retorna 0 (transparente), 1 (fundo) ou 2 (desenho) para um ponto em coordenadas 0..1. */
function sample(x, y) {
  const r = 0.2; // raio dos cantos do quadrado
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  if (Math.hypot(qx, qy) > r) return 0;
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d > 0.29 && d < 0.35) return 2; // aro
  if (distSegment(x, y, 0.5, 0.5, 0.5, 0.29) < 0.026) return 2; // ponteiro dos minutos
  if (distSegment(x, y, 0.5, 0.5, 0.63, 0.58) < 0.026) return 2; // ponteiro das horas
  return 1;
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1);
  raw[row] = 0; // filtro PNG "none"
  for (let x = 0; x < SIZE; x++) {
    let alpha = 0;
    let fg = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const v = sample((x + (sx + 0.5) / SS) / SIZE, (y + (sy + 0.5) / SS) / SIZE);
        if (v > 0) alpha++;
        if (v === 2) fg++;
      }
    }
    const mix = alpha ? fg / alpha : 0;
    const o = row + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[o + c] = Math.round(BG[c] + (FG[c] - BG[c]) * mix);
    raw[o + 3] = Math.round((alpha / (SS * SS)) * 255);
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(zlib.crc32(body), body.length + 4);
  return out;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('Ícone gerado em ' + out);
