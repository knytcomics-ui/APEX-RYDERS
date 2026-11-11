import Phaser from 'phaser';
import { LANE_W, SLICE, clamp, smooth } from '../core/config';
import type { Sim } from '../sim/sim';
import { ENVIRONMENTS, type Palette, type Prop } from '../world/environment';
import { isPickup, type Entity } from '../world/populate';
import type { Section } from '../world/route';
import { pt, type Camera, type Pt } from './camera';
import { TriBatch, type Painter } from './triBatch';
import { RiderSprite } from '../characters/riderSprite';
import { EXHAUST_TIPS, FRONT_CONTACT, LIVERIES, REAR_CONTACT } from '../characters/mach/machRig';
import { RiderAnimator, type ForcedAnim } from '../characters/riderAnimator';
import { ENERGY, RiderFx } from './riderFx';
import { CHASM, MUTANT, PILLARS, type Hazard } from '../world/hazards';
import type { CharacterId } from '../core/config';
import type { JumpKind } from '../sim/sim';
import { SHADOW_INK, box, dim, drawBarricade, drawCrate, drawProp, hash, lit, ln, ls, mix, oval, quad, ring, type Ctx } from './props';

const A = pt(), B = pt(), C = pt(), D = pt(), E = pt(), F = pt(), G = pt(), H = pt();
const PICKUP_TEX = { coin: 'coin', momentumSmall: 'momentum_small', momentumLarge: 'momentum_large' } as const;
const PICKUP_SIZE = { coin: 1.5, momentumSmall: 1.9, momentumLarge: 2.6 } as const;
const RIDER_SCALE = 1.9; // the rig is modelled at real size, then arcade-scaled for readability
const SIDEWALK = 5; // metres of pavement outside the barrier
const FRONTAGE = 12.5; // paved service strip ends here; buildings begin
const TRENCH = 6; // how far a Chasm cuts beyond each road edge
const REPEL_GREEN = 0x6dff8a;

type Gfx = TriBatch;

/**
 * Paints the world back-to-front in world-aligned slices: ground, road ribbons,
 * markings, barriers and scenery all go through the same camera projection.
 */
export class WorldRenderer {
  private gBack: Gfx; // everything beyond the rider
  private gFront: Gfx; // things between rider and camera
  private sky: Phaser.GameObjects.Graphics;
  private sun: Phaser.GameObjects.Image;
  private skyline: Phaser.GameObjects.TileSprite;
  private vignette: Phaser.GameObjects.Image;
  private pickups: Phaser.GameObjects.Image[] = [];
  private signs: Phaser.GameObjects.Image[] = [];
  readonly rider: Phaser.GameObjects.Image;
  private propBuckets: Prop[][] = [];
  private entBuckets: { e: Entity; sec: Section }[][] = [];
  private ctx: Ctx;
  private pal: Palette;
  private sliceCount = 90;
  private aura: Phaser.GameObjects.Image;
  private riderSize = RIDER_SCALE;
  private riderSprite: RiderSprite;
  private animator = new RiderAnimator();
  private fx = new RiderFx();

  constructor(private scene: Phaser.Scene, private cam: Camera) {
    const env = ENVIRONMENTS.city;
    this.pal = env.palette;
    this.sky = scene.add.graphics().setDepth(0);
    this.sun = scene.add.image(0, 0, 'glow').setDepth(0.5).setTint(0xfff0b8).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.75);
    this.skyline = scene.add.tileSprite(0, 0, 16, 16, env.backdropKey).setOrigin(0, 1).setDepth(1);
    this.gBack = new TriBatch(scene, 10);
    this.riderSprite = new RiderSprite(scene, 'mach-rig');
    this.rider = scene.add.image(0, 0, 'mach-rig').setOrigin(RiderSprite.OX / RiderSprite.W, RiderSprite.OY / RiderSprite.H).setDepth(20);
    this.gFront = new TriBatch(scene, 30);
    this.aura = scene.add.image(0, 0, 'glow').setDepth(19).setTint(ENERGY).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.vignette = scene.add.image(0, 0, 'vignette').setOrigin(0, 0).setDepth(35).setAlpha(0.4);
    this.ctx = { g: this.gBack, cam, fog: 0, haze: this.pal.haze, outline: this.pal.outline, signs: [] };
    this.resize();
  }

  resize() {
    const { cam, pal } = this;
    this.sliceCount = Math.round(84 * Math.min(cam.pull, 1.8));
    this.sky.clear();
    this.sky.fillGradientStyle(pal.skyTop, pal.skyTop, pal.skyBottom, pal.skyBottom, 1);
    this.sky.fillRect(0, 0, cam.w, Math.max(4, cam.horizonY + 4));
    const scale = (cam.h * 0.3) / 512;
    this.skyline.setPosition(0, cam.horizonY + 2).setSize(cam.w / scale, 512).setScale(scale);
    this.sun.setPosition(cam.w * 0.82, cam.horizonY * 0.35).setDisplaySize(cam.h * 0.9, cam.h * 0.9);
    this.vignette.setDisplaySize(cam.w, cam.h);
  }

  private bucket(sim: Sim, k0: number, n: number) {
    while (this.propBuckets.length < n) { this.propBuckets.push([]); this.entBuckets.push([]); }
    for (let i = 0; i < n; i++) { this.propBuckets[i].length = 0; this.entBuckets[i].length = 0; }
    const zMin = k0 * SLICE, zMax = (k0 + n) * SLICE;
    for (const sec of sim.route.sections) {
      if (sec.s1 < zMin || sec.s0 > zMax) continue;
      for (const p of sec.props) {
        const k = Math.floor(p.z / SLICE) - k0;
        if (k >= 0 && k < n) this.propBuckets[k].push(p);
      }
      for (const e of sec.entities) {
        if (e.taken) continue;
        const k = Math.floor(e.s / SLICE) - k0;
        if (k >= 0 && k < n) this.entBuckets[k].push({ e, sec });
      }
    }
  }

  /** Flat quad on a horizontal plane between two z's with per-end x extents. */
  private flat(g: Painter, col: number, x0A: number, x1A: number, x0B: number, x1B: number, yA: number, yB: number, zA: number, zB: number, alpha = 1) {
    const cam = this.cam;
    cam.project(x0A, yA, zA, E); cam.project(x1A, yA, zA, F); cam.project(x1B, yB, zB, G); cam.project(x0B, yB, zB, H);
    quad(g, col, E, F, G, H, alpha);
  }

  draw(sim: Sim, dt: number, time: number) {
    const { cam, pal, gBack, gFront, ctx } = this;
    const route = sim.route;

    // --- camera follows the rider ---
    const sec0 = sim.sec;
    const rb = sec0.laneRibbon[sim.lane];
    const ribbonMid = (sec0.left(rb, sim.s) + sec0.right(rb, sim.s)) / 2;
    const targetX = sim.x * 0.62 + ribbonMid * 0.38 + sec0.heading(sim.s) * 9;
    cam.x += (targetX - cam.x) * (1 - Math.exp(-dt * 7));
    cam.y += (sim.groundY + cam.height + Math.max(0, sim.jumpY) * 0.4 - cam.y) * (1 - Math.exp(-dt * 5)); // rises a little with big jumps
    cam.z = sim.s - cam.back;

    this.skyline.tilePositionX = cam.x * 2.2 + sec0.heading(sim.s) * 260;

    gBack.clear();
    gFront.clear();
    ctx.signs.length = 0;
    gBack.fillStyle(pal.haze, 1);
    gBack.fillRect(0, cam.horizonY, cam.w, cam.h - cam.horizonY);

    const n = this.sliceCount;
    const k0 = Math.floor((cam.z - 2) / SLICE);
    const far = n * SLICE;
    this.bucket(sim, k0, n);

    for (let i = n - 1; i >= 0; i--) {
      const ks = k0 + i;
      const zA = ks * SLICE, zB = zA + SLICE, zM = zA + SLICE / 2;
      const sec = route.sectionAt(zM);
      if (zM < sec.s0 || zM > sec.s1) continue;
      const fog = clamp((zA - cam.z - far * 0.42) / (far * 0.58), 0, 1) * 0.92;
      ctx.fog = fog;
      ctx.g = gBack;

      const hazard = sec.hazards.length ? sec.hazards[0] : null;
      const inGap = !!hazard && hazard.kind === 'chasm' && zM > hazard.z0 && zM < hazard.z1;
      this.drawGround(sim, sec, zA, zB, ks, fog, inGap);

      if (inGap) {
        this.drawPit(sec, hazard!, zA, zB, fog); // no road here at all
      } else {
        // ribbons, lowest first
        const nr = sec.ribbons.length;
        for (let pass = 0; pass < nr; pass++) {
          let r = pass;
          if (nr === 2 && sec.rElev(0, zA) > sec.rElev(1, zA)) r = 1 - pass;
          this.drawRibbon(sec, r, zA, zB, ks, fog, sim.s);
        }
        if (hazard?.kind === 'chasm') this.drawChasmDecor(sec, hazard, zA, zB, ks, fog);
        else if (hazard) this.drawApproach(sec, hazard, zA, zB, ks, fog, 4);
      }

      // scenery and debris in this slice
      ctx.g = zA < sim.s - 1 ? gFront : gBack;
      // thin roadside props right beside the camera would smear across the view: drop them
      const nearCull = zA < sim.s - 3;
      for (const p of this.propBuckets[i]) if (!nearCull || p.kind === 'building' || p.kind === 'tower') drawProp(ctx, p);
      for (const { e, sec: es } of this.entBuckets[i]) {
        if (isPickup(e.kind)) continue;
        const x = es.laneX(e.lane, e.s), y = es.laneY(e.lane, e.s);
        if (e.kind === 'crate') drawCrate(ctx, x, y, e.s); else drawBarricade(ctx, x, y, e.s);
      }
      if (hazard?.kind === 'pillars' && hazard.z0 >= zA && hazard.z0 < zB) this.drawPillars(sec, hazard, fog);
      if (hazard?.kind === 'mutantSpill' && hazard.z0 >= zA && hazard.z0 < zB) this.drawSpill(sec, hazard, fog, sim, time);
    }

    this.drawPickups(sim, time);
    this.drawSigns();
    this.drawRider(sim, dt, time);
  }

  /** Ground plane with roadside layering: gutter, pavement, kerb, service strip, earth. */
  private drawGround(sim: Sim, sec: Section, zA: number, zB: number, ks: number, fog: number, gap = false) {
    const { cam, pal, gBack: g } = this;
    const hz = pal.haze;
    const band = (ks & 3) < 2 ? 0 : 1;
    const water = sec.def.ground === 'water';
    const route = sim.route;
    const shore = route.sectionAt(zB + 6).def.ground !== sec.def.ground || route.sectionAt(zA - 6).def.ground !== sec.def.ground;
    route.sectionAt(zA);

    const base = shore ? 0xe8d2a0 : (water ? pal.water : pal.ground)[band];
    if (gap) {
      // the Chasm swallows the road and its pavements: only the land either side remains
      const l0 = sec.left(0, zA) - TRENCH, l1 = sec.left(0, zB) - TRENCH, r0 = sec.right(0, zA) + TRENCH, r1 = sec.right(0, zB) + TRENCH;
      this.flat(g, mix(base, hz, fog), cam.x - 900, l0, cam.x - 900, l1, 0, 0, zA, zB);
      this.flat(g, mix(base, hz, fog), r0, cam.x + 900, r1, cam.x + 900, 0, 0, zA, zB);
      return;
    }
    this.flat(g, mix(base, hz, fog), cam.x - 900, cam.x + 900, cam.x - 900, cam.x + 900, 0, 0, zA, zB);
    const near = E.s; // E = near-left corner just projected
    const detail = near > 6;
    const nr = sec.ribbons.length;
    const cx = sec.centerX(zA);

    if (water) {
      if (detail && !shore) {
        // wave glints
        for (let j = 0; j < 3; j++) {
          const h = hash(ks, j + 1);
          if (h % 3) continue;
          const wx = cx + ((h >> 3) % 2 ? 1 : -1) * (14 + ((h >> 5) % 70));
          cam.project(wx, 0.02, zA + 1, A); cam.project(wx + 2.5 + (h % 4), 0.02, zA + 1, B);
          ls(g, Math.max(1, A.s * 0.14), mix(0xd8f1ff, hz, fog), 0.7); ln(g, A.x, A.y, B.x, B.y);
        }
      }
    } else {
      for (const side of [-1, 1] as const) {
        const r = side < 0 ? 0 : nr - 1;
        if (sec.y(r, zA) > 1.5) continue;
        const eA = side < 0 ? sec.left(0, zA) : sec.right(nr - 1, zA);
        const eB = side < 0 ? sec.left(0, zB) : sec.right(nr - 1, zB);
        const span = (a: number, b: number, col: number, alpha = 1) => {
          const x0A = eA + side * a, x1A = eA + side * b, x0B = eB + side * a, x1B = eB + side * b;
          this.flat(g, mix(col, hz, fog), Math.min(x0A, x1A), Math.max(x0A, x1A), Math.min(x0B, x1B), Math.max(x0B, x1B), 0, 0, zA, zB, alpha);
        };
        if (!shore) span(SIDEWALK, FRONTAGE, pal.service[band]);
        span(0, SIDEWALK, pal.sidewalk[ks & 1]);
        if (near > 3.2) span(SIDEWALK, SIDEWALK + 0.4, (ks & 1) ? 0xf4f1fa : 0x2b2539); // painted kerb
        if (detail) {
          if (near > 10) span(0, 0.55, pal.outline, 0.3); // gutter
          if (near > 10) span(2.45, 2.55, pal.outline, 0.18); // paver seam
          // earth patches and grass beyond the frontage
          const h = hash(ks, side + 5);
          if (h % 3 === 0) {
            cam.project(eA + side * (FRONTAGE + 6 + (h % 40)), 0.02, zA + 1.5, A);
            g.fillStyle(mix(h % 2 ? dim(pal.ground[0], 0.22) : 0x6aa84a, hz, fog), 0.8);
            oval(g, A.x, A.y, A.s * (3 + (h % 5)), A.s * (0.9 + (h % 3) * 0.3), 14);
          }
          if (h % 7 === 0) {
            cam.project(eA + side * (6.5 + (h % 5)), 0.02, zA + 1.5, A);
            g.fillStyle(pal.outline, 0.16); oval(g, A.x, A.y, A.s * 2.2, A.s * 0.6, 14); // oil stain on the service strip
          }
        }
      }
    }

    // median / gore between separated ribbons
    for (let r = 0; r < nr - 1; r++) {
      const a0 = sec.right(r, zA), a1 = sec.left(r + 1, zA), b0 = sec.right(r, zB), b1 = sec.left(r + 1, zB);
      const gap = a1 - a0;
      if (gap < 0.05) continue;
      if (gap < 6.5) {
        // painted gore: asphalt with white chevron hatching
        this.flat(g, mix(pal.asphalt[1], hz, fog), a0, a1, b0, b1, 0.02, 0.02, zA, zB);
        if (ks & 1) {
          cam.project(a0, 0.03, zA, A); cam.project((a0 + a1) / 2, 0.03, zA + 1.2, B); cam.project((b0 + b1) / 2, 0.03, zB, C); cam.project(a0, 0.03, zA + 1.8, D);
          quad(g, mix(pal.laneDash, hz, fog), A, B, C, D);
          cam.project(a1, 0.03, zA, A); cam.project(a1, 0.03, zA + 1.8, D);
          quad(g, mix(pal.laneDash, hz, fog), A, B, C, D);
        }
      } else {
        this.flat(g, mix(pal.median, hz, fog), a0, a1, b0, b1, 0.02, 0.02, zA, zB);
        this.flat(g, mix(dim(pal.median, 0.3), hz, fog), a0 + gap * 0.55, a1, b0 + gap * 0.55, b1, 0.02, 0.02, zA, zB, 0.35);
        if (detail) {
          this.flat(g, mix(pal.concrete, hz, fog), a0 + 0.7, a0 + 1.1, b0 + 0.7, b0 + 1.1, 0.03, 0.03, zA, zB);
          this.flat(g, mix(pal.concrete, hz, fog), a1 - 1.1, a1 - 0.7, b1 - 1.1, b1 - 0.7, 0.03, 0.03, zA, zB);
        }
      }
    }
  }

  private drawRibbon(sec: Section, r: number, zA: number, zB: number, ks: number, fog: number, riderS: number) {
    const { cam, pal, gBack, ctx } = this;
    const g = gBack;
    const xlA = sec.left(r, zA), xrA = sec.right(r, zA), xlB = sec.left(r, zB), xrB = sec.right(r, zB);
    const yA = sec.y(r, zA), yB = sec.y(r, zB);
    const hz = pal.haze;
    const risky = sec.ribbons[r].role === 'risky';
    const kind = sec.def.kind;
    const elevated = yA > 0.3 || yB > 0.3;

    if (elevated) {
      // shadow thrown on the ground, away from the sun
      const off = Math.min(yA * 0.55, 7);
      this.flat(g, SHADOW_INK, xlA - off, xrA - off, xlB - off, xrB - off, 0.03, 0.03, zA, zB, 0.3 * (1 - fog));
      const leftSide = cam.x < xlA, rightSide = cam.x > xrA;
      const solid = kind === 'split' || kind === 'merge' || kind === 'rampUp' || kind === 'rampDown';
      if (!solid && (ks & 7) === 0 && yA > 3) {
        // hammerhead pier
        const xm = (xlA + xrA) / 2;
        box(ctx, xm - 1, xm + 1, 0, yA - 2.1, zA, zA + 2, pal.concrete);
        box(ctx, xlA + 0.4, xrA - 0.4, yA - 2.1, yA - 1.2, zA - 0.2, zA + 2.2, pal.concrete);
      }
      if (leftSide || rightSide) {
        const xa = leftSide ? xlA : xrA, xb = leftSide ? xlB : xrB;
        const face = leftSide ? dim(pal.concrete, 0.42) : lit(pal.concrete, 0.08);
        const botA = solid ? 0 : Math.max(0, yA - 1.2), botB = solid ? 0 : Math.max(0, yB - 1.2);
        cam.project(xa, yA, zA, A); cam.project(xb, yB, zB, B); cam.project(xb, botB, zB, C); cam.project(xa, botA, zA, D);
        quad(g, mix(face, hz, fog), A, B, C, D);
        if (A.s > 4) {
          // coping band (amber on the shortcut), panel joint and ink
          cam.project(xa, yA - 0.32, zA, E); cam.project(xb, yB - 0.32, zB, F);
          quad(g, mix(risky ? 0xffb020 : lit(pal.concrete, 0.2), hz, fog), A, B, F, E);
          ls(g, clamp(A.s * 0.09, 1, 3.4), pal.outline, 1 - fog * 0.7);
          ln(g, A.x, A.y, B.x, B.y); ln(g, D.x, D.y, C.x, C.y);
          if ((ks & 1) === 0) { ls(g, clamp(A.s * 0.05, 1, 2), pal.outline, 0.35 * (1 - fog)); ln(g, A.x, A.y, D.x, D.y); }
        }
      }
    }

    // asphalt
    const tar = risky ? pal.asphaltRisky : pal.asphalt;
    cam.project(xlA, yA, zA, A); cam.project(xrA, yA, zA, B); cam.project(xrB, yB, zB, C); cam.project(xlB, yB, zB, D);
    quad(g, mix(tar[ks & 1], hz, fog), A, B, C, D);
    const px = A.s;
    const lanes = sec.ribbons[r].lanes.length;
    const yaa = yA + 0.02, ybb = yB + 0.02;
    const stripe = (x0A: number, x0B: number, w: number, col: number, alpha = 1) =>
      this.flat(g, mix(col, hz, fog), x0A, x0A + w, x0B, x0B + w, yaa, ybb, zA, zB, alpha);

    const joinedL = r > 0 && sec.joined(r, r - 1, zA) && sec.joined(r, r - 1, zB);
    const joinedR = r < sec.ribbons.length - 1 && sec.joined(r, r + 1, zA) && sec.joined(r, r + 1, zB);

    if (px > 9) {
      // long brush streaks, tyre wear and repairs give the tarmac a painted surface
      const run = Math.floor(ks / 5);
      for (let l = 0; l < lanes; l++) {
        const h = hash(run, l * 7 + r * 31 + 3);
        const o = l * LANE_W + 0.5 + ((h % 100) / 100) * (LANE_W - 1.2);
        if (h % 2) stripe(xlA + o, xlB + o, 0.2 + (h % 3) * 0.12, 0x7d7699, 0.14);
        else stripe(xlA + o, xlB + o, 0.34, 0x2a2540, 0.2);
      }
      const h = hash(ks, r + 11);
      if (h % 9 === 0) {
        const o = (h >> 3) % lanes * LANE_W + 0.5;
        stripe(xlA + o, xlB + o, 2.1, 0x2f2a45, 0.38); // patch repair
      } else if (h % 13 === 0 && px > 12) {
        // crack
        const o = ((h >> 3) % (lanes * 10)) / 10 * LANE_W;
        cam.project(xlA + o, yaa, zA + 0.2, E); cam.project(xlA + o + 0.5, yaa, zA + 1.2, F); cam.project(xlA + o - 0.2, yaa, zA + 2, G); cam.project(xlA + o + 0.4, yaa, zA + 2.9, H);
        ls(g, clamp(px * 0.05, 1, 2.2), pal.outline, 0.5); ln(g, E.x, E.y, F.x, F.y); ln(g, F.x, F.y, G.x, G.y); ln(g, G.x, G.y, H.x, H.y);
      } else if (h % 37 === 0) {
        const o = ((h >> 3) % lanes + 0.5) * LANE_W;
        cam.project(xlA + o, yaa, zA + 1.5, E);
        g.fillStyle(pal.outline, 0.75); oval(g, E.x, E.y, px * 1.3, px * 0.48, 14);
        g.fillStyle(0x5d5777, 1); oval(g, E.x, E.y, px * 1.05, px * 0.36, 14);
      }
    }

    if (px > 1.1) {
      // shoulders + edge lines
      if (!joinedL) { if (px > 5) stripe(xlA, xlB, 0.48, pal.shoulder); stripe(xlA + 0.48, xlB + 0.48, 0.3, risky ? 0xff5a2a : pal.edgeLine); }
      if (!joinedR) { if (px > 5) stripe(xrA - 0.48, xrB - 0.48, 0.48, pal.shoulder); stripe(xrA - 0.78, xrB - 0.78, 0.3, risky ? 0xff5a2a : pal.edgeLine); }
      const dashOn = (ks & 3) < 2;
      for (let l = 1; l < lanes; l++) {
        if (dashOn) stripe(xlA + l * LANE_W - 0.15, xlB + l * LANE_W - 0.15, 0.3, risky ? 0xffc35a : pal.laneDash);
        else if ((ks & 3) === 3 && px > 10) this.flat(g, mix(0xffb020, hz, fog), xlA + l * LANE_W - 0.1, xlA + l * LANE_W + 0.1, xlA + l * LANE_W - 0.1, xlA + l * LANE_W + 0.1, yaa, yaa, zA + 0.2, zA + 0.55);
      }
      if (joinedR && dashOn) stripe(xrA - 0.15, xrB - 0.15, 0.3, pal.laneDash);

      // painted lane arrows; the shortcut gets amber boost chevrons instead
      if (px > 4 && (risky ? ks % 8 === 2 : ks % 40 === 12 && kind !== 'split' && kind !== 'merge')) {
        const col = mix(risky ? 0xffb020 : pal.laneDash, hz, fog);
        for (let l = 0; l < lanes; l++) {
          const mA = xlA + (l + 0.5) * LANE_W, mB = xlB + (l + 0.5) * LANE_W, mM = (mA + mB) / 2;
          if (risky) {
            for (const dz of [0, 1.3]) {
              cam.project(mA - 0.9, yaa, zA + dz, E); cam.project(mM, yaa, zA + dz + 0.9, F); cam.project(mM, yaa, zA + dz + 1.5, G); cam.project(mA - 0.9, yaa, zA + dz + 0.6, H);
              quad(g, col, E, F, G, H, 0.9);
              cam.project(mA + 0.9, yaa, zA + dz, E); cam.project(mA + 0.9, yaa, zA + dz + 0.6, H);
              quad(g, col, E, F, G, H, 0.9);
            }
          } else {
            this.flat(g, col, mA - 0.16, mA + 0.16, mM - 0.16, mM + 0.16, yaa, yaa, zA, zA + 1.7, 0.85);
            cam.project(mM - 0.6, yaa, zA + 1.6, E); cam.project(mM + 0.6, yaa, zA + 1.6, F); cam.project(mB, ybb, zB, G);
            g.fillStyle(col, 0.85); g.fillTriangle(E.x, E.y, F.x, F.y, G.x, G.y);
          }
        }
      }
    }

    // barriers on every free edge (interior edges only once the gore is wide enough)
    const gb = zA < riderS - 1 ? this.gFront : gBack;
    const gapL = r > 0 ? xlA - sec.right(r - 1, zA) : 99;
    const gapR = r < sec.ribbons.length - 1 ? sec.left(r + 1, zA) - xrA : 99;
    const rails = yA > 1.5 || sec.def.ground === 'water';
    const hasL = !joinedL && gapL > 1.6, hasR = !joinedR && gapR > 1.6;
    if (hasR && px > 4) stripe(xrA - 1.9, xrB - 1.9, 1.9, SHADOW_INK, 0.26 * (1 - fog)); // right barrier shades the road
    if (hasL && px > 4 && yA < 0.5) this.flat(g, SHADOW_INK, xlA - 1.9, xlA - 0.6, xlB - 1.9, xlB - 0.6, 0.03, 0.03, zA, zB, 0.24 * (1 - fog));
    if (hasL) this.barrier(gb, xlA, xlB, yA, yB, zA, zB, -1, ks, fog, risky, rails);
    if (hasR) this.barrier(gb, xrA, xrB, yA, yB, zA, zB, 1, ks, fog, risky, rails);
  }

  /** Chevron-striped jersey barrier with concrete posts, reflectors and (on bridges) steel rails. */
  private barrier(g: Gfx, xA: number, xB: number, yA: number, yB: number, zA: number, zB: number, out: -1 | 1, ks: number, fog: number, risky: boolean, rails: boolean) {
    const { cam, pal } = this;
    const hz = pal.haze;
    const post = (ks & 3) === 0;
    const cA = risky ? 0xe53127 : pal.barrierA, cB = risky ? 0xf4f1fa : pal.barrierB;
    const tone = (c: number) => mix(out < 0 ? lit(c, 0.06) : dim(c, 0.3), hz, fog); // left barrier faces the sun
    const inn = -out * 0.24, h = post ? 1.5 : 1.08, t = 0.62 * out;

    // base lip (near only; far barriers are a single face)
    cam.project(xA, yA + 0.3, zA, E); cam.project(xB, yB + 0.3, zB, F);
    const detailed = E.s > 5;
    if (detailed) {
      cam.project(xA + inn, yA + 0.3, zA, A); cam.project(xB + inn, yB + 0.3, zB, B); cam.project(xB + inn, yB, zB, C); cam.project(xA + inn, yA, zA, D);
      quad(g, tone(dim(pal.concrete, 0.25)), A, B, C, D);
      quad(g, tone(pal.concrete), A, B, F, E);
    } else { cam.project(xA, yA, zA, E); cam.project(xB, yB, zB, F); cam.project(xA, yA, zA, D); cam.project(xB, yB, zB, C); }
    if (E.s > 12) { ls(g, clamp(E.s * 0.08, 1, 3), pal.outline, 1 - fog * 0.7); ln(g, D.x, D.y, C.x, C.y); }

    // body: A,B = top near/far, E,F = bottom near/far
    cam.project(xA, yA + h, zA, A); cam.project(xB, yB + h, zB, B);
    quad(g, tone(post ? pal.concrete : cB), A, B, F, E);
    const at = (u: number, v: number, o: Pt) => {
      const tx = A.x + (B.x - A.x) * u, ty = A.y + (B.y - A.y) * u, bx = E.x + (F.x - E.x) * u, by = E.y + (F.y - E.y) * u;
      o.x = tx + (bx - tx) * v; o.y = ty + (by - ty) * v; return o;
    };
    if (detailed) {
      if (post) {
        at(0.25, 0.3, C); at(0.75, 0.3, D); at(0.75, 0.62, G); at(0.25, 0.62, H);
        quad(g, mix(0xff8a2a, hz, fog), C, D, G, H);
      } else {
        // diagonal chevron blocks, mirrored left/right so they point down the road
        const sl = 0.2 * -out;
        for (const u0 of [0.2, 0.7]) {
          at(u0 - 0.13, 1, C); at(u0 + 0.13, 1, D); at(u0 + 0.13 + sl, 0, G); at(u0 - 0.13 + sl, 0, H);
          quad(g, tone(cA), C, D, G, H);
        }
      }
    }
    // top cap
    cam.project(xA + t, yA + h, zA, C); cam.project(xB + t, yB + h, zB, D);
    quad(g, mix(lit(post ? pal.concrete : cB === pal.barrierB ? 0x4a4460 : cB, 0.25), hz, fog), A, B, D, C);
    if (post) {
      cam.project(xA + t, yA, zA, G);
      quad(g, mix(dim(pal.concrete, 0.3), hz, fog), A, C, G, E);
    }
    if (detailed) {
      ls(g, clamp(A.s * 0.09, 1, 3.4), pal.outline, 1 - fog * 0.7);
      ln(g, A.x, A.y, B.x, B.y); if (A.s > 12) ln(g, C.x, C.y, D.x, D.y);
      if (post && A.s > 8) { ln(g, A.x, A.y, E.x, E.y); ln(g, A.x, A.y, C.x, C.y); at(1, 0, H); at(1, 1, G); ln(g, H.x, H.y, G.x, G.y); }
    }
    if (rails && A.s > 3.5) {
      const steel = mix(0x8f8aa8, hz, fog);
      for (const ry of A.s > 9 ? [1.62, 2.05] : [2.05]) {
        cam.project(xA + t / 2, yA + ry, zA, G); cam.project(xB + t / 2, yB + ry, zB, H);
        if (G.s > 9) { ls(g, clamp(G.s * 0.16, 1.2, 5) + 2, pal.outline, 1 - fog * 0.7); ln(g, G.x, G.y, H.x, H.y); }
        ls(g, clamp(G.s * 0.16, 1.2, 5), steel, 1); ln(g, G.x, G.y, H.x, H.y);
      }
      if (post) {
        cam.project(xA + t / 2, yA + 1.4, zA + 0.3, G); cam.project(xA + t / 2, yA + 2.15, zA + 0.3, H);
        ls(g, clamp(G.s * 0.2, 1.4, 6), steel, 1); ln(g, G.x, G.y, H.x, H.y);
      }
    }
  }

  private drawPickups(sim: Sim, time: number) {
    const { cam, gBack } = this;
    let used = 0;
    const zMax = cam.z + this.sliceCount * SLICE * 0.8;
    for (const sec of sim.route.sections) {
      if (sec.s1 < cam.z || sec.s0 > zMax) continue;
      for (const e of sec.entities) {
        if (e.taken || !isPickup(e.kind) || e.s < cam.z + 2 || e.s > zMax) continue;
        const x = sec.laneX(e.lane, e.s), y = sec.laneY(e.lane, e.s);
        cam.project(x, y, e.s, A);
        if (A.y < cam.horizonY || A.y > cam.h + 80) continue;
        gBack.fillStyle(SHADOW_INK, 0.36);
        oval(gBack, A.x - A.s * 0.25, A.y, A.s * 1.35, A.s * 0.44, 8);
        const bob = 0.75 + e.h + Math.sin(time * 4 + e.s * 0.6) * 0.12;
        cam.project(x, y + bob, e.s, B);
        let img = this.pickups[used];
        if (!img) { img = this.scene.add.image(0, 0, 'coin'); this.pickups.push(img); }
        used++;
        const tex = PICKUP_TEX[e.kind];
        if (img.texture.key !== tex) img.setTexture(tex);
        const size = (PICKUP_SIZE[e.kind] * B.s) / img.width;
        const spin = e.kind === 'coin' ? 0.35 + 0.65 * Math.abs(Math.cos(time * 3.2 + e.s * 0.35)) : 1 + Math.sin(time * 6 + e.s) * 0.06;
        img.setVisible(true).setPosition(B.x, B.y).setScale(size * spin, size).setDepth(e.s < sim.s ? 25 : 15);
        img.setAlpha(clamp((zMax - e.s) / 40, 0, 1));
      }
    }
    for (let i = used; i < this.pickups.length; i++) this.pickups[i].setVisible(false);
  }

  private drawSigns() {
    let used = 0;
    for (const r of this.ctx.signs) {
      if (r.w < 6 || r.h < 3 || r.x > this.cam.w || r.x + r.w < 0) continue;
      let img = this.signs[used];
      if (!img) { img = this.scene.add.image(0, 0, r.key).setOrigin(0, 0).setDepth(12); this.signs.push(img); }
      used++;
      if (img.texture.key !== r.key) img.setTexture(r.key);
      img.setVisible(true).setPosition(r.x, r.y).setDisplaySize(r.w, r.h);
    }
    for (let i = used; i < this.signs.length; i++) this.signs[i].setVisible(false);
  }

  /** Debug/inspection: pin the rider animation to a named state (see ?anim=). */
  forceAnim(name: string, sim: Sim) {
    const states: Record<string, ForcedAnim> = {
      neutral: { lateral: 0, drift: 0 }, leanL: { lateral: -1, drift: 0 }, leanR: { lateral: 1, drift: 0 },
      driftL: { lateral: 0, drift: -1 }, driftR: { lateral: 0, drift: 1 },
    };
    this.animator.force = states[name] ?? null;
    this.animator.settle(sim);
  }

  /** New run: clear lingering effects and animation state; dress the rig for the character. */
  reset(character: CharacterId = 'mach') {
    this.fx = new RiderFx();
    this.animator = new RiderAnimator();
    // temporary: Brute rides the shared rig in his blue livery, a little bigger
    this.riderSprite.setLivery(LIVERIES[character]);
    this.riderSize = RIDER_SCALE * (character === 'brute' ? 1.1 : character === 'lynn' ? 0.95 : 1);
  }

  /** Repellent: temporary green pulse around Lynn. */
  onRepel(sim: Sim) {
    this.fx.ring(sim.x, sim.groundY + 0.1, sim.s, sim.speed, 3.4, REPEL_GREEN, 0.5, 0.3);
    this.fx.ring(sim.x, sim.groundY + 0.1, sim.s, sim.speed, 2, 0xffffff, 0.35, 0.18);
  }

  /**
   * The Mutant Spill: a low violet mass sprawled over every lane but the passage, studded
   * with lime pustules, with tentacles that writhe, reach toward an approaching rider,
   * recoil from Lynn's Repellent, and close on anyone they seize. Temporary art.
   */
  private drawSpill(sec: Section, h: Hazard, fog: number, sim: Sim, time: number) {
    const { cam, pal } = this;
    const g = sim.s > h.z1 + 0.5 ? this.gFront : this.gBack; // a rider inside rides over it
    const hz = pal.haze, len = h.z1 - h.z0;
    const BODY = 0x5b1f72, BODY_LIT = 0x8a37a8, TENT = 0x7a2c96, LIME = 0xb6ff3a;
    const col = (c: number) => mix(c, hz, fog);
    const near = sim.s > h.z0 - 45 && sim.s < h.z1 + 2; // the organism has noticed the rider
    const grab = sim.grabbed || (!sim.alive && sim.grabT > 0) ? clamp(sim.grabT / MUTANT.grabTime, 0, 1) : 0;
    const lanes = [0, 1, 2, 3, 4].filter((l) => l !== h.safeLane);
    lanes.sort((a, b) => Math.abs(sec.laneX(b, h.z0) - cam.x) - Math.abs(sec.laneX(a, h.z0) - cam.x)); // outermost first
    for (const l of lanes) {
      const zc = h.z0 + len / 2, x = sec.laneX(l, zc), y = sec.laneY(l, zc);
      // recoil: the mass draws back from wherever Lynn is (and only while her Repellent holds)
      const recoil = sim.repelActive ? clamp(1.25 - Math.abs(x - sim.x) / (LANE_W * 1.4), 0, 1) : 0;
      const shrink = 1 - recoil * 0.75;
      // body: overlapping inked mounds, far to near
      for (let k = 3; k >= 0; k--) {
        const z = h.z0 + ((k + 0.5) * len) / 4, pulse = 1 + Math.sin(time * 3.1 + l * 1.7 + k) * 0.06;
        cam.project(x + Math.sin(l * 3 + k * 2) * 0.35, y + 0.28 * shrink, z, A);
        const w = LANE_W * 0.66 * pulse * (0.55 + shrink * 0.45) * A.s, ht = 0.95 * pulse * shrink * A.s + A.s * 0.12;
        g.fillStyle(pal.outline, 1 - fog * 0.6); oval(g, A.x, A.y, w * 2 + A.s * 0.16, ht * 2 + A.s * 0.16, 14);
        g.fillStyle(col(BODY), 1); oval(g, A.x, A.y, w * 2, ht * 2, 14);
        g.fillStyle(col(BODY_LIT), 1); oval(g, A.x + w * 0.25, A.y - ht * 0.35, w * 0.9, ht * 0.8, 10);
        if (A.s > 6) for (let p = 0; p < 3; p++) {
          const px = A.x + Math.sin(l * 5 + k * 3 + p * 2.1) * w * 0.6, py = A.y + Math.cos(p * 1.9 + k) * ht * 0.35;
          const pr = A.s * (0.12 + 0.05 * Math.sin(time * 5 + p + k));
          g.fillStyle(col(LIME), 0.95); oval(g, px, py, pr * 2, pr * 1.6, 8);
        }
      }
      // tentacles
      for (let t = 0; t < 2; t++) {
        const phase = l * 2.3 + t * 3.1, side = t ? 1 : -1;
        const bx = x + side * 0.7, bz = h.z0 + 1.2 + t * 3.5, by = y + 0.5 * shrink;
        let reach = 2.8 * shrink, tx = bx + Math.sin(time * 2.2 + phase) * 0.8, tz = bz - 0.6, ty = by + reach;
        if (near && !sim.repelActive) { // lean toward the rider, tips reaching for the bike
          const k = clamp(1 - (h.z0 - sim.s) / 45, 0, 1);
          tx += clamp(sim.x - bx, -2.6, 2.6) * 0.55 * k; tz -= 2.5 * k; ty += 0.5 * k;
        }
        if (sim.repelActive) { tx += Math.sign(bx - sim.x || side) * 1.6 * recoil; ty = by + reach * 0.6; } // flinch away
        if (grab > 0 && Math.abs(bx - sim.x) < LANE_W * 2.2) { // close around the seized rider
          tx += (sim.x - tx) * grab; tz += (sim.s - tz) * grab; ty += (sim.groundY + sim.jumpY + 0.9 - ty) * grab;
        }
        const N = 7, pts: { x: number; y: number; w: number }[] = [];
        for (let i = 0; i <= N; i++) {
          const u = i / N, wig = Math.sin(time * 4.2 + phase + u * 3.4) * 0.45 * u;
          cam.project(bx + (tx - bx) * u + wig, by + (ty - by) * Math.sin(u * Math.PI * 0.5), bz + (tz - bz) * u, B);
          pts.push({ x: B.x, y: B.y, w: Math.max(1.2, B.s * (0.34 - u * 0.26)) });
        }
        for (let i = 1; i <= N; i++) { ls(g, pts[i].w * 2 + Math.max(1.5, B.s * 0.08), pal.outline, 1 - fog * 0.6); ln(g, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y); }
        for (let i = 1; i <= N; i++) { ls(g, pts[i].w * 2, col(i > N - 2 ? LIME : TENT), 1); ln(g, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y); }
      }
    }
  }

  /** Smash: temporary impact feedback where the pillars stood. */
  onSmash(sim: Sim, z: number, lanes: number[]) {
    for (const l of lanes) {
      const x = sim.sec.laneX(l, z), y = sim.sec.laneY(l, z);
      this.fx.burst(x, y + 1.5, z, sim.speed * 0.3, 2);
      this.fx.ring(x, y + 0.1, z, sim.speed * 0.3, 3.5, 0x2f86f0, 0.45, 0.3);
    }
  }

  /** Massive concrete pillars in every lane but the passage — or their rubble once smashed. */
  private drawPillars(sec: Section, h: Hazard, fog: number) {
    const { ctx, cam } = this;
    ctx.fog = fog;
    const lanes = [0, 1, 2, 3, 4].filter((l) => l !== h.safeLane);
    lanes.sort((a, b) => Math.abs(sec.laneX(b, h.z0) - cam.x) - Math.abs(sec.laneX(a, h.z0) - cam.x)); // outermost first
    const z0 = h.z0, z1 = h.z1, hw = LANE_W / 2 - 0.12;
    for (const l of lanes) {
      const x = sec.laneX(l, z0), y = sec.laneY(l, z0);
      if (h.cleared) {
        // rubble: low broken chunks, no longer solid
        for (let i = 0; i < 3; i++) {
          const ox = ((l * 7 + i * 5) % 5 - 2) * 0.5, oz = i * 1.4, s = 0.35 + ((l + i) % 3) * 0.2;
          box(ctx, x + ox - s, x + ox + s, y, y + s * 1.2, z0 + oz - s, z0 + oz + s, 0x9d98b6);
        }
        continue;
      }
      this.flat(ctx.g, SHADOW_INK, x - hw - 3.5, x + hw - 3.5, x - hw - 3.5, x + hw - 3.5, y + 0.02, y + 0.02, z0, z1 + 1.2, 0.32 * (1 - fog)); // cast shadow
      box(ctx, x - hw - 0.25, x + hw + 0.25, y, y + 0.7, z0 - 0.25, z1 + 0.25, 0x8d88a6); // footing
      box(ctx, x - hw, x + hw, y + 0.7, y + PILLARS.height, z0, z1, 0xbdb8ce); // shaft
      box(ctx, x - hw - 0.06, x + hw + 0.06, y + 2.2, y + 3.4, z0 - 0.06, z1 + 0.06, 0x2f86f0); // Brute-blue warning band
      box(ctx, x - hw - 0.06, x + hw + 0.06, y + 3.4, y + 3.8, z0 - 0.06, z1 + 0.06, 0xf4f1fa);
      box(ctx, x - hw - 0.3, x + hw + 0.3, y + PILLARS.height, y + PILLARS.height + 0.7, z0 - 0.3, z1 + 0.3, 0xa7a2bd); // cap
    }
  }

  /** A flight began in the simulation: temporary launch feedback. */
  onJump(kind: JumpKind, sim: Sim) {
    this.animator.onJump(kind === 'ramp' ? 'normal' : kind);
    const x = sim.x, y = sim.groundY, z = sim.s;
    if (kind === 'surge') {
      this.fx.ring(x, y + 0.05, z, sim.speed, 5.5, ENERGY, 0.5, 0.3);
      this.fx.ring(x, y + 0.05, z, sim.speed, 3.2, 0xffffff, 0.35, 0.18);
      this.fx.burst(x, y, z, sim.speed, 1.6);
    } else if (kind === 'air') this.fx.ring(x, y + sim.jumpY, z, sim.speed, 2.8, ENERGY, 0.34, 0.2);
    else this.fx.burst(x, y, z, sim.speed, 0.35);
  }

  /** The bike touched down. */
  onLand(impact: number, kind: JumpKind, sim: Sim) {
    this.animator.onLand(impact);
    this.fx.burst(sim.x, sim.groundY, sim.s, sim.speed, clamp(impact / 9, 0.5, 2));
    if (kind === 'surge') this.fx.ring(sim.x, sim.groundY + 0.05, sim.s, sim.speed, 4.5, 0xf3e8d4, 0.4, 0.22);
  }

  /** The Chasm: floor, strata walls and the cut face of the road beyond. */
  private drawPit(sec: Section, h: Hazard, zA: number, zB: number, fog: number) {
    const { cam, pal, gBack: g } = this;
    const hz = pal.haze, depth = CHASM.depth, y = sec.y(0, zA);
    const lA = sec.left(0, zA) - TRENCH, rA = sec.right(0, zA) + TRENCH, lB = sec.left(0, zB) - TRENCH, rB = sec.right(0, zB) + TRENCH;
    const strata: [number, number, number][] = [[0, -0.8, 0xa49dc4], [-0.8, -4.5, 0xa8623a], [-4.5, -9.5, 0x71402e], [-9.5, -depth, 0x3d2433]];
    if (zB >= h.z1 - 0.01) {
      // far wall: the broken end of the road beyond, facing the rider
      for (const [t, b, col] of strata) {
        cam.project(lB, y + t, zB, A); cam.project(rB, y + t, zB, B); cam.project(rB, y + b, zB, C); cam.project(lB, y + b, zB, D);
        quad(g, mix(col, hz, fog), A, B, C, D);
      }
      cam.project(sec.left(0, zB), y, zB, A); cam.project(sec.right(0, zB), y, zB, B); cam.project(sec.right(0, zB), y - 0.55, zB, C); cam.project(sec.left(0, zB), y - 0.55, zB, D);
      quad(g, mix(dim(pal.asphalt[1], 0.35), hz, fog), A, B, C, D);
      ls(g, clamp(A.s * 0.1, 1.5, 4), pal.outline, 1 - fog * 0.6); ln(g, A.x, A.y, B.x, B.y);
    }
    this.flat(g, mix(0x1a1230, hz, fog * 0.4), lA, rA, lB, rB, y - depth, y - depth, zA, zB);
    for (const [xa, xb, shade] of [[lA, lB, 0.1], [rA, rB, 0.4]]) {
      for (const [t, b, col] of strata) {
        cam.project(xa, y + t, zA, A); cam.project(xb, y + t, zB, B); cam.project(xb, y + b, zB, C); cam.project(xa, y + b, zA, D);
        quad(g, mix(dim(col, shade), hz, fog), A, B, C, D);
      }
    }
  }

  /** Approach paint for any lethal hazard: amber chevrons into the safe lane, red hatching on the others. */
  private drawApproach(sec: Section, h: Hazard, zA: number, zB: number, ks: number, fog: number, chevronGap: number) {
    const { cam, pal, gBack: g } = this;
    const hz = pal.haze, y = sec.y(0, zA) + 0.03, lane = h.safeLane;
    const xl = sec.left(0, zA);
    if (zB <= h.z0 && zA >= h.z0 - 96) {
      const cx = sec.laneX(lane, zA + 1.5);
      if ((ks & 1) && zB <= h.z0 - chevronGap) {
        // amber chevrons funnel the rider into the safe lane
        cam.project(cx - 1.0, y, zA, A); cam.project(cx, y, zA + 1.1, B); cam.project(cx, y, zA + 2, C); cam.project(cx - 1.0, y, zA + 0.9, D);
        quad(g, mix(0xffb020, hz, fog), A, B, C, D, 0.92);
        cam.project(cx + 1.0, y, zA, A); cam.project(cx + 1.0, y, zA + 0.9, D);
        quad(g, mix(0xffb020, hz, fog), A, B, C, D, 0.92);
      }
      if (zA >= h.z0 - 27 && (ks & 1)) {
        // red hatching: every other lane ends at the edge
        for (let l = 0; l < 5; l++) if (l !== lane) this.flat(g, mix(0xff3b2e, hz, fog), xl + l * LANE_W + 0.5, xl + (l + 1) * LANE_W - 0.5, xl + l * LANE_W + 0.5, xl + (l + 1) * LANE_W - 0.5, y, y, zA + 0.4, zA + 1.6, 0.6);
      }
      if (h.kind === 'chasm' && zB >= h.z0 - 0.01) this.flat(g, mix(0xffd23f, hz, fog), xl, sec.right(0, zA), xl, sec.right(0, zA), y, y, h.z0 - 0.9, h.z0); // lip line
    }
  }

  /** Chasm: approach paint, the functional launch ramp in the safe lane, and the receiving ramp beyond. */
  private drawChasmDecor(sec: Section, h: Hazard, zA: number, zB: number, ks: number, fog: number) {
    const { cam, pal, gBack: g } = this;
    const hz = pal.haze, y = sec.y(0, zA) + 0.03, lane = h.safeLane;
    const RL = CHASM.rampLength, RH = CHASM.rampHeight, LL = 9, LH = 1.5;
    this.drawApproach(sec, h, zA, zB, ks, fog, RL);

    const wedge = (la: number, lb: number) => {
      const x0A = sec.laneX(lane, zA) - LANE_W / 2 + 0.22, x1A = x0A + LANE_W - 0.44, x0B = sec.laneX(lane, zB) - LANE_W / 2 + 0.22, x1B = x0B + LANE_W - 0.44;
      const steel = mix(0x6d6888, hz, fog);
      if (la > 0.05) { // riser facing the camera
        cam.project(x0A, y, zA, A); cam.project(x1A, y, zA, B); cam.project(x1A, y + la, zA, C); cam.project(x0A, y + la, zA, D);
        quad(g, mix(0x4a4563, hz, fog), A, B, C, D);
      }
      for (const [xa, xb, vis] of [[x0A, x0B, cam.x < x0A], [x1A, x1B, cam.x > x1A]] as [number, number, boolean][]) {
        if (!vis) continue;
        cam.project(xa, y, zA, A); cam.project(xa, y + la, zA, B); cam.project(xb, y + lb, zB, C); cam.project(xb, y, zB, D);
        quad(g, steel, A, B, C, D);
      }
      cam.project(x0A, y + la, zA, A); cam.project(x1A, y + la, zA, B); cam.project(x1B, y + lb, zB, C); cam.project(x0B, y + lb, zB, D);
      quad(g, mix((ks & 1) ? 0xffb020 : 0x2b2539, hz, fog), A, B, C, D);
      ls(g, clamp(A.s * 0.09, 1.2, 3.5), pal.outline, 1 - fog * 0.6);
      ln(g, A.x, A.y, D.x, D.y); ln(g, B.x, B.y, C.x, C.y);
    };
    const up = (z: number) => RH * smooth(clamp((z - (h.z0 - RL)) / RL, 0, 1));
    const down = (z: number) => LH * (1 - clamp((z - h.z1) / LL, 0, 1));
    if (zB > h.z0 - RL && zA < h.z0) wedge(up(zA), up(zB));
    if (zA < h.z1 + LL && zB > h.z1) wedge(down(zA), down(zB));
  }

  private drawRider(sim: Sim, dt: number, time: number) {
    const { cam, gBack, gFront, rider, animator } = this;
    const x = sim.x, gy = sim.groundY, live = sim.alive, falling = sim.falling;
    cam.project(x, gy, sim.s, A);
    const s = A.s, air = clamp(sim.jumpY / 4, 0, 1);
    const riding = live && !falling && !sim.grabbed;

    // speed streaks rushing past on the tarmac
    if (riding && !sim.attract) {
      for (let i = 0; i < 6; i++) {
        const lx = x + (i % 2 ? 1 : -1) * (1.5 + (i >> 1) * 1.15);
        const z = sim.s + 16 - ((time * sim.speed * 1.4 + i * 9.7) % 26);
        cam.project(lx, gy + 0.03, z, C); cam.project(lx, gy + 0.03, z + 3.2, D);
        ls(gBack, Math.max(1.5, C.s * 0.07), 0xffffff, 0.12); ln(gBack, C.x, C.y, D.x, D.y);
      }
    }

    // --- animation: gameplay state -> rig view and pose ---
    animator.update(sim, dt);
    const v = animator.view;
    this.riderSprite.render(v);
    const scale = (this.riderSize * s) / RiderSprite.PPM;
    const lean = v.roll, boost = animator.boost;
    const cyw = Math.cos(v.yaw), syw = Math.sin(v.yaw);

    // --- tyre contact effects, anchored where the rear tyre meets the road ---
    const rearX = x + REAR_CONTACT[2] * syw * this.riderSize, rearS = sim.s + REAR_CONTACT[2] * cyw * this.riderSize;
    const sliding = (riding || animator.force) && !sim.airborne ? animator.drift : 0;
    this.fx.update(dt, sim.speed, sliding, animator.driftDir, rearX, gy, rearS, cam.z);
    this.fx.drawMarks(gBack, cam);

    if (!sim.overGap && !falling) {
      // grounded shadow: thrown to the left, sliding with the lean, shrinking with height
      gBack.fillStyle(SHADOW_INK, 0.3 - air * 0.14);
      oval(gBack, A.x - s * 0.55 + lean * s * 1.1, A.y - s * 0.05, s * (2.7 - air * 1.1 + Math.abs(lean) * 1.3), s * (1.3 - air * 0.55), 14);
      gBack.fillStyle(SHADOW_INK, 0.42 - air * 0.22);
      oval(gBack, A.x - s * 0.2 + lean * s * 0.55, A.y - s * 0.12, s * (1.5 - air * 0.7 + Math.abs(lean) * 0.7), s * (0.8 - air * 0.4), 14);
      if (!sim.airborne) {
        // dark contact patches pin both tyres to the tarmac
        gBack.fillStyle(SHADOW_INK, 0.55);
        for (const c of [REAR_CONTACT, FRONT_CONTACT]) {
          const a = this.riderSprite.anchor(c);
          oval(gBack, A.x + a.x * scale, A.y + a.y * scale, s * 0.62, s * 0.2, 8);
        }
      }
      if (live && !sim.attract && sim.repelActive) {
        // Lynn's Repellent: a thick pulsing green field around the bike while it holds
        const k = 1 + Math.sin(time * 10) * 0.08;
        ls(gBack, Math.max(3, s * 0.16), REPEL_GREEN, 0.85); ring(gBack, A.x, A.y - s * 0.15, s * 3.3 * k, s * 1.65 * k, 14);
        ls(gBack, Math.max(2, s * 0.07), 0xeafff0, 0.9); ring(gBack, A.x, A.y - s * 0.15, s * 2.5 * k, s * 1.25 * k, 14);
      } else if (live && !sim.attract) {
        ls(gBack, Math.max(2, s * 0.07), 0x38e1ff, 0.5 - air * 0.3);
        ring(gBack, A.x, A.y - s * 0.15, s * 2.7, s * 1.35, 14);
      }
    }

    cam.project(x, gy + sim.jumpY, sim.s, B);

    // --- energy: Surge trails and shock rings under the bike ---
    const world = (tip: readonly number[]): [number, number, number] =>
      [x + (tip[0] * cyw + tip[2] * syw) * this.riderSize, gy + sim.jumpY + tip[1] * this.riderSize, sim.s + (-tip[0] * syw + tip[2] * cyw) * this.riderSize];
    this.fx.trail(riding && sim.jumpKind === 'surge' && boost > 0.25, world(EXHAUST_TIPS[0]), world(EXHAUST_TIPS[1]));
    this.fx.drawEnergy(gBack, cam);

    if (riding) {
      // twin exhaust flames, anchored to the rig's exhaust outlets; they roar on Air Jump and Surge
      const fl = (0.42 + Math.sin(time * 47) * 0.07 + Math.sin(time * 31) * 0.05 + sim.speed * 0.004) * (1 + boost * 2.6);
      const fw = s * 0.15 * (1 + boost * 0.9);
      for (const tip of EXHAUST_TIPS) {
        const a = this.riderSprite.anchor(tip), b = this.riderSprite.anchor([tip[0] * 1.05, tip[1] - 0.06, tip[2] - fl]);
        const ax = B.x + a.x * scale, ay = B.y + a.y * scale, bx = B.x + b.x * scale, by = B.y + b.y * scale;
        if (boost > 0.15) { gBack.fillStyle(ENERGY, 0.35 * boost); gBack.fillTriangle(ax - fw * 2, ay, ax + fw * 2, ay, bx, by + fw); }
        gBack.fillStyle(0x2fb8ff, 0.85); gBack.fillTriangle(ax - fw, ay, ax + fw, ay, bx, by);
        gBack.fillStyle(0xe8fbff, 0.95); gBack.fillTriangle(ax - fw * 0.4, ay, ax + fw * 0.4, ay, (ax + bx) / 2, (ay + by) / 2);
      }
    }
    // aura: Surge energy, or Lynn's green Repellent field while it is shielding her
    const repel = sim.repelActive && live ? 0.8 + Math.sin(time * 9) * 0.2 : 0;
    const glow = Math.max(boost, repel);
    this.aura.setTint(repel > boost ? REPEL_GREEN : ENERGY).setVisible(glow > 0.05).setPosition(B.x, B.y - s * 1.3).setDisplaySize(s * 8 * (0.6 + glow * 0.6), s * 8 * (0.6 + glow * 0.6)).setAlpha(glow * 0.6);

    // dust boils up over the rear tyre, in front of the bike from the camera's side
    this.fx.drawDust(gFront, cam);

    // engine vibration as a sub-pixel shiver, stronger while the tyre is sliding
    const buzz = riding ? Math.sin(time * 61) * s * (0.01 + animator.drift * 0.014) : 0;
    rider.setPosition(B.x + (riding ? Math.sin(time * 43) * s * animator.drift * 0.012 : 0), B.y + buzz);
    if (sim.grabbed || (!live && sim.grabT > 0)) {
      // temporary grab presentation: thrashing, dragged down into the mass
      const t = clamp(sim.grabT / MUTANT.grabTime, 0, 1);
      rider.setScale(scale * (1 - t * 0.35)).setRotation(Math.sin(time * 28) * 0.18 * (1 - t) + t * 0.6).setAlpha(live ? 1 - t * 0.6 : 0.3);
      return;
    }
    if (falling || (!live && sim.fallT > 0)) {
      // temporary falling presentation: the bike tumbles, shrinks and fades into the Chasm
      const t = clamp(sim.fallT / CHASM.fallTime, 0, 1);
      rider.setScale(scale * (1 - t * 0.5)).setRotation(t * 2.4).setAlpha(live ? 1 - t * t : 0);
      return;
    }
    rider.setScale(scale);
    // TODO(stage D): proper crash animation; for now the wrecked bike simply tips over
    rider.setRotation(live ? 0 : 1.2);
    const blink = sim.invuln > 0 && live && Math.floor(time * 14) % 2 === 0;
    rider.setAlpha(blink ? 0.35 : 1);
  }
}
