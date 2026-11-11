import Phaser from 'phaser';
import { Rng } from '../core/rng';

export const UI_FONT = '"Arial Black", "Segoe UI Black", "Arial Bold", Impact, sans-serif';
const INK = '#1a1430';

/** Tileable comic skyline for the CITY map: clouds, hills and a Lagos-flavoured silhouette. */
function citySkyline(scene: Phaser.Scene) {
  const W = 2048, H = 512;
  const tex = scene.textures.createCanvas('skyline-city', W, H)!;
  const c = tex.getContext();
  const rng = new Rng(20261110);
  /** Draw wrapped so the texture tiles seamlessly. */
  const wrap = (fn: (ox: number) => void) => { for (const ox of [-W, 0, W]) fn(ox); };

  // clouds
  for (let i = 0; i < 9; i++) {
    const x = rng.range(0, W), y = rng.range(60, 300), s = rng.range(0.7, 1.5);
    wrap((ox) => {
      const puffs: [number, number, number][] = [[0, 0, 44], [48, 10, 34], [-46, 12, 30], [18, -24, 34], [-22, -14, 28], [84, 20, 22]];
      c.fillStyle = INK; c.globalAlpha = 0.5;
      for (const [px, py, r] of puffs) { c.beginPath(); c.arc(x + ox + px * s, y + py * s, r * s + 3, 0, 7); c.fill(); }
      c.globalAlpha = 1; c.fillStyle = '#dbe9fb';
      for (const [px, py, r] of puffs) { c.beginPath(); c.arc(x + ox + px * s, y + py * s + 4, r * s, 0, 7); c.fill(); }
      c.fillStyle = '#ffffff';
      for (const [px, py, r] of puffs) { c.beginPath(); c.arc(x + ox + px * s - 3, y + py * s - 5, r * s * 0.86, 0, 7); c.fill(); }
      c.fillStyle = INK; c.globalAlpha = 0.5; c.fillRect(x + ox - 80 * s, y + 34 * s, 190 * s, 3); c.globalAlpha = 1;
      c.clearRect(x + ox - 90 * s, y + 37 * s, 220 * s, 60 * s);
    });
  }

  // far hills
  c.fillStyle = '#8fb4dc';
  c.beginPath(); c.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) c.lineTo(x, H - 96 - Math.sin((x / W) * Math.PI * 6) * 22 - Math.sin((x / W) * Math.PI * 14 + 1) * 9);
  c.lineTo(W, H); c.fill();

  const blocks = (color: string, lit: string, minH: number, maxH: number, step: number, win: boolean) => {
    let x = 0;
    while (x < W) {
      const w = rng.range(step * 0.6, step * 1.4), h = rng.range(minH, maxH);
      c.fillStyle = color; c.fillRect(x, H - h, w + 1, h);
      if (rng.chance(0.3)) c.fillRect(x + w * 0.3, H - h - 14, w * 0.4, 14);
      if (win) {
        // cel shading: sunlit right flank, ink edge on the left, rooftop tank or mast
        c.fillStyle = 'rgba(255,236,190,0.28)'; c.fillRect(x + w * 0.72, H - h, w * 0.28 + 1, h);
        c.fillStyle = 'rgba(26,20,48,0.55)'; c.fillRect(x, H - h, 2.5, h); c.fillRect(x, H - h, w + 1, 2.5);
        if (rng.chance(0.25)) { c.fillStyle = '#2b2f55'; c.fillRect(x + w * 0.2, H - h - 12, 12, 12); }
        if (rng.chance(0.12)) {
          for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? '#f4f1fa' : '#e53127'; c.fillRect(x + w * 0.6, H - h - 14 * (i + 1), 3, 14); }
        }
      }
      if (win) {
        c.fillStyle = lit;
        for (let wy = H - h + 8; wy < H - 30; wy += 13) for (let wx = x + 5; wx < x + w - 7; wx += 10) if (rng.chance(0.55)) c.fillRect(wx, wy, 5, 6);
      }
      x += w + rng.range(0, 10);
    }
  };
  blocks('#7f9fd0', '', 60, 150, 46, false);

  // landmarks: cable-stayed bridge pylon, telecom tower, stadium bowl
  const fg = '#55639f';
  const bridge = (x: number) => wrap((ox) => {
    const bx = x + ox, top = H - 250, deck = H - 70;
    c.strokeStyle = fg; c.lineWidth = 2;
    for (let i = 1; i <= 9; i++) { c.beginPath(); c.moveTo(bx, top + i * 9); c.lineTo(bx - i * 26, deck); c.moveTo(bx, top + i * 9); c.lineTo(bx + i * 26, deck); c.stroke(); }
    c.fillStyle = fg;
    c.beginPath(); c.moveTo(bx - 7, top); c.lineTo(bx + 7, top); c.lineTo(bx + 26, H); c.lineTo(bx + 12, H); c.lineTo(bx, top + 120); c.lineTo(bx - 12, H); c.lineTo(bx - 26, H); c.fill();
    c.fillRect(bx - 250, deck, 500, 9);
    for (let px = -240; px <= 240; px += 60) c.fillRect(bx + px - 4, deck, 8, 70);
  });
  const tower = (x: number) => wrap((ox) => {
    const tx = x + ox;
    c.fillStyle = fg; c.fillRect(tx - 9, H - 250, 18, 250);
    c.beginPath(); c.ellipse(tx, H - 262, 34, 13, 0, 0, 7); c.fill();
    c.fillRect(tx - 22, H - 282, 44, 14); c.fillRect(tx - 2, H - 340, 4, 60);
    c.fillStyle = '#ffd35a'; c.fillRect(tx - 26, H - 264, 52, 3);
  });
  const stadium = (x: number) => wrap((ox) => {
    const sx = x + ox;
    c.fillStyle = fg; c.beginPath(); c.ellipse(sx, H - 40, 170, 62, 0, Math.PI, 0); c.fill();
    c.fillStyle = '#8fa4dc';
    for (let i = -150; i <= 150; i += 20) c.fillRect(sx + i - 2, H - 40 - Math.sqrt(Math.max(0, 1 - (i * i) / (170 * 170))) * 56, 4, 60);
  });
  const mosque = (x: number) => wrap((ox) => {
    const mx = x + ox;
    c.fillStyle = '#6a78b4'; c.fillRect(mx - 46, H - 96, 92, 96);
    c.fillStyle = '#3fb89a'; c.beginPath(); c.arc(mx, H - 96, 34, Math.PI, 0); c.fill();
    c.fillRect(mx - 2, H - 146, 4, 18);
    for (const dx of [-62, 62]) { c.fillStyle = '#6a78b4'; c.fillRect(mx + dx - 6, H - 170, 12, 170); c.fillStyle = '#3fb89a'; c.beginPath(); c.moveTo(mx + dx - 9, H - 170); c.lineTo(mx + dx, H - 196); c.lineTo(mx + dx + 9, H - 170); c.fill(); }
  });
  bridge(430); tower(980); stadium(1500); tower(1880); mosque(1210); mosque(140);
  blocks(fg, '#ffe08a', 40, 190, 54, true);

  // tree line + palms
  c.fillStyle = '#2f7a55';
  for (let x = -20; x < W + 20; x += 22) { c.beginPath(); c.arc(x + rng.range(-5, 5), H - 4, rng.range(16, 28), 0, 7); c.fill(); }
  c.fillStyle = '#225f44';
  for (let x = 0; x < W; x += 34) { c.beginPath(); c.arc(x + rng.range(-8, 8), H + 4, rng.range(14, 22), 0, 7); c.fill(); }
  tex.refresh();
}

function panel(c: CanvasRenderingContext2D, w: number, h: number, bg: string, border: string) {
  c.fillStyle = INK; c.fillRect(0, 0, w, h);
  c.fillStyle = border; c.fillRect(6, 6, w - 12, h - 12);
  c.fillStyle = bg; c.fillRect(14, 14, w - 28, h - 28);
}
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill: string, stroke = INK, align: CanvasTextAlign = 'center') {
  c.font = `italic 900 ${size}px ${UI_FONT}`;
  c.textAlign = align; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = size * 0.22; c.strokeStyle = stroke; c.strokeText(text, x, y);
  c.fillStyle = fill; c.fillText(text, x, y);
}

/** Roadside billboards (fictional local businesses) and the route-choice gantry signs. */
function signage(scene: Phaser.Scene) {
  const ads: { bg: string; border: string; a: string; b: string; fa: string; fb: string }[] = [
    { bg: '#e53127', border: '#ffd35a', a: 'EKO SUYA SPOT', b: 'Hot • Spicy • All Night', fa: '#ffd35a', fb: '#ffffff' },
    { bg: '#1e9e5a', border: '#ffffff', a: 'MAMA NKECHI', b: 'Party Jollof Daily!', fa: '#ffffff', fb: '#ffe08a' },
    { bg: '#ff7f2a', border: '#1a1430', a: 'ZOBO FIZZ', b: 'Chill am well well', fa: '#ffffff', fb: '#5b1030' },
    { bg: '#2f7fe0', border: '#ffd35a', a: 'RYDERS CUP', b: 'Lagos Grand Final', fa: '#ffd35a', fb: '#ffffff' },
    { bg: '#f7c600', border: '#1a1430', a: 'DANFO EXPRESS', b: 'Oshodi • CMS • Lekki', fa: '#1a1430', fb: '#1a1430' },
    { bg: '#7b3fd1', border: '#38e1ff', a: 'NAIJA NO DEY', b: 'CARRY LAST!', fa: '#38e1ff', fb: '#ffffff' },
  ];
  ads.forEach((ad, i) => {
    const tex = scene.textures.createCanvas(`billboard-${i}`, 512, 256)!;
    const c = tex.getContext();
    panel(c, 512, 256, ad.bg, ad.border);
    c.fillStyle = 'rgba(255,255,255,0.14)';
    c.beginPath(); c.moveTo(300, 14); c.lineTo(498, 14); c.lineTo(498, 242); c.lineTo(180, 242); c.fill();
    label(c, ad.a, 256, 100, ad.a.length > 11 ? 50 : 62, ad.fa, ad.fa === '#1a1430' ? '#ffffff' : INK);
    label(c, ad.b, 256, 176, 30, ad.fb, ad.fb === '#1a1430' ? '#ffffff' : INK);
    tex.refresh();
  });

  const sign = (key: string, bg: string, border: string, title: string, sub: string, fill: string) => {
    const tex = scene.textures.createCanvas(key, 512, 200)!;
    const c = tex.getContext();
    panel(c, 512, 200, bg, border);
    label(c, title, 256, 80, 58, fill);
    label(c, sub, 256, 146, 30, '#ffffff');
    tex.refresh();
  };
  sign('sign-risk', '#2b2539', '#f6b81f', 'SHORTCUT', 'RISKY • MOMENTUM', '#f6b81f');
  sign('sign-safe', '#11703f', '#ffffff', 'EXPRESSWAY', 'SAFE ROUTE', '#ffffff');

  // Hand-painted shop boards that hang out over the pavement.
  const shops: [string, string, string, string, string][] = [
    ['MAMA PUT', 'Rice • Stew • Dodo', '#e53127', '#ffd35a', '#ffffff'],
    ['BARBING', 'SALON', '#1a1430', '#38e1ff', '#ffffff'],
    ['CHEMIST', 'Open 24 hrs', '#ffffff', '#1e9e5a', '#1e9e5a'],
    ['PROVISIONS', 'Cold Minerals', '#f7c600', '#1a1430', '#e53127'],
    ['PHONE', 'REPAIRS', '#2f7fe0', '#ffffff', '#ffd35a'],
    ['SUYA', 'Fresh & Hot', '#7a2a12', '#ffb020', '#ffffff'],
    ['POS', 'Recharge Card', '#1e9e5a', '#ffffff', '#ffd35a'],
    ['TAILOR', 'Aso Ebi Designs', '#7b3fd1', '#ffffff', '#ffd35a'],
  ];
  shops.forEach(([a, b, bg, fa, fb], i) => {
    const tex = scene.textures.createCanvas(`shop-${i}`, 256, 112)!;
    const c = tex.getContext();
    panel(c, 256, 112, bg, fa);
    const dark = (hex: string) => hex === '#1a1430' || hex === '#1e9e5a';
    label(c, a, 128, 44, a.length > 8 ? 30 : 38, fa, dark(fa) ? '#ffffff' : INK);
    label(c, b, 128, 82, 19, fb, dark(fb) ? '#ffffff' : INK);
    tex.refresh();
  });
}

function fx(scene: Phaser.Scene) {
  const spark = scene.textures.createCanvas('spark', 96, 96)!;
  const c = spark.getContext();
  c.strokeStyle = '#ffffff'; c.lineWidth = 9; c.beginPath(); c.arc(48, 48, 36, 0, 7); c.stroke();
  spark.refresh();

  // soft sun bloom
  const glow = scene.textures.createCanvas('glow', 256, 256)!;
  const gc = glow.getContext();
  const gg = gc.createRadialGradient(128, 128, 0, 128, 128, 128);
  gg.addColorStop(0, 'rgba(255,255,255,0.95)'); gg.addColorStop(0.18, 'rgba(255,255,255,0.5)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
  gc.fillStyle = gg; gc.fillRect(0, 0, 256, 256);
  glow.refresh();

  // ink vignette that frames the action
  const vig = scene.textures.createCanvas('vignette', 256, 256)!;
  const vc = vig.getContext();
  const vg = vc.createRadialGradient(128, 128, 70, 128, 128, 182);
  vg.addColorStop(0, 'rgba(20,12,50,0)'); vg.addColorStop(1, 'rgba(20,12,50,0.75)');
  vc.fillStyle = vg; vc.fillRect(0, 0, 256, 256);
  vig.refresh();
}

export function buildTextures(scene: Phaser.Scene) {
  citySkyline(scene);
  signage(scene);
  fx(scene);
}
