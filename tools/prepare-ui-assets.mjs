// Prepares menu / front-end UI art from the supplied sheets WITHOUT modifying the sources.
// Output goes to public/assets/ui. Run: npm run assets:ui   (add --debug for magenta previews)
// Gameplay sprites are produced separately by tools/prepare-assets.mjs and are not touched here.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'assets', 'ui');
mkdirSync(out, { recursive: true });
const debug = process.argv.includes('--debug');

const ref = (f) => path.join(root, 'References', 'extras', f);
const MACH_G = ref('Mach’s Garage Motorcycle Asset Sheet.png');
const BRUTE_G = ref('Brute’s Garage Motorcycle Asset Sheet.png');
const LYNN_G = ref('Lynn’s Neon Garage Asset Sheet.png');
const CLASS = ref('Apex Ryders Character Class UI Sheet.png');

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Sheet backdrop: saturated blue / cyan glow, never the near-black ink outline. */
const sheetBg = (r, g, b) => (b > r + 34 && b > g - 10) || (lum(r, g, b) > 38 && b > r + 22 && b > g - 10) || (b > g + 30 && r > g + 8); // last: violet panel trim

/** Flood-fill the backdrop away from the crop border, keep the largest blob, soften the edge. */
async function cutout(src, box, name, isBg = sheetBg, opts = {}) {
  const { data, info } = await sharp(src).extract(box).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const bg = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = y * w + x;
    if (bg[k]) return;
    const i = k * 4;
    if (!isBg(data[i], data[i + 1], data[i + 2], x, y, w, h)) return;
    bg[k] = 1; stack.push(k);
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  // largest connected foreground blob only
  const label = new Int32Array(w * h);
  let best = 0, bestSize = 0, next = 0;
  for (let k0 = 0; k0 < w * h; k0++) {
    if (bg[k0] || label[k0]) continue;
    const id = ++next; let size = 0; const st = [k0]; label[k0] = id;
    while (st.length) {
      const k = st.pop(); size++;
      const x = k % w, y = (k / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nk = ny * w + nx;
        if (bg[nk] || label[nk]) continue;
        label[nk] = id; st.push(nk);
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
  }
  for (let k = 0; k < w * h; k++) if (label[k] !== best && !opts.keepAll) bg[k] = 1;
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
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).trim().png().toFile(path.join(out, name));
  if (debug) await preview(name);
  console.log('wrote ui/' + name);
}

/** Plain rectangular crop (portrait cards and item tiles keep their painted backdrop). */
async function crop(src, box, name, width) {
  let img = sharp(src).extract(box);
  if (width) img = img.resize({ width, kernel: 'lanczos3' });
  await img.png().toFile(path.join(out, name));
  if (debug) await preview(name);
  console.log('wrote ui/' + name);
}

async function preview(name) {
  const buf = await sharp(path.join(out, name)).toBuffer();
  const m = await sharp(buf).metadata();
  await sharp({ create: { width: m.width + 20, height: m.height + 20, channels: 4, background: '#ff00ff' } })
    .composite([{ input: buf, left: 10, top: 10 }]).png().toFile(path.join(root, 'tools', `_debug_ui_${name}`));
}

// Full-body riders and their approved bikes (garage sheets).
await cutout(MACH_G, { left: 0, top: 108, width: 236, height: 540 }, 'mach_body.png');
await cutout(BRUTE_G, { left: 0, top: 0, width: 240, height: 700 }, 'brute_body.png');
await cutout(LYNN_G, { left: 0, top: 108, width: 280, height: 650 }, 'lynn_body.png');
await cutout(MACH_G, { left: 255, top: 160, width: 490, height: 385 }, 'mach_bike.png');
await cutout(BRUTE_G, { left: 225, top: 160, width: 505, height: 400 }, 'brute_bike.png');
await cutout(LYNN_G, { left: 255, top: 180, width: 500, height: 385 }, 'lynn_bike.png');

// Class banners (portrait + class colour field) and square avatars.
await crop(CLASS, { left: 18, top: 128, width: 530, height: 224 }, 'mach_banner.png');
await crop(CLASS, { left: 570, top: 128, width: 538, height: 224 }, 'brute_banner.png');
await crop(CLASS, { left: 1130, top: 128, width: 532, height: 224 }, 'lynn_banner.png');
await crop(CLASS, { left: 18, top: 128, width: 224, height: 224 }, 'mach_avatar.png', 200);
await crop(CLASS, { left: 572, top: 128, width: 224, height: 224 }, 'brute_avatar.png', 200);
await crop(CLASS, { left: 1132, top: 128, width: 224, height: 224 }, 'lynn_avatar.png', 200);

// Class emblems and ability glyphs (class sheet).
const glyph = (box, name) => crop(CLASS, box, name, 160);
await glyph({ left: 422, top: 132, width: 118, height: 118 }, 'mach_emblem.png');
await glyph({ left: 984, top: 132, width: 118, height: 118 }, 'brute_emblem.png');
await glyph({ left: 1534, top: 132, width: 118, height: 118 }, 'lynn_emblem.png');
await glyph({ left: 26, top: 418, width: 132, height: 124 }, 'ab_surge.png');
await glyph({ left: 290, top: 418, width: 130, height: 124 }, 'ab_blink.png');
await glyph({ left: 578, top: 416, width: 130, height: 128 }, 'ab_smash.png');
await glyph({ left: 842, top: 416, width: 130, height: 128 }, 'ab_scrap.png');
await glyph({ left: 1132, top: 416, width: 130, height: 128 }, 'ab_heal.png');
await glyph({ left: 1394, top: 416, width: 130, height: 128 }, 'ab_shield.png');

// Rider cosmetics tiles (garage sheets).
const tile = (src, left, top, name, w = 116, h = 116) => crop(src, { left, top, width: w, height: h }, name, 160);
await tile(MACH_G, 857, 600, 'gear_mach_helmet.png', 110, 104);
await tile(MACH_G, 987, 600, 'gear_mach_suit.png', 110, 104);
await tile(MACH_G, 1112, 600, 'gear_mach_gloves.png', 110, 104);
await tile(MACH_G, 1237, 600, 'gear_mach_boots.png', 110, 104);
await tile(BRUTE_G, 843, 600, 'gear_brute_durag.png', 100, 100);
await tile(BRUTE_G, 952, 600, 'gear_brute_vest.png', 100, 100);
await tile(BRUTE_G, 1056, 600, 'gear_brute_top.png', 100, 100);
await tile(BRUTE_G, 1160, 600, 'gear_brute_gloves.png', 100, 100);
await tile(BRUTE_G, 1262, 600, 'gear_brute_boots.png', 94, 100);
await tile(LYNN_G, 815, 622, 'gear_lynn_headband.png', 76, 80);
await tile(LYNN_G, 894, 622, 'gear_lynn_earrings.png', 76, 80);
await tile(LYNN_G, 973, 622, 'gear_lynn_vest.png', 76, 80);
await tile(LYNN_G, 1052, 622, 'gear_lynn_gloves.png', 76, 80);
await tile(LYNN_G, 1131, 622, 'gear_lynn_boots.png', 76, 80);
await tile(LYNN_G, 1210, 622, 'gear_lynn_kneepads.png', 76, 80);
await tile(LYNN_G, 1289, 622, 'gear_lynn_goggles.png', 76, 80);

// Bike upgrade + perk icons (shared across the three sheets; taken from Mach's).
await tile(MACH_G, 1086, 168, 'up_handling.png', 130, 80);
await tile(MACH_G, 1228, 168, 'up_accel.png', 130, 80);
await tile(MACH_G, 1370, 168, 'up_turn.png', 130, 80);
await tile(MACH_G, 1512, 168, 'up_speed.png', 130, 80);
await tile(MACH_G, 1084, 368, 'perk_clean.png', 108, 92);
await tile(MACH_G, 1202, 368, 'perk_magnet.png', 108, 92);
await tile(MACH_G, 1318, 368, 'perk_salvage.png', 108, 92);
await tile(MACH_G, 1432, 368, 'perk_headstart.png', 108, 92);
await tile(MACH_G, 1546, 368, 'perk_lucky.png', 108, 92);
