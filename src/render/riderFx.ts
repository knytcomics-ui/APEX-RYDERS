import type { Camera } from './camera';
import { pt } from './camera';
import { SHADOW_INK, ln, ls, oval, quad } from './props';
import type { Painter } from './triBatch';

interface Puff { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; r: number }
interface Mark { x: number; y: number; z: number; on: boolean }
interface Ring { x: number; y: number; z: number; vz: number; age: number; life: number; r0: number; r1: number; color: number; width: number }
interface TrailPoint { x: number; y: number; z: number; age: number }

const A = pt(), B = pt(), C = pt(), D = pt();
const DUST = 0xdccbb0, DUST_LIT = 0xf3e8d4, DUST_INK = 0x5a4a52;
export const ENERGY = 0x35c6ff;
const TRAIL_LIFE = 0.32;

/**
 * Rider effects that live in the world: skid marks, tyre dust, landing bursts,
 * shock rings and the Surge Jump energy trails. World-anchored, so they stream
 * away behind the bike exactly like the road does.
 */
export class RiderFx {
  private puffs: Puff[] = [];
  private marks: Mark[] = [];
  private rings: Ring[] = [];
  private trails: TrailPoint[][] = [[], []];
  private emit = 0;

  update(dt: number, speed: number, drift: number, dir: number, x: number, y: number, z: number, camZ: number) {
    for (const p of this.puffs) {
      p.age += dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 1 - Math.min(1, dt * 2.5);
      p.vy *= 1 - Math.min(1, dt * 3);
      p.vz *= 1 - Math.min(1, dt * 1.4);
    }
    this.puffs = this.puffs.filter((p) => p.age < p.life);
    for (const r of this.rings) { r.age += dt; r.z += r.vz * dt; }
    this.rings = this.rings.filter((r) => r.age < r.life);
    for (const tr of this.trails) {
      for (const p of tr) p.age += dt;
      while (tr.length && tr[0].age > TRAIL_LIFE) tr.shift();
    }

    const last = this.marks[this.marks.length - 1];
    if (drift > 0.25) {
      this.emit += dt * 42 * drift;
      while (this.emit >= 1) {
        this.emit--;
        this.puffs.push({
          x: x + (Math.random() - 0.5) * 0.5, y: y + 0.15, z: z - Math.random() * 0.6,
          vx: -dir * (2.2 + Math.random() * 3), vy: 0.9 + Math.random() * 1.6, vz: speed * (0.62 + Math.random() * 0.22),
          age: 0, life: 0.38 + Math.random() * 0.3, r: (0.3 + Math.random() * 0.26) * (0.55 + drift * 0.45),
        });
      }
      this.marks.push({ x, y, z, on: true });
    } else if (last && last.on) {
      this.marks.push({ x, y, z, on: false });
    }
    let cut = 0;
    while (cut < this.marks.length && this.marks[cut].z < camZ - 1) cut++;
    if (cut) this.marks.splice(0, cut);
  }

  /** Dust thrown out to both sides: landings and launches. power ~ 0.5 (light) .. 2 (surge). */
  burst(x: number, y: number, z: number, speed: number, power: number) {
    const n = Math.round(8 + power * 9);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      this.puffs.push({
        x: x + side * Math.random() * 0.4, y: y + 0.12, z: z - 0.6 + Math.random() * 1.6,
        vx: side * (1.6 + Math.random() * 3.8) * (0.7 + power * 0.4), vy: 0.5 + Math.random() * 1.5 * power, vz: speed * (0.72 + Math.random() * 0.2),
        age: 0, life: 0.34 + Math.random() * 0.3 + power * 0.08, r: (0.26 + Math.random() * 0.3) * (0.7 + power * 0.35),
      });
    }
  }

  /** Expanding ring (ground shock, mid-air kick). */
  ring(x: number, y: number, z: number, speed: number, r1: number, color: number, life = 0.36, width = 0.16) {
    this.rings.push({ x, y, z, vz: speed * 0.86, age: 0, life, r0: 0.5, r1, color, width });
  }

  /** Feed the two exhaust positions while the Surge energy is firing. */
  trail(on: boolean, left: [number, number, number], right: [number, number, number]) {
    if (!on) return;
    this.trails[0].push({ x: left[0], y: left[1], z: left[2], age: 0 });
    this.trails[1].push({ x: right[0], y: right[1], z: right[2], age: 0 });
  }

  /** Dark rubber streaks on the tarmac. */
  drawMarks(g: Painter, cam: Camera) {
    const m = this.marks, w = 0.26;
    for (let i = 1; i < m.length; i++) {
      const a = m[i - 1], b = m[i];
      if (!a.on || !b.on) continue;
      cam.project(a.x - w, a.y + 0.025, a.z, A); cam.project(a.x + w, a.y + 0.025, a.z, B);
      cam.project(b.x + w, b.y + 0.025, b.z, C); cam.project(b.x - w, b.y + 0.025, b.z, D);
      quad(g, SHADOW_INK, A, B, C, D, 0.5);
    }
  }

  /** Rings and energy ribbons (drawn beneath the rider). */
  drawEnergy(g: Painter, cam: Camera) {
    for (const r of this.rings) {
      const t = r.age / r.life, ease = 1 - (1 - t) * (1 - t);
      cam.project(r.x, r.y, r.z, A);
      const rad = (r.r0 + (r.r1 - r.r0) * ease) * A.s;
      for (const [k, col, a] of [[1, r.color, 0.9], [0.45, 0xffffff, 0.8]] as const) {
        ls(g, Math.max(1.5, r.width * A.s * (1 - t) * k), col, (1 - t) * a);
        const rx = rad, ry = rad * 0.42;
        for (let i = 0; i < 20; i++) {
          const a0 = (i / 20) * Math.PI * 2, a1 = ((i + 1) / 20) * Math.PI * 2;
          ln(g, A.x + Math.cos(a0) * rx, A.y + Math.sin(a0) * ry, A.x + Math.cos(a1) * rx, A.y + Math.sin(a1) * ry);
        }
      }
    }
    for (const tr of this.trails) {
      for (let i = 1; i < tr.length; i++) {
        const a = tr[i - 1], b = tr[i];
        const fa = 1 - a.age / TRAIL_LIFE, fb = 1 - b.age / TRAIL_LIFE;
        cam.project(a.x, a.y, a.z, A); cam.project(b.x, b.y, b.z, B);
        const wa = A.s * 0.34 * fa, wb = B.s * 0.34 * fb;
        g.fillStyle(ENERGY, 0.55 * fb);
        g.fillTriangle(A.x - wa, A.y, A.x + wa, A.y, B.x + wb, B.y); g.fillTriangle(A.x - wa, A.y, B.x + wb, B.y, B.x - wb, B.y);
        g.fillStyle(0xe8fbff, 0.8 * fb);
        g.fillTriangle(A.x - wa * 0.4, A.y, A.x + wa * 0.4, A.y, B.x + wb * 0.4, B.y); g.fillTriangle(A.x - wa * 0.4, A.y, B.x + wb * 0.4, B.y, B.x - wb * 0.4, B.y);
      }
    }
  }

  /** Comic dust clouds: inked rim, beige body, sunlit cap. */
  drawDust(g: Painter, cam: Camera) {
    for (const p of this.puffs) {
      cam.project(p.x, p.y, p.z, A);
      const t = p.age / p.life;
      const r = p.r * (0.55 + t * 1.5) * A.s;
      const alpha = (1 - t) * (1 - t) * 0.9;
      g.fillStyle(DUST_INK, alpha * 0.75); oval(g, A.x, A.y, r * 2 + A.s * 0.12, r * 1.7 + A.s * 0.12, 12);
      g.fillStyle(DUST, alpha); oval(g, A.x, A.y, r * 2, r * 1.7, 12);
      g.fillStyle(DUST_LIT, alpha); oval(g, A.x + r * 0.22, A.y - r * 0.26, r * 1.1, r * 0.85, 8);
    }
  }
}
