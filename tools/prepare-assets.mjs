// Prepares game-ready assets from the supplied artwork WITHOUT modifying the sources.
// Output goes to public/assets. Run: npm run assets
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets');
mkdirSync(out, { recursive: true });
const debug = process.argv.includes('--debug');

const SHOWDOWN = path.join(root, 'Assets', 'ui', 'main ui', 'Apex Ryders Highway Showdown.png');
const COLLECT = path.join(root, 'Assets', 'collectibles', 'Apex Ryders Collectables Road Sheet.png');
const LOGO = path.join(root, 'Assets', 'logo', 'Apex Ryders Logo Sticker.png');

/**
 * Cut a sprite out of an illustration: crop, then flood-fill from the crop border
 * through "background-like" pixels (as decided by isBg) and make them transparent.
 */
async function cutout(src, box, isBg, name, opts = {}) {
  const { data, info } = await sharp(src).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const bg = new Uint8Array(w * h);
  const stack = [];
  const test = (x, y) => {
    const i = (y * w + x) * 4;
    return isBg(data[i], data[i + 1], data[i + 2], x, y, w, h);
  };
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (bg[k]) return;
    if (!test(x, y)) return;
    bg[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop();
    const x = k % w, y = (k / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // Optional: also clear enclosed background islands (e.g. road seen between arms and body).
  if (opts.islands) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!bg[y * w + x] && opts.islands(data[(y * w + x) * 4], data[(y * w + x) * 4 + 1], data[(y * w + x) * 4 + 2], x, y, w, h)) bg[y * w + x] = 1;
    }
  }
  // Keep only the largest connected foreground blob (drops stray fragments of glow / road paint).
  {
    const label = new Int32Array(w * h);
    let best = 0, bestSize = 0, next = 0;
    for (let k0 = 0; k0 < w * h; k0++) {
      if (bg[k0] || label[k0]) continue;
      const id = ++next;
      let size = 0;
      const st = [k0];
      label[k0] = id;
      while (st.length) {
        const k = st.pop();
        size++;
        const x = k % w, y = (k / w) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (bg[nk] || label[nk]) continue;
          label[nk] = id;
          st.push(nk);
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
    }
    for (let k = 0; k < w * h; k++) if (label[k] !== best) bg[k] = 1;
  }
  // Soften the edge: alpha from the count of background neighbours.
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y * w + x;
    if (bg[k]) { data[k * 4 + 3] = 0; continue; }
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || bg[yy * w + xx]) n++;
    }
    data[k * 4 + 3] = n >= 5 ? 150 : 255;
  }
  let img = sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim();
  if (opts.scale) {
    const meta = await img.png().toBuffer({ resolveWithObject: true });
    img = sharp(meta.data).resize({ width: Math.round(meta.info.width * opts.scale), kernel: 'lanczos3' });
  }
  await img.png().toFile(path.join(out, name));
  if (debug) {
    const buf = await sharp(path.join(out, name)).toBuffer();
    const m = await sharp(buf).metadata();
    await sharp({ create: { width: m.width + 40, height: m.height + 40, channels: 4, background: '#ff00ff' } })
      .composite([{ input: buf, left: 20, top: 20 }]).resize({ width: (m.width + 40) * (opts.debugZoom ?? 3), kernel: 'nearest' })
      .png().toFile(path.join(root, 'tools', `_debug_${name}`));
  }
  console.log('wrote', name);
}

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

// Road asphalt / soft shadow in the supplied illustrations: desaturated purple-grey.
const roadLike = (r, g, b) => sat(r, g, b) < 46 && lum(r, g, b) > 34 && lum(r, g, b) < 135 && b >= r - 6;
// Cyan / blue effect glow (target ring, exhaust flame): not part of the rider.
const glowLike = (r, g, b) => b > 110 && b > r + 35 && g > r;

await cutout(
  SHOWDOWN,
  { left: 742, top: 478, width: 196, height: 300 },
  (r, g, b, x, y, w, h) => roadLike(r, g, b) || glowLike(r, g, b) || ((y < 26 || y > h - 22) && lum(r, g, b) > 150 && sat(r, g, b) < 40)
    || (y > h * 0.55 && g > r + 12 && b > r + 12 && lum(r, g, b) < 120), // dark teal remains of the target ring
  'mach_rider.png',
  { scale: 2 },
);

// Collectibles: individual objects cut from the sheet (never the whole sheet).
// Background = asphalt, the dim halo around the object, and its bluish drop shadow.
const pickupBg = (r, g, b) => roadLike(r, g, b) || (lum(r, g, b) > 30 && lum(r, g, b) < 122 && sat(r, g, b) < 92) || (b > r + 4 && lum(r, g, b) < 62);
await cutout(COLLECT, { left: 368, top: 180, width: 222, height: 212 }, pickupBg, 'coin.png');
await cutout(COLLECT, { left: 722, top: 170, width: 230, height: 222 }, pickupBg, 'momentum_small.png');
await cutout(COLLECT, { left: 1040, top: 120, width: 320, height: 290 }, pickupBg, 'momentum_large.png');

// Logo: straight downscale of the approved sticker, alpha preserved.
await sharp(LOGO).resize({ width: 1024 }).png().toFile(path.join(out, 'logo.png'));
console.log('wrote logo.png');
