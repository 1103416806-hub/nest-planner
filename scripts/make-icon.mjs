import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

// Original Nest sprout artwork. Supersampling keeps the 256 px icon crisp at every size.
const size = 256;
const supersampling = 4;
const palette = { background: [70, 94, 133], leaf: [249, 251, 255], lightLeaf: [215, 229, 248] };

function cubic(a, b, c, d) {
  return Array.from({ length: 41 }, (_, index) => {
    const t = index / 40, s = 1 - t;
    return [s ** 3 * a[0] + 3 * s ** 2 * t * b[0] + 3 * s * t ** 2 * c[0] + t ** 3 * d[0],
      s ** 3 * a[1] + 3 * s ** 2 * t * b[1] + 3 * s * t ** 2 * c[1] + t ** 3 * d[1]];
  });
}

const leftLeaf = [...cubic([129, 132], [82, 134], [59, 108], [63, 79]),
  ...cubic([63, 79], [104, 76], [132, 98], [129, 132])];
const rightLeaf = [...cubic([128, 107], [121, 72], [146, 48], [181, 50]),
  ...cubic([181, 50], [184, 83], [159, 110], [128, 107])];

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function sample(x, y) {
  if (Math.hypot(x - 128, y - 128) > 120) return [0, 0, 0, 0];
  const stem = Math.hypot(x - 128, y - Math.min(185, Math.max(103, y))) < 5.5;
  if (stem || inPolygon(x, y, leftLeaf)) return [...palette.leaf, 255];
  if (inPolygon(x, y, rightLeaf)) return [...palette.lightLeaf, 255];
  return [...palette.background, 255];
}

const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const total = [0, 0, 0, 0];
    for (let sy = 0; sy < supersampling; sy++) for (let sx = 0; sx < supersampling; sx++) {
      const pixel = sample(x + (sx + 0.5) / supersampling, y + (sy + 0.5) / supersampling);
      for (let channel = 0; channel < 3; channel++) total[channel] += pixel[channel] * pixel[3] / 255;
      total[3] += pixel[3];
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    for (let channel = 0; channel < 3; channel++) raw[offset + channel] = total[3] ? Math.round(total[channel] * 255 / total[3]) : 0;
    raw[offset + 3] = Math.round(total[3] / supersampling ** 2);
  }
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii'), body = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);

// ICO supports a PNG-encoded 256×256 image; dimension bytes of 0 represent 256.
const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);
const ico = Buffer.concat([icoHeader, png]);
const destination = fileURLToPath(new URL('../electron/', import.meta.url));
await mkdir(destination, { recursive: true });
await writeFile(path.join(destination, 'icon.png'), png);
await writeFile(path.join(destination, 'icon.ico'), ico);
console.log(`Created ${size}×${size} original sprout icon: electron/icon.png and electron/icon.ico`);

