import { clamp } from '../core/config';
import type { Prop } from '../world/environment';
import { pt, type Camera, type Pt } from './camera';
import type { Painter } from './triBatch';

type G = Painter;

export function mix(c1: number, c2: number, t: number): number {
  if (t <= 0) return c1;
  if (t >= 1) return c2;
  const r = ((c1 >> 16) & 255) + (((c2 >> 16) & 255) - ((c1 >> 16) & 255)) * t;
  const g = ((c1 >> 8) & 255) + (((c2 >> 8) & 255) - ((c1 >> 8) & 255)) * t;
  const b = (c1 & 255) + ((c2 & 255) - (c1 & 255)) * t;
  return (r << 16) | (g << 8) | b;
}
export const shade = (c: number, f: number) => (f <= 1 ? mix(c, 0x000000, 1 - f) : mix(c, 0xffffff, f - 1));

// --- Cel lighting: a warm sun from the upper right, cool violet shadows falling left. ---
const SHADOW_TINT = 0x2c2150;
const LIGHT_TINT = 0xfff0c2;
export const SHADOW_INK = 0x150d36;
export const lit = (c: number, k = 0.16) => mix(c, LIGHT_TINT, k);
export const dim = (c: number, k = 0.4) => mix(c, SHADOW_TINT, k);
export const hash = (a: number, b: number) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663)) >>> 0;

// --- Fast primitives built on fillTriangle only. ---
let LW = 1, LC = 0, LA = 1;
/** Set the current line style (width, colour, alpha) for ln() / ring(). */
export function ls(_g: G, width: number, color: number, alpha = 1) { LW = width; LC = color; LA = alpha; }
/** Straight line with square caps. */
export function ln(g: G, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.01) return;
  const h = LW * 0.5, ux = (dx / len) * h, uy = (dy / len) * h;
  const ax = x1 - ux, ay = y1 - uy, bx = x2 + ux, by = y2 + uy;
  g.fillStyle(LC, LA);
  g.fillTriangle(ax - uy, ay + ux, bx - uy, by + ux, bx + uy, by - ux);
  g.fillTriangle(ax - uy, ay + ux, bx + uy, by - ux, ax + uy, ay - ux);
}
const COS: number[] = [], SIN: number[] = [];
for (let i = 0; i <= 24; i++) { COS.push(Math.cos((i / 24) * Math.PI * 2)); SIN.push(Math.sin((i / 24) * Math.PI * 2)); }
/** Filled ellipse (w,h = full size) as a triangle fan; uses the current fill style. */
export function oval(g: G, x: number, y: number, w: number, h: number, n = 12) {
  const step = n >= 24 ? 1 : n >= 12 ? 2 : 3, rx = w / 2, ry = h / 2;
  for (let i = 0; i < 24; i += step) g.fillTriangle(x, y, x + COS[i] * rx, y + SIN[i] * ry, x + COS[i + step] * rx, y + SIN[i + step] * ry);
}
/** Ellipse outline in the current line style. */
export function ring(g: G, x: number, y: number, w: number, h: number, _n = 12) {
  const rx = w / 2, ry = h / 2;
  for (let i = 0; i < 24; i += 2) ln(g, x + COS[i] * rx, y + SIN[i] * ry, x + COS[i + 2] * rx, y + SIN[i + 2] * ry);
}

export function quad(g: G, col: number, a: Pt, b: Pt, c: Pt, d: Pt, alpha = 1) {
  g.fillStyle(col, alpha);
  g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
  g.fillTriangle(a.x, a.y, c.x, c.y, d.x, d.y);
}

/** Per-frame drawing context shared by all prop painters. */
export interface Ctx {
  g: G;
  cam: Camera;
  fog: number; // 0..1 atmospheric blend for the current depth
  haze: number;
  outline: number;
  signs: SignRequest[];
}
export interface SignRequest { key: string; x: number; y: number; w: number; h: number }

const col = (ctx: Ctx, c: number) => mix(c, ctx.haze, ctx.fog);

// Scratch points. F* = front face (TL,TR,BR,BL), S* = side face (near-top, far-top, far-bottom, near-bottom),
// TA/TB = far-right / far-left corners of the top face.
const FA = pt(), FB = pt(), FC = pt(), FD = pt();
const SA = pt(), SB = pt(), SC = pt(), SD = pt();
const TA = pt(), TB = pt();
const Q1 = pt(), Q2 = pt(), Q3 = pt(), Q4 = pt();
const P1 = pt(), P2 = pt(), P3 = pt(), P4 = pt();
let sideVisible = false;
let topVisible = false;

function bil(a: Pt, b: Pt, c: Pt, d: Pt, u: number, v: number, o: Pt) {
  const tx = a.x + (b.x - a.x) * u, ty = a.y + (b.y - a.y) * u;
  const bx = d.x + (c.x - d.x) * u, by = d.y + (c.y - d.y) * u;
  o.x = tx + (bx - tx) * v;
  o.y = ty + (by - ty) * v;
  return o;
}
/** Fill a sub-rectangle (u,v in 0..1) of a projected face. */
function sub(g: G, c: number, a: Pt, b: Pt, cc: Pt, d: Pt, u0: number, v0: number, u1: number, v1: number, alpha = 1) {
  bil(a, b, cc, d, u0, v0, Q1); bil(a, b, cc, d, u1, v0, Q2); bil(a, b, cc, d, u1, v1, Q3); bil(a, b, cc, d, u0, v1, Q4);
  quad(g, c, Q1, Q2, Q3, Q4, alpha);
}
function tri(g: G, c: number, a: Pt, b: Pt, cc: Pt, d: Pt, u1: number, v1: number, u2: number, v2: number, u3: number, v3: number) {
  bil(a, b, cc, d, u1, v1, Q1); bil(a, b, cc, d, u2, v2, Q2); bil(a, b, cc, d, u3, v3, Q3);
  g.fillStyle(c, 1);
  g.fillTriangle(Q1.x, Q1.y, Q2.x, Q2.y, Q3.x, Q3.y);
}
function strokeQuad(g: G, a: Pt, b: Pt, c: Pt, d: Pt) {
  ln(g, a.x, a.y, b.x, b.y); ln(g, b.x, b.y, c.x, c.y); ln(g, c.x, c.y, d.x, d.y); ln(g, d.x, d.y, a.x, a.y);
}
const lineW = (s: number) => clamp(s * 0.11, 1.2, 4.2);
const ink = (ctx: Ctx, s: number, k = 1) => ls(ctx.g, lineW(s) * k, ctx.outline, 1 - ctx.fog * 0.65);

/** 3D line with an ink outline underneath (posts, trunks, poles). */
function post(ctx: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, width: number, c: number) {
  const { g, cam } = ctx;
  cam.project(x0, y0, z0, P1); cam.project(x1, y1, z1, P2);
  const w = Math.max(1.4, width * P1.s);
  ls(g, w + lineW(P1.s) * 1.3, ctx.outline, 1 - ctx.fog * 0.65); ln(g, P1.x, P1.y, P2.x, P2.y);
  ls(g, w, col(ctx, c), 1); ln(g, P1.x, P1.y, P2.x, P2.y);
}

/** Flat shadow cast on the ground toward -x (away from the sun). x = the object's left edge. */
function castShadow(ctx: Ctx, x: number, z0: number, z1: number, h: number, y = 0.04) {
  const { g, cam } = ctx;
  const len = Math.min(h * 0.6, 8.5);
  cam.project(x, y, z0, Q1);
  if (Q1.s < 3.5) return;
  cam.project(x - len, y, z0 + len * 0.3, Q2); cam.project(x - len, y, z1 + len * 0.3, Q3); cam.project(x, y, z1, Q4);
  quad(g, SHADOW_INK, Q1, Q2, Q3, Q4, 0.3 * (1 - ctx.fog));
}
function blobShadow(ctx: Ctx, x: number, z: number, rx: number, y = 0.04) {
  ctx.cam.project(x - rx * 0.5, y, z, Q1);
  if (Q1.s < 3.5) return;
  ctx.g.fillStyle(SHADOW_INK, 0.28 * (1 - ctx.fog));
  oval(ctx.g, Q1.x, Q1.y, rx * 2.3 * Q1.s, rx * 0.8 * Q1.s, 14);
}

/**
 * Cel-shaded axis-aligned world box with ink outlines. The face turned toward the
 * sun (-x) is lit, the opposite one falls into violet shade. Leaves the projected
 * faces in FA..FD / SA..SD / TA,TB for decoration.
 */
const BK = [pt(), pt(), pt(), pt()];
/** Face with an ink rim: a slightly grown dark quad underneath the fill. */
function inked(ctx: Ctx, c: number, a: Pt, b: Pt, cc: Pt, d: Pt, lw: number) {
  const cx = (a.x + b.x + cc.x + d.x) / 4, cy = (a.y + b.y + cc.y + d.y) / 4;
  const src = [a, b, cc, d];
  for (let i = 0; i < 4; i++) {
    const dx = src[i].x - cx, dy = src[i].y - cy, len = Math.sqrt(dx * dx + dy * dy) || 1;
    BK[i].x = src[i].x + (dx / len) * lw * 1.5; BK[i].y = src[i].y + (dy / len) * lw * 1.5;
  }
  quad(ctx.g, ctx.outline, BK[0], BK[1], BK[2], BK[3], 1 - ctx.fog * 0.65);
  quad(ctx.g, c, a, b, cc, d);
}

export function box(ctx: Ctx, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number, cTop = lit(c, 0.26)) {
  const { g, cam } = ctx;
  cam.project(x0, y1, z0, FA); cam.project(x1, y1, z0, FB); cam.project(x1, y0, z0, FC); cam.project(x0, y0, z0, FD);
  const lw = FA.s > 3.2 ? lineW(FA.s) : 0;
  sideVisible = cam.x > x1 || cam.x < x0;
  if (sideVisible) {
    const shaded = cam.x < x0; // we are looking at the -x face, turned away from the sun
    const xs = cam.x > x1 ? x1 : x0;
    cam.project(xs, y1, z0, SA); cam.project(xs, y1, z1, SB); cam.project(xs, y0, z1, SC); cam.project(xs, y0, z0, SD);
    if (lw) inked(ctx, col(ctx, shaded ? dim(c, 0.46) : lit(c, 0.1)), SA, SB, SC, SD, lw);
    else quad(g, col(ctx, shaded ? dim(c, 0.46) : lit(c, 0.1)), SA, SB, SC, SD);
  }
  topVisible = cam.y > y1;
  if (topVisible) {
    cam.project(x1, y1, z1, TA); cam.project(x0, y1, z1, TB);
    if (lw) inked(ctx, col(ctx, cTop), FA, FB, TA, TB, lw);
    else quad(g, col(ctx, cTop), FA, FB, TA, TB);
  }
  if (lw) inked(ctx, col(ctx, dim(c, 0.2)), FA, FB, FC, FD, lw);
  else quad(g, col(ctx, dim(c, 0.2)), FA, FB, FC, FD);
}

const WINDOW = 0x25355f;
const GLINT = 0x9fd8ff;
const WARM = 0xffd98a;
const FRAME = 0xf6f0e2;
const AWNINGS = [0xe53935, 0x1e9e5a, 0xf5b921, 0x2f7fe0, 0xff7f2a, 0x8e3fd1];
const LAUNDRY = [0xff5a4a, 0xffffff, 0x38b6ff, 0xffd23f, 0x7ee07a, 0xff8fd0];

/** Windows with frames, sills, glints, the odd lit room and wall-mounted AC unit. */
function facade(ctx: Ctx, a: Pt, b: Pt, c: Pt, d: Pt, len: number, height: number, scale: number, v: number, skipGround: boolean, shadedFace: boolean) {
  const g = ctx.g;
  const floors = Math.max(1, Math.round(height / 3.2));
  const cells = Math.max(1, Math.round(len / 3.3));
  const glass = shadedFace ? WINDOW : mix(WINDOW, 0x3f6bb0, 0.35);
  if (scale < 3.2) return;
  // base plinth
  sub(g, col(ctx, SHADOW_TINT), a, b, c, d, 0, 1 - 0.5 / height, 1, 1, 0.35);
  for (let f = skipGround ? 1 : 0; f < floors; f++) {
    const v0 = 1 - (f + 0.8) / floors, v1 = 1 - (f + 0.3) / floors;
    if (scale < 15) { sub(g, col(ctx, glass), a, b, c, d, 0.07, v0, 0.93, v1); continue; }
    for (let i = 0; i < cells; i++) {
      const u0 = (i + 0.22) / cells, u1 = (i + 0.78) / cells, du = u1 - u0, dv = v1 - v0;
      const h = hash(v + f * 7, i * 13 + f);
      if (scale > 19) sub(g, col(ctx, FRAME), a, b, c, d, u0 - du * 0.09, v0 - dv * 0.1, u1 + du * 0.09, v1 + dv * 0.16);
      sub(g, col(ctx, h % 6 === 0 ? WARM : glass), a, b, c, d, u0, v0, u1, v1);
      if (h % 6 !== 0) sub(g, col(ctx, GLINT), a, b, c, d, u0, v0, u0 + du * 0.34, v0 + dv * 0.42, 0.5);
      if (scale > 20) sub(g, col(ctx, ctx.outline), a, b, c, d, u0 + du * 0.47, v0, u0 + du * 0.53, v1, 0.7);
      if (h % 5 === 1 && scale > 16) sub(g, col(ctx, 0xdcd8e8), a, b, c, d, u0, v1 + dv * 0.22, u0 + du * 0.55, v1 + dv * 0.52);
    }
  }
}

/** Striped shop awning that really sticks out from the wall. */
function awning(ctx: Ctx, xs: number, dir: number, yTop: number, z0: number, z1: number, c: number, scale: number) {
  const { g, cam } = ctx;
  const n = scale > 10 ? Math.max(2, Math.round((z1 - z0) / 1.3)) : 1;
  for (let i = 0; i < n; i++) {
    const za = z0 + ((z1 - z0) * i) / n, zb = z0 + ((z1 - z0) * (i + 1)) / n;
    cam.project(xs, yTop, za, Q1); cam.project(xs, yTop, zb, Q2); cam.project(xs + dir * 1.8, yTop - 0.75, zb, Q3); cam.project(xs + dir * 1.8, yTop - 0.75, za, Q4);
    quad(g, col(ctx, i % 2 ? 0xfff6e6 : c), Q1, Q2, Q3, Q4);
  }
  if (scale > 5) {
    cam.project(xs, yTop, z0, Q1); cam.project(xs, yTop, z1, Q2); cam.project(xs + dir * 1.8, yTop - 0.75, z1, Q3); cam.project(xs + dir * 1.8, yTop - 0.75, z0, Q4);
    ink(ctx, scale); strokeQuad(g, Q1, Q2, Q3, Q4);
    // valance
    cam.project(xs + dir * 1.8, yTop - 1.1, z1, P1); cam.project(xs + dir * 1.8, yTop - 1.1, z0, P2);
    quad(g, col(ctx, dim(c, 0.25)), Q4, Q3, P1, P2); strokeQuad(g, Q4, Q3, P1, P2);
  }
}

/** Ground-floor shop on the road-facing side face: opening, fascia with painted lettering, awning. */
function shopfront(ctx: Ctx, xs: number, dir: number, z0: number, z1: number, height: number, v: number, scale: number) {
  const g = ctx.g;
  const gv = 1 - Math.min(0.92, 3.3 / height);
  const span = 1 - gv;
  sub(g, col(ctx, 0x1d1733), SA, SB, SC, SD, 0.06, gv + span * 0.34, 0.94, 1);
  if (scale > 13) {
    // goods glimpsed inside + door posts
    for (let i = 0; i < 4; i++) sub(g, col(ctx, LAUNDRY[(v + i) % LAUNDRY.length]), SA, SB, SC, SD, 0.12 + i * 0.2, gv + span * 0.62, 0.24 + i * 0.2, gv + span * 0.84, 0.75);
    sub(g, col(ctx, FRAME), SA, SB, SC, SD, 0.48, gv + span * 0.34, 0.52, 1);
  }
  const fascia = AWNINGS[(v >> 2) % AWNINGS.length];
  sub(g, col(ctx, fascia), SA, SB, SC, SD, 0.03, gv, 0.97, gv + span * 0.26);
  if (scale > 11) {
    // hand-painted lettering suggested as blocks
    let u = 0.1;
    for (let i = 0; u < 0.86; i++) {
      const w = 0.035 + (hash(v, i) % 5) * 0.012;
      if (hash(v, i + 9) % 5) sub(g, col(ctx, fascia === 0xf5b921 ? 0x1a1430 : 0xffffff), SA, SB, SC, SD, u, gv + span * 0.07, u + w, gv + span * 0.19);
      u += w + 0.02;
    }
  }
  awning(ctx, xs, dir, 3.25, z0 + 0.5, z1 - 0.5, AWNINGS[v % AWNINGS.length], scale);
}

/** Pitched corrugated-iron roof with rust — the classic Lagos rooftop. */
function tinRoof(ctx: Ctx, x0: number, x1: number, h: number, z0: number, z1: number, c: number, wall: number, scale: number) {
  const { g, cam } = ctx;
  const o = 0.5, xc = (x0 + x1) / 2, ridge = h + (x1 - x0) * 0.2;
  cam.project(x0, h, z0, Q1); cam.project(x1, h, z0, Q2); cam.project(xc, ridge, z0, Q3);
  g.fillStyle(col(ctx, dim(wall, 0.2)), 1); g.fillTriangle(Q1.x, Q1.y, Q2.x, Q2.y, Q3.x, Q3.y);
  const slope = (left: boolean) => {
    const xe = left ? x0 - o : x1 + o;
    cam.project(xe, h - 0.15, z0 - o, P1); cam.project(xc, ridge, z0 - o, P2); cam.project(xc, ridge, z1 + o, P3); cam.project(xe, h - 0.15, z1 + o, P4);
    const base = left ? dim(c, 0.34) : lit(c, 0.14);
    quad(g, col(ctx, base), P1, P2, P3, P4);
    if (scale > 8) {
      const n = Math.round((z1 - z0) / 1.1);
      ls(g, Math.max(1, scale * 0.05), col(ctx, dim(base, 0.35)), 0.8);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        ln(g, P1.x + (P4.x - P1.x) * t, P1.y + (P4.y - P1.y) * t, P2.x + (P3.x - P2.x) * t, P2.y + (P3.y - P2.y) * t);
      }
      // rust patch
      bil(P2, P3, P4, P1, 0.25, 0.3, Q1); bil(P2, P3, P4, P1, 0.55, 0.3, Q2); bil(P2, P3, P4, P1, 0.5, 0.75, Q3); bil(P2, P3, P4, P1, 0.2, 0.7, Q4);
      quad(g, col(ctx, 0x7a3418), Q1, Q2, Q3, Q4, 0.45);
    }
    if (scale > 3.2) { ink(ctx, scale); strokeQuad(g, P1, P2, P3, P4); }
  };
  if (cam.x > xc) { slope(true); slope(false); } else { slope(false); slope(true); }
}

function roofClutter(ctx: Ctx, p: Prop, x0: number, x1: number, y: number, z0: number, z1: number, roofC: number) {
  if (!topVisible || FA.s < 8) return;
  // parapet rim: inset roof surface
  sub(ctx.g, col(ctx, roofC), TB, TA, FB, FA, 0.07, 0.08, 0.93, 0.9);
  const tx = (x0 + x1) / 2 + ((p.v % 5) - 2) * (x1 - x0) * 0.12, tz = z0 + (z1 - z0) * (0.25 + (p.v % 4) * 0.12);
  if (p.v % 3 !== 1) {
    // water tank on a steel stand
    box(ctx, tx - 0.9, tx + 0.9, y, y + 0.9, tz, tz + 1.8, 0x6f6b85);
    box(ctx, tx - 0.85, tx + 0.85, y + 0.9, y + 2.6, tz + 0.1, tz + 1.7, p.v % 2 ? 0x1f1c2b : 0x2f6fb5);
  }
  if (p.v % 4 === 0) {
    ctx.cam.project(tx + 2.4, y + 1.1, tz + 0.6, P1);
    post(ctx, tx + 2.4, y, tz + 0.6, tx + 2.4, y + 1, tz + 0.6, 0.12, 0x3a3550);
    ctx.g.fillStyle(col(ctx, ctx.outline), 1); oval(ctx.g, P1.x, P1.y, (P1.s * 0.62) * 2, (P1.s * 0.62) * 2, 12);
    ctx.g.fillStyle(col(ctx, 0xe6e2f0), 1); oval(ctx.g, P1.x, P1.y, (P1.s * 0.5) * 2, (P1.s * 0.5) * 2, 12);
  }
}

function building(ctx: Ctx, p: Prop) {
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z, z1 = p.z + p.d;
  const dir = -p.side; // toward the road
  const near = p.side < 0 ? x1 : x0;
  if (p.side > 0) castShadow(ctx, x0, z0, z1, p.h);
  const low = p.h <= 5;
  const style = low ? 1 : p.v % 3; // 0 balcony block · 1 tin-roof shop · 2 stepped plaza
  const shaded = p.side > 0;

  if (style === 2) {
    // podium + set-back upper block
    const yl = Math.max(3.4, Math.round((p.h * 0.5) / 3.2) * 3.2);
    box(ctx, x0, x1, 0, yl, z0, z1, p.c, lit(p.c2, 0.1));
    const s = FA.s;
    facade(ctx, FA, FB, FC, FD, p.w, yl, s, p.v, false, false);
    if (sideVisible) { facade(ctx, SA, SB, SC, SD, p.d, yl, s, p.v + 3, true, shaded); if (s > 5) shopfront(ctx, near, dir, z0, z1, yl, p.v, s); }
    const ux0 = p.side < 0 ? x0 : x0 + 2.4, ux1 = p.side < 0 ? x1 - 2.4 : x1;
    const tone = mix(p.c, 0xffffff, 0.25);
    box(ctx, ux0, ux1, yl, p.h, z0 + 1.6, z1 - 0.6, tone, lit(p.c2, 0.1));
    facade(ctx, FA, FB, FC, FD, ux1 - ux0, p.h - yl, FA.s, p.v + 5, false, false);
    if (sideVisible) {
      facade(ctx, SA, SB, SC, SD, p.d - 2.2, p.h - yl, FA.s, p.v + 8, false, shaded);
      sub(ctx.g, col(ctx, AWNINGS[p.v % AWNINGS.length]), SA, SB, SC, SD, 0, 0, 1, Math.min(0.2, 1.1 / (p.h - yl)));
    }
    roofClutter(ctx, p, ux0, ux1, p.h, z0 + 1.6, z1 - 0.6, dim(p.c2, 0.15));
    return;
  }

  box(ctx, x0, x1, 0, p.h, z0, z1, p.c, low ? p.c : lit(p.c, 0.3));
  const s = FA.s;
  facade(ctx, FA, FB, FC, FD, p.w, p.h, s, p.v, false, false);
  if (sideVisible) {
    facade(ctx, SA, SB, SC, SD, p.d, p.h, s, p.v + 3, true, shaded);
    if (s > 5) shopfront(ctx, near, dir, z0, z1, p.h, p.v, s);
  }
  if (low) {
    tinRoof(ctx, x0, x1, p.h, z0, z1, p.c2, p.c, s);
  } else {
    // cantilevered balconies with laundry on the road side
    if (sideVisible && s > 9) {
      const floors = Math.round(p.h / 3.2);
      for (let f = floors - 1; f >= 1; f--) {
        const y = (f * p.h) / floors + 0.25;
        box(ctx, Math.min(near, near + dir * 1.15), Math.max(near, near + dir * 1.15), y, y + 1.05, z0 + 0.7, z1 - 0.7, mix(p.c, 0xffffff, 0.3));
        if (s > 13 && hash(p.v, f) % 2 === 0) {
          for (let i = 0; i < 3; i++) sub(ctx.g, col(ctx, LAUNDRY[(p.v + f + i) % LAUNDRY.length]), SA, SB, SC, SD, 0.2 + i * 0.22, 0.12, 0.34 + i * 0.22, 0.95);
        }
      }
    }
    box(ctx, x0 - 0.25, x1 + 0.25, p.h, p.h + 0.45, z0 - 0.25, z1 + 0.25, mix(p.c, 0xffffff, 0.2));
    roofClutter(ctx, p, x0, x1, p.h + 0.45, z0, z1, dim(p.c2, 0.1));
  }
  // projecting shop sign (faces the rider)
  if (s > 4.5 && p.v % 4 < 2) {
    const sy = low ? 3.6 : 4.4, sx0 = Math.min(near + dir * 0.3, near + dir * 3.1), zc = z0 + p.d * 0.5;
    post(ctx, near, sy + 1.25, zc, near + dir * 3.1, sy + 1.25, zc, 0.1, 0x3a3550);
    ctx.cam.project(sx0, sy + 1.2, zc, Q1); ctx.cam.project(sx0 + 2.8, sy, zc, Q3);
    ctx.signs.push({ key: `shop-${p.v % 8}`, x: Q1.x, y: Q1.y, w: Q3.x - Q1.x, h: Q3.y - Q1.y });
  }
}

function tower(ctx: Ctx, p: Prop) {
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  box(ctx, x0, x1, 0, p.h, p.z, p.z + p.d, p.c);
  const s = FA.s;
  if (s < 2.2) return;
  const g = ctx.g;
  const bands = Math.round(p.h / 4.4);
  for (let i = 0; i < bands; i++) {
    const v0 = (i + 0.22) / bands, v1 = (i + 0.72) / bands;
    sub(g, col(ctx, p.c2), FA, FB, FC, FD, 0.06, v0, 0.94, v1, 0.9);
    if (s > 5) sub(g, col(ctx, GLINT), FA, FB, FC, FD, 0.06, v0, 0.4, v0 + (v1 - v0) * 0.45, 0.25);
    if (sideVisible && s > 5) sub(g, col(ctx, p.c2), SA, SB, SC, SD, 0.06, v0, 0.94, v1, 0.8);
  }
  for (const u of [0.33, 0.66]) sub(g, col(ctx, lit(p.c, 0.2)), FA, FB, FC, FD, u - 0.02, 0, u + 0.02, 1);
  // crown
  box(ctx, x0 + p.w * 0.2, x1 - p.w * 0.2, p.h, p.h + 3, p.z + p.d * 0.2, p.z + p.d * 0.8, dim(p.c, 0.15));
  if (p.v % 2 === 0) post(ctx, p.x, p.h + 3, p.z + p.d * 0.5, p.x, p.h + 10, p.z + p.d * 0.5, 0.12, 0xe53127);
}

/** Red-and-white telecom mast. */
function mast(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ya = (p.h * i) / n, yb = (p.h * (i + 1)) / n;
    const wa = (p.w / 2) * (1 - (i / n) * 0.8), wb = (p.w / 2) * (1 - ((i + 1) / n) * 0.8);
    cam.project(p.x - wa, ya, p.z, Q1); cam.project(p.x + wa, ya, p.z, Q2); cam.project(p.x + wb, yb, p.z, Q3); cam.project(p.x - wb, yb, p.z, Q4);
    ls(g, Math.max(1.2, Q1.s * 0.22), col(ctx, i % 2 ? 0xf4f1fa : 0xe53127), 1);
    ln(g, Q1.x, Q1.y, Q4.x, Q4.y); ln(g, Q2.x, Q2.y, Q3.x, Q3.y);
    ln(g, Q1.x, Q1.y, Q3.x, Q3.y); ln(g, Q2.x, Q2.y, Q4.x, Q4.y);
  }
}

function tree(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  blobShadow(ctx, p.x, p.z, p.w * 0.55, p.y);
  cam.project(p.x, p.y, p.z, P1);
  const s = P1.s, lw = lineW(s);
  if (s < 12) {
    cam.project(p.x, p.y + p.h * 0.66, p.z, P3);
    const rr = (p.w / 2) * s;
    ls(g, Math.max(1.5, s * 0.5), col(ctx, 0x6b4428), 1); ln(g, P1.x, P1.y, P3.x, P3.y);
    g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P3.x, P3.y, (rr + lw) * 2.2, (rr + lw) * 1.9, 10);
    g.fillStyle(col(ctx, dim(p.c2, 0.3)), 1); oval(g, P3.x, P3.y, rr * 2.2, rr * 1.9, 10);
    g.fillStyle(col(ctx, p.c), 1); oval(g, P3.x + rr * 0.12, P3.y - rr * 0.2, rr * 1.7, rr * 1.4, 10);
    return;
  }
  post(ctx, p.x, p.y, p.z, p.x + 0.15, p.y + p.h * 0.55, p.z, 0.5, 0x6b4428);
  post(ctx, p.x + 0.1, p.y + p.h * 0.36, p.z, p.x - p.w * 0.22, p.y + p.h * 0.6, p.z, 0.24, 0x6b4428);
  const r = (p.w / 2) * s;
  cam.project(p.x, p.y + p.h * 0.72, p.z, P3);
  const blobs: [number, number, number][] = [[-0.62, 0.22, 0.66], [0.6, 0.26, 0.64], [0.05, 0.36, 0.6], [-0.3, -0.3, 0.72], [0.36, -0.26, 0.7], [0, -0.62, 0.56]];
  g.fillStyle(col(ctx, ctx.outline), 1);
  for (const [bx, by, br] of blobs) oval(g, P3.x + bx * r, P3.y + by * r, (br * r + lw) * 2, (br * r + lw) * 2, 12);
  blobs.forEach(([bx, by, br], i) => {
    g.fillStyle(col(ctx, i < 3 ? dim(p.c2, 0.3) : p.c), 1);
    oval(g, P3.x + bx * r, P3.y + by * r, (br * r) * 2, (br * r) * 2, 12);
  });
  // sunlit crown, upper-right
  g.fillStyle(col(ctx, lit(p.c, 0.3)), 1);
  oval(g, P3.x + r * 0.42, P3.y - r * 0.5, (r * 0.4) * 2, (r * 0.4) * 2, 12);
  oval(g, P3.x + r * 0.05, P3.y - r * 0.78, (r * 0.3) * 2, (r * 0.3) * 2, 12);
  oval(g, P3.x - r * 0.3, P3.y - r * 0.42, (r * 0.24) * 2, (r * 0.24) * 2, 12);
  if (p.v % 4 === 0 && s > 4) {
    // flame-tree blossom
    g.fillStyle(col(ctx, 0xff5a2a), 1);
    for (let i = 0; i < 9; i++) oval(g, P3.x + (((hash(p.v, i) % 200) - 100) / 100) * r * 0.95, P3.y + (((hash(p.v, i + 20) % 160) - 110) / 100) * r * 0.7, (r * 0.1) * 2, (r * 0.1) * 2, 12);
  }
}

function bush(ctx: Ctx, p: Prop) {
  blobShadow(ctx, p.x, p.z, p.w * 0.45, p.y);
  ctx.cam.project(p.x, p.y + p.h * 0.45, p.z, P1);
  const g = ctx.g, r = (p.w / 2) * P1.s, lw = lineW(P1.s);
  const blobs: [number, number, number][] = [[-0.6, 0.15, 0.6], [0.6, 0.2, 0.55], [0, -0.1, 0.78]];
  g.fillStyle(col(ctx, ctx.outline), 1);
  for (const [bx, by, br] of blobs) oval(g, P1.x + bx * r, P1.y + by * r, (br * r + lw) * 2, (br * r + lw) * 2, 12);
  blobs.forEach(([bx, by, br], i) => { g.fillStyle(col(ctx, i < 2 ? dim(p.c2, 0.2) : p.c), 1); oval(g, P1.x + bx * r, P1.y + by * r, (br * r) * 2, (br * r) * 2, 12); });
  g.fillStyle(col(ctx, lit(p.c, 0.3)), 1); oval(g, P1.x + r * 0.25, P1.y - r * 0.38, (r * 0.3) * 2, (r * 0.3) * 2, 12);
}

function palm(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  const lean = ((p.v % 7) - 3) * 0.3;
  blobShadow(ctx, p.x - 1, p.z, 1.6, p.y);
  post(ctx, p.x, p.y, p.z, p.x + lean * 0.35, p.y + p.h * 0.5, p.z, 0.42, 0x9a6a3e);
  post(ctx, p.x + lean * 0.35, p.y + p.h * 0.5, p.z, p.x + lean, p.y + p.h, p.z, 0.34, 0x9a6a3e);
  cam.project(p.x + lean, p.y + p.h, p.z, P3);
  const s = P3.s;
  if (s > 9) {
    ls(g, Math.max(1, s * 0.06), col(ctx, 0x5b3a1e), 0.9);
    for (let i = 1; i < 8; i++) {
      const t = i / 8, tx = p.x + lean * (t < 0.5 ? t * 0.7 : 0.35 + (t - 0.5) * 1.3);
      cam.project(tx - 0.2, p.y + p.h * t, p.z, Q1); cam.project(tx + 0.2, p.y + p.h * t + 0.08, p.z, Q2);
      ln(g, Q1.x, Q1.y, Q2.x, Q2.y);
    }
  }
  const len = p.w * 0.66 * s;
  ink(ctx, s, 0.8);
  for (let i = 0; i < 9; i++) {
    const a = -0.5 + (i / 8) * (Math.PI + 1);
    const dx = Math.cos(a), dy = -Math.sin(a) * 0.55;
    const mx = P3.x + dx * len * 0.55, my = P3.y + dy * len * 0.55 - len * 0.2;
    const tx = P3.x + dx * len, ty = P3.y + dy * len + len * 0.22;
    const nx = -dy * len * 0.16, ny = dx * len * 0.16;
    g.fillStyle(col(ctx, i % 2 ? p.c : dim(p.c, 0.3)), 1);
    g.fillTriangle(P3.x, P3.y, mx + nx, my + ny - len * 0.05, tx, ty); g.fillTriangle(P3.x, P3.y, tx, ty, mx - nx, my - ny + len * 0.07);
    if (s > 11) { ln(g, P3.x, P3.y, mx + nx, my + ny - len * 0.05); ln(g, mx + nx, my + ny - len * 0.05, tx, ty); ln(g, tx, ty, mx - nx, my - ny + len * 0.07); }
  }
  g.fillStyle(col(ctx, 0x6b4426), 1); oval(g, P3.x - s * 0.25, P3.y + s * 0.3, (s * 0.3) * 2, (s * 0.3) * 2, 12); oval(g, P3.x + s * 0.28, P3.y + s * 0.34, (s * 0.28) * 2, (s * 0.28) * 2, 12);
}

function lamp(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  cam.project(p.x, p.y, p.z, P4);
  const near = P4.s > 10;
  if (near) box(ctx, p.x - 0.3, p.x + 0.3, p.y, p.y + 0.7, p.z - 0.3, p.z + 0.3, 0xa7a2bd);
  post(ctx, p.x, p.y + (near ? 0.7 : 0), p.z, p.x, p.y + p.h, p.z, 0.2, 0x4a4563);
  post(ctx, p.x, p.y + p.h, p.z, p.x - p.side * 2.8, p.y + p.h + 0.35, p.z, 0.16, 0x4a4563);
  cam.project(p.x - p.side * 2.8, p.y + p.h + 0.2, p.z, P3);
  const s = P3.s;
  if (near) { g.fillStyle(col(ctx, 0xfff2b0), 0.3); oval(g, P3.x, P3.y, (s * 0.85) * 2, (s * 0.85) * 2, 12); }
  g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P3.x, P3.y, s * 1.25, s * 0.55, 8);
  g.fillStyle(col(ctx, 0xfff6c8), 1); oval(g, P3.x, P3.y + s * 0.06, s * 0.95, s * 0.34, 8);
}

/** Utility pole with crossarm, transformer and sagging wires to the next pole. */
function pole(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  post(ctx, p.x, 0, p.z, p.x, p.h, p.z, 0.28, 0x7a5a3c);
  post(ctx, p.x - 1.1, p.h - 0.7, p.z, p.x + 1.1, p.h - 0.7, p.z, 0.16, 0x5b4129);
  if (p.v % 3 === 0) box(ctx, p.x - 0.5, p.x + 0.5, p.h - 3, p.h - 1.7, p.z - 0.4, p.z + 0.4, 0x7d7a93);
  cam.project(p.x, p.h, p.z, P1);
  ls(g, Math.max(1, P1.s * 0.05), col(ctx, 0x1d1733), 0.85 * (1 - ctx.fog));
  for (const off of [-1, 0, 1]) {
    let px = 0, py = 0;
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      cam.project(p.x + off + p.w * t, p.h - 0.6 - Math.sin(Math.PI * t) * (1 + Math.abs(off) * 0.25), p.z + p.d * t, Q1);
      if (i) ln(g, px, py, Q1.x, Q1.y);
      px = Q1.x; py = Q1.y;
    }
  }
}

function banner(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  post(ctx, p.x, 0, p.z, p.x, p.h, p.z, 0.2, 0x2b2539);
  const xa = p.x - p.side * 0.15, xb = p.x - p.side * (p.w + 0.15);
  const xl = Math.min(xa, xb), xr = Math.max(xa, xb);
  cam.project(xl, p.h - 0.3, p.z, FA); cam.project(xr, p.h - 0.3, p.z, FB);
  cam.project(xr, p.h - 4.9, p.z, FC); cam.project(xl, p.h - 4.9, p.z, FD);
  const s = FA.s;
  quad(g, col(ctx, p.c), FA, FB, FC, FD);
  sub(g, col(ctx, dim(p.c, 0.3)), FA, FB, FC, FD, 0.62, 0, 1, 1, 0.55); // fold shadow
  if (s > 3) {
    tri(g, col(ctx, p.c2), FA, FB, FC, FD, 0.52, 0.16, 0.86, 0.84, 0.16, 0.84);
    tri(g, col(ctx, p.c), FA, FB, FC, FD, 0.52, 0.4, 0.6, 0.57, 0.43, 0.57);
    sub(g, col(ctx, p.c), FA, FB, FC, FD, 0.36, 0.68, 0.68, 0.86);
  }
  if (s > 1.7) { ink(ctx, s); strokeQuad(g, FA, FB, FC, FD); }
}

function billboard(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, yb = p.h - 4.8;
  castShadow(ctx, p.x - p.w * 0.3, p.z, p.z + 0.6, 5);
  for (const lx of [p.x - p.w * 0.3, p.x + p.w * 0.3]) post(ctx, lx, 0, p.z + 0.2, lx, yb, p.z + 0.2, 0.36, 0x4a4563);
  cam.project(p.x - p.w * 0.3, 0.5, p.z + 0.2, Q1); cam.project(p.x + p.w * 0.3, yb, p.z + 0.2, Q2);
  cam.project(p.x + p.w * 0.3, 0.5, p.z + 0.2, Q3); cam.project(p.x - p.w * 0.3, yb, p.z + 0.2, Q4);
  ls(g, Math.max(1, Q1.s * 0.12), col(ctx, 0x4a4563), 1); ln(g, Q1.x, Q1.y, Q2.x, Q2.y); ln(g, Q3.x, Q3.y, Q4.x, Q4.y);
  box(ctx, x0, x1, yb, p.h, p.z, p.z + p.d, 0x3a3550);
  box(ctx, x0 - 0.2, x1 + 0.2, yb - 0.35, yb, p.z - 0.7, p.z + p.d, 0x6f6b85); // catwalk
  if (FA.s > 2.2) {
    cam.project(x0 + 0.3, p.h - 0.3, p.z, Q1); cam.project(x1 - 0.3, yb + 0.3, p.z, Q3);
    ctx.signs.push({ key: `billboard-${p.c2}`, x: Q1.x, y: Q1.y, w: Q3.x - Q1.x, h: Q3.y - Q1.y });
  }
}

function gantry(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  for (const lx of [x0, x1]) {
    box(ctx, lx - 0.5, lx + 0.5, p.y, p.y + 1, p.z - 0.5, p.z + 0.5, 0xbdb8ce);
    post(ctx, lx, p.y + 1, p.z, lx, p.y + p.h, p.z, 0.5, 0x6d6888);
  }
  post(ctx, x0, p.y + p.h, p.z, x1, p.y + p.h, p.z, 0.4, 0x6d6888);
  post(ctx, x0, p.y + p.h - 1.3, p.z, x1, p.y + p.h - 1.3, p.z, 0.3, 0x6d6888);
  cam.project(x0, p.y + p.h, p.z, P2);
  if (P2.s < 1.4) return;
  ls(g, Math.max(1, P2.s * 0.12), col(ctx, 0x6d6888), 1);
  const n = Math.round(p.w / 2.2);
  for (let i = 0; i < n; i++) {
    cam.project(x0 + (p.w * i) / n, p.y + p.h - (i % 2 ? 0 : 1.3), p.z, Q1); cam.project(x0 + (p.w * (i + 1)) / n, p.y + p.h - (i % 2 ? 1.3 : 0), p.z, Q2);
    ln(g, Q1.x, Q1.y, Q2.x, Q2.y);
  }
  // Two panels: the risky one hangs over the risky side of the fork.
  const top = p.y + p.h - 1.6, bottom = top - 3.4, half = p.w * 0.21;
  for (const side of [-1, 1]) {
    const cx = p.x + side * p.w * 0.25;
    cam.project(cx - half, top, p.z, Q1); cam.project(cx + half, bottom, p.z, Q3);
    ctx.signs.push({ key: side === p.side ? 'sign-risk' : 'sign-safe', x: Q1.x, y: Q1.y, w: Q3.x - Q1.x, h: Q3.y - Q1.y });
  }
}

/** Chevron board and crash barrels at the nose of a fork. */
function goreSign(ctx: Ctx, p: Prop) {
  const g = ctx.g;
  for (const dx of [-0.75, 0.75]) {
    box(ctx, p.x + dx - 0.55, p.x + dx + 0.55, p.y, p.y + 1.15, p.z - 1.6, p.z - 0.5, 0xff7f2a);
    if (FA.s > 3) sub(g, col(ctx, 0xffffff), FA, FB, FC, FD, 0, 0.3, 1, 0.55);
  }
  post(ctx, p.x, p.y, p.z, p.x, p.y + 1.4, p.z, 0.16, 0x4a4563);
  box(ctx, p.x - 1.5, p.x + 1.5, p.y + 1.4, p.y + 3.1, p.z - 0.08, p.z + 0.08, 0xf6b81f);
  if (FA.s < 2.2) return;
  for (const [u, dir] of [[0.27, -1], [0.73, 1]] as const) {
    tri(g, col(ctx, 0x1a1430), FA, FB, FC, FD, u + dir * 0.2, 0.5, u - dir * 0.05, 0.12, u - dir * 0.05, 0.88);
    tri(g, col(ctx, 0xf6b81f), FA, FB, FC, FD, u + dir * 0.08, 0.5, u - dir * 0.05, 0.3, u - dir * 0.05, 0.7);
  }
}

/** Sharp-turn warning board: black chevron on yellow, pointing the way the road goes (c2: 1 = right). */
function chevron(ctx: Ctx, p: Prop) {
  const dir = p.c2 ? 1 : -1;
  post(ctx, p.x, p.y, p.z, p.x, p.y + p.h - 1.4, p.z, 0.16, 0x4a4563);
  box(ctx, p.x - p.w / 2, p.x + p.w / 2, p.y + p.h - 1.5, p.y + p.h, p.z - 0.08, p.z + 0.08, p.c);
  if (FA.s < 2.2) return;
  for (const u of [0.3, 0.68]) {
    tri(ctx.g, col(ctx, 0x1a1430), FA, FB, FC, FD, u + dir * 0.22, 0.5, u - dir * 0.1, 0.1, u - dir * 0.1, 0.9);
    tri(ctx.g, col(ctx, p.c), FA, FB, FC, FD, u + dir * 0.07, 0.5, u - dir * 0.1, 0.3, u - dir * 0.1, 0.7);
  }
}

function umbrella(ctx: Ctx, x: number, y: number, z: number, r: number, c: number, c2: number) {
  const { g, cam } = ctx;
  post(ctx, x, 0, z, x, y, z, 0.1, 0x3a3550);
  cam.project(x, y, z, P1); cam.project(x, y + 0.85, z, P2);
  const s = P1.s, rx = r * s, ry = rx * 0.4, n = 10;
  g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P1.x, P1.y, (rx + lineW(s)) * 2, (ry + lineW(s)) * 2, 14);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const base = i % 2 ? c2 : c;
    g.fillStyle(col(ctx, Math.cos((a0 + a1) / 2) < -0.2 ? dim(base, 0.3) : base), 1);
    g.fillTriangle(P2.x, P2.y, P1.x + Math.cos(a0) * rx, P1.y + Math.sin(a0) * ry, P1.x + Math.cos(a1) * rx, P1.y + Math.sin(a1) * ry);
  }
  g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P2.x, P2.y, (Math.max(1.5, s * 0.14)) * 2, (Math.max(1.5, s * 0.14)) * 2, 12);
}

function stall(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  blobShadow(ctx, p.x - 0.4, p.z + p.d / 2, 2.2);
  box(ctx, p.x - p.w / 2, p.x + p.w / 2, 0, 0.95, p.z, p.z + p.d, 0xa56e42, 0xd49a62);
  if (topVisible && FA.s > 9) {
    const goods = [0xff7f2a, 0xe53935, 0x4fae52, 0xffd23f, 0xff7f2a, 0x8e3fd1];
    for (let i = 0; i < 6; i++) {
      cam.project(p.x - p.w * 0.32 + (i % 3) * p.w * 0.32, 1.12, p.z + 0.55 + Math.floor(i / 3) * 1, P1);
      g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P1.x, P1.y, (P1.s * 0.36) * 2, (P1.s * 0.36) * 2, 12);
      g.fillStyle(col(ctx, goods[(i + p.v) % goods.length]), 1); oval(g, P1.x, P1.y, (P1.s * 0.28) * 2, (P1.s * 0.28) * 2, 12);
    }
  }
  // sacks / baskets beside the table
  box(ctx, p.x - p.w / 2 - 1, p.x - p.w / 2 - 0.2, 0, 0.7, p.z + 0.3, p.z + 1.1, 0xe8d3a0);
  umbrella(ctx, p.x, 2.7, p.z + p.d / 2, 2.1, p.c, p.c2 === p.c ? 0xfff6e6 : p.c2);
}

/** Painted roadside kiosk (recharge cards, cold drinks…). */
function kiosk(ctx: Ctx, p: Prop) {
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, dir = -p.side;
  castShadow(ctx, x0, p.z, p.z + p.d, p.h * 0.6);
  box(ctx, x0, x1, 0, p.h, p.z, p.z + p.d, p.c, dim(p.c2, 0.1));
  const s = FA.s;
  if (s < 4.5) return;
  sub(ctx.g, col(ctx, p.c2), FA, FB, FC, FD, 0, 0.72, 1, 1);
  ctx.signs.push({ key: `shop-${p.v % 8}`, x: FA.x + s * 0.15, y: FA.y + s * 0.15, w: FB.x - FA.x - s * 0.3, h: (FD.y - FA.y) * 0.36 });
  if (sideVisible) {
    sub(ctx.g, col(ctx, 0x1d1733), SA, SB, SC, SD, 0.12, 0.3, 0.88, 0.62);
    sub(ctx.g, col(ctx, p.c2), SA, SB, SC, SD, 0, 0.72, 1, 1);
    awning(ctx, p.side < 0 ? x1 : x0, dir, p.h * 0.72 + 0.6, p.z + 0.1, p.z + p.d - 0.1, p.c2, s * 0.9);
  }
}

function wheels(ctx: Ctx, r: number, us: number[]) {
  if (!sideVisible) return;
  for (const u of us) {
    bil(SA, SB, SC, SD, u, 0.97, Q1);
    ctx.g.fillStyle(col(ctx, ctx.outline), 1); oval(ctx.g, Q1.x, Q1.y, (r * 1.12) * 2, (r * 1.12) * 2, 12);
    ctx.g.fillStyle(col(ctx, 0x2a2638), 1); oval(ctx.g, Q1.x, Q1.y, (r * 0.92) * 2, (r * 0.92) * 2, 12);
    ctx.g.fillStyle(col(ctx, 0xb9b4cc), 1); oval(ctx.g, Q1.x, Q1.y, (r * 0.4) * 2, (r * 0.4) * 2, 12);
  }
}

/** The yellow Lagos danfo minibus: twin black stripes, roof rack piled with luggage. */
function danfo(ctx: Ctx, p: Prop) {
  const g = ctx.g, x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  castShadow(ctx, x0, p.z, p.z + p.d, 2.6);
  box(ctx, x0, x1, 0.4, p.h, p.z, p.z + p.d, p.c);
  const s = FA.s;
  if (s > 4.5) {
    sub(g, col(ctx, WINDOW), FA, FB, FC, FD, 0.1, 0.08, 0.9, 0.42);
    sub(g, col(ctx, GLINT), FA, FB, FC, FD, 0.1, 0.08, 0.4, 0.24, 0.45);
    sub(g, col(ctx, p.c2), FA, FB, FC, FD, 0, 0.52, 1, 0.6);
    sub(g, col(ctx, p.c2), FA, FB, FC, FD, 0, 0.66, 1, 0.72);
    sub(g, col(ctx, 0xe53935), FA, FB, FC, FD, 0.05, 0.76, 0.2, 0.88);
    sub(g, col(ctx, 0xe53935), FA, FB, FC, FD, 0.8, 0.76, 0.95, 0.88);
    sub(g, col(ctx, 0xf4f1fa), FA, FB, FC, FD, 0.36, 0.78, 0.64, 0.9);
    sub(g, col(ctx, 0x2a2638), FA, FB, FC, FD, 0, 0.92, 1, 1);
    if (sideVisible) {
      sub(g, col(ctx, WINDOW), SA, SB, SC, SD, 0.04, 0.09, 0.96, 0.4);
      for (const u of [0.26, 0.5, 0.74]) sub(g, col(ctx, dim(p.c, 0.2)), SA, SB, SC, SD, u, 0.09, u + 0.035, 0.4);
      sub(g, col(ctx, p.c2), SA, SB, SC, SD, 0, 0.52, 1, 0.6);
      sub(g, col(ctx, p.c2), SA, SB, SC, SD, 0, 0.66, 1, 0.72);
      sub(g, col(ctx, 0x2a2638), SA, SB, SC, SD, 0, 0.92, 1, 1);
      wheels(ctx, s * 0.46, [0.2, 0.8]);
    }
  }
  if (s > 7) {
    // roof rack luggage
    box(ctx, x0 + 0.25, x1 - 0.25, p.h, p.h + 0.12, p.z + 0.5, p.z + p.d - 0.6, 0x4a4563);
    box(ctx, x0 + 0.4, p.x + 0.2, p.h + 0.12, p.h + 0.75, p.z + 0.8, p.z + 2.2, [0x2f7fe0, 0xe53935, 0x1e9e5a][p.v % 3]);
    box(ctx, p.x - 0.3, x1 - 0.4, p.h + 0.12, p.h + 0.6, p.z + 2.6, p.z + 4, 0xb98a5a);
  }
}

/** Keke (tricycle taxi): yellow tub, dark canopy. */
function keke(ctx: Ctx, p: Prop) {
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  castShadow(ctx, x0, p.z, p.z + p.d, 1.8);
  box(ctx, x0, x1, 0.32, p.h * 0.58, p.z, p.z + p.d, p.c);
  const s = FA.s;
  if (s > 5) {
    sub(ctx.g, col(ctx, p.c2), FA, FB, FC, FD, 0, 0.3, 1, 0.48);
    sub(ctx.g, col(ctx, 0xe53935), FA, FB, FC, FD, 0.06, 0.58, 0.22, 0.82);
    sub(ctx.g, col(ctx, 0xe53935), FA, FB, FC, FD, 0.78, 0.58, 0.94, 0.82);
    if (sideVisible) { sub(ctx.g, col(ctx, p.c2), SA, SB, SC, SD, 0, 0.3, 1, 0.48); wheels(ctx, s * 0.34, [0.2, 0.82]); }
  }
  // canopy on thin posts with an open rear window
  box(ctx, x0 + 0.05, x1 - 0.05, p.h * 0.58, p.h, p.z + 0.2, p.z + p.d - 0.5, 0x2a2d55, 0x3a3f7a);
  if (FA.s > 5) {
    sub(ctx.g, col(ctx, 0x7fa6dc), FA, FB, FC, FD, 0.16, 0.2, 0.84, 0.88);
    if (sideVisible) sub(ctx.g, col(ctx, 0x1d1733), SA, SB, SC, SD, 0.12, 0.22, 0.7, 1);
  }
}

function canoe(ctx: Ctx, p: Prop) {
  const { g, cam } = ctx;
  const y = 0.3, hw = p.w / 2;
  cam.project(p.x, 0, p.z - 0.8, P1);
  g.fillStyle(col(ctx, 0xdff3ff), 0.55); oval(g, P1.x, P1.y, P1.s * p.w * 1.7, P1.s * 0.4, 14);
  cam.project(p.x, y, p.z, FA); cam.project(p.x + hw, y, p.z + p.d * 0.3, FB);
  cam.project(p.x + hw, y, p.z + p.d * 0.7, FC); cam.project(p.x, y, p.z + p.d, FD);
  cam.project(p.x - hw, y, p.z + p.d * 0.7, SA); cam.project(p.x - hw, y, p.z + p.d * 0.3, SB);
  quad(g, col(ctx, dim(p.c, 0.25)), FA, FB, FC, FD); quad(g, col(ctx, p.c), FA, FD, SA, SB);
  if (FA.s < 2.2) return;
  ink(ctx, FA.s);
  ln(g, FA.x, FA.y, FB.x, FB.y); ln(g, FB.x, FB.y, FC.x, FC.y); ln(g, FC.x, FC.y, FD.x, FD.y); ln(g, FD.x, FD.y, SA.x, SA.y); ln(g, SA.x, SA.y, SB.x, SB.y); ln(g, SB.x, SB.y, FA.x, FA.y);
  cam.project(p.x - hw * 0.8, y, p.z + p.d * 0.35, P1); cam.project(p.x + hw * 0.8, y, p.z + p.d * 0.35, P2);
  ls(g, Math.max(1.5, FA.s * 0.22), col(ctx, p.c2), 1); ln(g, P1.x, P1.y, P2.x, P2.y);
  // fisherman with paddle
  const fz = p.z + p.d * 0.62;
  post(ctx, p.x, y, fz, p.x, y + 1.0, fz, 0.42, p.c2);
  cam.project(p.x, y + 1.3, fz, P1);
  g.fillStyle(col(ctx, ctx.outline), 1); oval(g, P1.x, P1.y, (P1.s * 0.3) * 2, (P1.s * 0.3) * 2, 12);
  g.fillStyle(col(ctx, 0x6b4426), 1); oval(g, P1.x, P1.y, (P1.s * 0.22) * 2, (P1.s * 0.22) * 2, 12);
  post(ctx, p.x - 0.5, y + 1.2, fz, p.x + 1.3, y - 0.2, fz, 0.07, 0xd9b27a);
}

function stiltHut(ctx: Ctx, p: Prop) {
  const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2;
  for (const [lx, lz] of [[x0 + 0.3, p.z + p.d], [x1 - 0.3, p.z + p.d], [x0 + 0.3, p.z], [x1 - 0.3, p.z]]) post(ctx, lx, 0, lz, lx, 1.8, lz, 0.16, 0x5b4129);
  box(ctx, x0 - 0.8, x1 + 0.8, 1.6, 1.8, p.z - 0.8, p.z + p.d + 0.3, 0x9a7a52); // deck
  box(ctx, x0, x1, 1.8, 1.8 + p.h, p.z, p.z + p.d, p.c);
  const s = FA.s;
  if (s > 3) {
    sub(ctx.g, col(ctx, 0x1d1733), FA, FB, FC, FD, 0.38, 0.4, 0.62, 1);
    for (let i = 1; i < 5; i++) sub(ctx.g, col(ctx, dim(p.c, 0.3)), FA, FB, FC, FD, i * 0.2 - 0.01, 0, i * 0.2 + 0.01, 1, 0.6);
  }
  tinRoof(ctx, x0, x1, 1.8 + p.h, p.z, p.z + p.d, p.c2, p.c, s);
}

const PAINTERS: Record<Prop['kind'], (ctx: Ctx, p: Prop) => void> = {
  building, tower, mast, tree, palm, bush, lamp, pole, banner, billboard, stall, kiosk, danfo, keke, canoe, stiltHut, gantry, goreSign, chevron,
};

export function drawProp(ctx: Ctx, p: Prop) {
  PAINTERS[p.kind](ctx, p);
}

/** Common debris (temporary procedural art until hazard sprites are cut from the sheets). */
export function drawCrate(ctx: Ctx, x: number, y: number, z: number) {
  const g = ctx.g;
  castShadow(ctx, x - 1, z - 0.9, z + 0.9, 2, y + 0.04);
  box(ctx, x - 1.0, x + 1.0, y, y + 1.8, z - 0.9, z + 0.9, 0xe8893a, 0xf7b468);
  if (FA.s < 2.5) return;
  ls(g, lineW(FA.s) * 1.3, col(ctx, 0x8a4516), 1);
  bil(FA, FB, FC, FD, 0.12, 0.12, Q1); bil(FA, FB, FC, FD, 0.88, 0.88, Q2); ln(g, Q1.x, Q1.y, Q2.x, Q2.y);
  bil(FA, FB, FC, FD, 0.88, 0.12, Q1); bil(FA, FB, FC, FD, 0.12, 0.88, Q2); ln(g, Q1.x, Q1.y, Q2.x, Q2.y);
  bil(FA, FB, FC, FD, 0.1, 0.1, Q1); bil(FA, FB, FC, FD, 0.9, 0.1, Q2); bil(FA, FB, FC, FD, 0.9, 0.9, Q3); bil(FA, FB, FC, FD, 0.1, 0.9, Q4);
  strokeQuad(g, Q1, Q2, Q3, Q4);
}

export function drawBarricade(ctx: Ctx, x: number, y: number, z: number) {
  const g = ctx.g;
  castShadow(ctx, x - 1.3, z - 0.1, z + 0.1, 1.2, y + 0.04);
  for (const lx of [x - 1.15, x + 1.15]) post(ctx, lx, y, z, lx, y + 1.05, z, 0.16, 0x2b2539);
  box(ctx, x - 1.4, x + 1.4, y + 0.45, y + 1.05, z - 0.12, z + 0.12, 0xfaf7ff, 0xffffff);
  if (FA.s < 2.5) return;
  for (let i = 0; i < 4; i++) {
    tri(g, col(ctx, 0xe53127), FA, FB, FC, FD, i * 0.25 + 0.02, 1, i * 0.25 + 0.14, 0, i * 0.25 + 0.14, 1);
    tri(g, col(ctx, 0xe53127), FA, FB, FC, FD, i * 0.25 + 0.14, 0, i * 0.25 + 0.26, 0, i * 0.25 + 0.14, 1);
  }
  ink(ctx, FA.s); strokeQuad(g, FA, FB, FC, FD);
}
