import { LANE_W, LANES, SLICE, TUNING, clamp, smooth } from '../core/config';
import { CHASM, HAZARD_POOL, MUTANT, PILLARS, type Hazard, type HazardKind } from './hazards';
import { Rng } from '../core/rng';
import { CONNECTORS, SECTION_DEFS, START_SECTION, type ConnId, type Level, type Role, type SectionDef } from './sections';
import { populate, type Entity } from './populate';
import { ENVIRONMENTS, type EnvId, type Prop } from './environment';

/** Integral of smoothstep, used to integrate heading into lateral position. */
const smoothInt = (u: number) => u * u * u - (u * u * u * u) / 2;

export interface Ribbon {
  lanes: number[];
  off0: number;
  off1: number;
  el0: number;
  el1: number;
  role: Role;
}

/**
 * A placed road section. All geometry is expressed in one world space:
 * z = distance along the route, x = lateral position, y = elevation.
 */
export class Section {
  readonly s1: number;
  readonly ribbons: Ribbon[] = [];
  readonly laneRibbon: number[] = [];
  entities: Entity[] = [];
  props: Prop[] = [];
  /** Lethal hazards placed in this section. */
  hazards: Hazard[] = [];

  constructor(
    readonly index: number,
    readonly def: SectionDef,
    readonly env: EnvId,
    readonly s0: number,
    readonly h0: number,
    readonly x0: number,
    readonly y0: number,
  ) {
    this.s1 = s0 + def.length;
    const from = CONNECTORS[def.from];
    const to = CONNECTORS[def.to];
    const fine = to.length > from.length ? to : from;
    const find = (layout: typeof from, lane: number) => layout.find((r) => r.lanes.includes(lane))!;
    fine.forEach((r, i) => {
      const a = find(from, r.lanes[0]);
      const b = find(to, r.lanes[0]);
      this.ribbons.push({ lanes: r.lanes, off0: a.offset, off1: b.offset, el0: a.elev, el1: b.elev, role: r.role });
      for (const l of r.lanes) this.laneRibbon[l] = i;
    });
  }

  get length() { return this.def.length; }
  get endHeading() { return this.h0 + this.def.turn; }
  get endX() { return this.x0 + this.def.length * (this.h0 + this.def.turn / 2); }
  get endY() { return this.y0 + this.def.rise; }

  u(s: number) { return clamp((s - this.s0) / this.def.length, 0, 1); }
  centerX(s: number) {
    const u = this.u(s);
    return this.x0 + this.def.length * (this.h0 * u + this.def.turn * smoothInt(u));
  }
  centerY(s: number) { return this.y0 + this.def.rise * smooth(this.u(s)); }
  heading(s: number) { return this.h0 + this.def.turn * smooth(this.u(s)); }

  rOff(r: number, s: number) { const rb = this.ribbons[r]; return rb.off0 + (rb.off1 - rb.off0) * smooth(this.u(s)); }
  rElev(r: number, s: number) { const rb = this.ribbons[r]; return rb.el0 + (rb.el1 - rb.el0) * smooth(this.u(s)); }
  left(r: number, s: number) { return this.centerX(s) + this.rOff(r, s) + (this.ribbons[r].lanes[0] - 2 - 0.5) * LANE_W; }
  right(r: number, s: number) { const l = this.ribbons[r].lanes; return this.centerX(s) + this.rOff(r, s) + (l[l.length - 1] - 2 + 0.5) * LANE_W; }
  y(r: number, s: number) { return this.centerY(s) + this.rElev(r, s); }

  laneX(lane: number, s: number) { return this.centerX(s) + this.rOff(this.laneRibbon[lane], s) + (lane - 2) * LANE_W; }
  laneY(lane: number, s: number) { return this.y(this.laneRibbon[lane], s); }

  /** True when two ribbons are physically one surface at s (lane changes allowed between them). */
  joined(a: number, b: number, s: number) {
    if (a === b) return true;
    return Math.abs(this.rOff(a, s) - this.rOff(b, s)) < 0.4 && Math.abs(this.rElev(a, s) - this.rElev(b, s)) < 0.3;
  }
  canCross(laneA: number, laneB: number, s: number) {
    if (laneB < 0 || laneB >= LANES) return false;
    return this.joined(this.laneRibbon[laneA], this.laneRibbon[laneB], s);
  }
  /** Outermost road edges at s. */
  extents(s: number): [number, number] {
    return [this.left(0, s), this.right(this.ribbons.length - 1, s)];
  }
}

/**
 * Procedural route: walks the section-template graph, chaining sections whose
 * connectors match, and keeps heading/elevation continuous across boundaries.
 */
export class Route {
  readonly sections: Section[] = [];
  private rng: Rng;
  private conn: ConnId = 'full';
  private level: Level = 'ground';
  private sinceFork = 0;
  private sinceBridge = 0;
  private bridgeRun = 0;
  private sinceLethal = 0; // sections since the last lethal hazard of any kind
  /** Where the next lethal encounter should begin (near edge, metres); drawn from the route seed. */
  private nextLethalAt = Infinity;
  /** Seeded shuffle bag of signature hazards: each group of three holds one of each kind. */
  private bag: HazardKind[] = [];
  private branchRun = 0;
  private nextIndex = 0;
  private cursor = 0;

  constructor(readonly seed: number, readonly env: EnvId = 'city', private lethal = true) {
    this.rng = new Rng(seed);
    if (lethal) this.nextLethalAt = this.rng.range(...TUNING.pacing.firstLethal);
    this.append(START_SECTION, -90, 0, 0, 0);
  }

  private append(def: SectionDef, s0: number, h0: number, x0: number, y0: number) {
    const sec = new Section(this.nextIndex++, def, this.env, s0, h0, x0, y0);
    const local = new Rng((this.seed ^ Math.imul(sec.index + 1, 0x9e3779b1)) >>> 0);
    const difficulty = clamp(sec.s0 / 3500, 0, 1);
    if (def.kind === 'chasm') {
      // Gap sized from the riding speed expected here: longer than Jump + Air Jump can carry, within a Surge Jump.
      const z0 = sec.s0 + CHASM.approach;
      const v = Math.min(TUNING.speed.max, TUNING.speed.base + Math.max(0, z0) * TUNING.speed.perMetre);
      const gap = Math.ceil((v * CHASM.gapSeconds) / SLICE) * SLICE;
      sec.hazards.push({ kind: 'chasm', z0, z1: z0 + gap, safeLane: local.int(0, LANES - 1) });
    } else if (def.kind === 'pillars') {
      const z0 = sec.s0 + PILLARS.approach;
      sec.hazards.push({ kind: 'pillars', z0, z1: z0 + PILLARS.depth, safeLane: local.int(0, LANES - 1) });
    } else if (def.kind === 'mutantSpill') {
      const z0 = sec.s0 + MUTANT.approach;
      sec.hazards.push({ kind: 'mutantSpill', z0, z1: z0 + MUTANT.depth, safeLane: local.int(0, LANES - 1) });
    }
    sec.entities = sec.index === 0 ? [] : populate(sec, local, difficulty);
    sec.props = (ENVIRONMENTS[this.env] ?? ENVIRONMENTS.city).dress(sec, local);
    this.sections.push(sec);
    this.conn = def.to;
    if (def.kind === 'rampUp') this.level = 'bridge';
    if (def.kind === 'rampDown') this.level = 'ground';
    return sec;
  }

  /**
   * Picks the next section. Lethal encounters are scheduled by distance: once the route
   * reaches the seeded target (`nextLethalAt`), the next eligible section is a hazard drawn
   * at random from HAZARD_POOL. Fairness rules:
   *  - hazards only on straight, full-width ground road (never in a fork or on the bridge);
   *  - one section of recovery after a hazard before any fork or ramp (it favours a sharp, drifting corner);
   *  - no fork or bridge detour is started once a hazard is due;
   *  - as a hazard comes due the road is steered back toward straight.
   */
  private choose(last: Section): SectionDef {
    const heading = last.endHeading;
    const difficulty = clamp(last.s1 / 3500, 0, 1);
    const P = TUNING.pacing;
    const isLethal = (d: SectionDef) => HAZARD_POOL.includes(d.kind as HazardKind);
    const approach = (CHASM.approach + PILLARS.approach) / 2;
    const due = this.lethal && last.s1 + approach >= this.nextLethalAt - P.early;
    const soon = this.lethal && last.s1 + 180 + approach >= this.nextLethalAt - P.early; // within about one section
    const recovering = this.sinceLethal === 0;
    const options = SECTION_DEFS.filter((d) => {
      if (d.from !== this.conn || d.level !== this.level || d.difficulty > difficulty) return false;
      const sharp = Math.abs(d.turn) >= 0.45;
      if (Math.abs(heading + d.turn) > (sharp ? 0.56 : 0.36)) return false;
      if (isLethal(d)) return due && !recovering && Math.abs(heading) < 0.2;
      if (recovering && (d.kind === 'split' || d.kind === 'rampUp')) return false;
      if (due && (d.kind === 'split' || d.kind === 'rampUp')) return false;
      if (sharp) return last.index >= 2 && this.sinceFork >= 1;
      if (d.kind === 'split') return this.sinceFork >= 2 && last.index >= 1;
      if (d.kind === 'rampUp') return this.sinceBridge >= 5 && this.sinceFork >= 1;
      if (d.kind === 'branch') return this.branchRun < (this.lethal ? 1 : 2); // keep detours short between hazards
      if (d.kind === 'merge') return this.branchRun >= 1;
      if (d.kind === 'bridge') return this.bridgeRun < (this.lethal ? 2 : 3);
      if (d.kind === 'rampDown') return this.bridgeRun >= 1;
      return true;
    });
    const lethal = options.filter(isLethal);
    if (lethal.length) {
      // a hazard is due: take the next kind from the seeded shuffle bag
      if (!this.bag.length) this.refillBag();
      return lethal.find((d) => d.kind === this.bag[0]) ?? lethal[0];
    }
    return this.rng.weighted(options, (d) => {
      let w = d.weight;
      if (d.turn !== 0 && heading * d.turn < 0) w *= 2.5; // prefer straightening out
      if (d.kind === 'split') w *= this.sinceFork >= 5 ? 12 : this.sinceFork >= 3 ? 2.5 : 1;
      if (d.kind === 'rampUp') w *= this.sinceBridge >= 9 ? 9 : 1.6; // keep the lagoon bridge in rotation alongside forks and Chasms
      // line the road up for the coming hazard — but a sharp drifting corner may still delay it a little
      if (soon) w *= Math.abs(heading + d.turn) < 0.2 ? 8 : Math.abs(d.turn) >= 0.45 ? 1 : 0.15;
      if (recovering && Math.abs(d.turn) >= 0.45) w *= 6;
      return w;
    });
  }

  /** One of each signature hazard, in an order drawn from the route's own seeded RNG. */
  private refillBag() {
    const b = [...HAZARD_POOL];
    for (let i = b.length - 1; i > 0; i--) { const j = this.rng.int(0, i); [b[i], b[j]] = [b[j], b[i]]; }
    this.bag = b;
  }

  /** Make sure the route exists up to distance s. */
  ensure(s: number) {
    let last = this.sections[this.sections.length - 1];
    while (last.s1 < s) {
      const def = this.choose(last);
      this.sinceFork = def.kind === 'split' || def.kind === 'branch' || def.kind === 'merge' ? 0 : this.sinceFork + 1;
      this.branchRun = def.kind === 'branch' ? this.branchRun + 1 : 0;
      this.bridgeRun = def.kind === 'bridge' ? this.bridgeRun + 1 : 0;
      this.sinceLethal = HAZARD_POOL.includes(def.kind as HazardKind) ? 0 : this.sinceLethal + 1;
      this.sinceBridge = this.level === 'bridge' || def.kind === 'rampUp' ? 0 : this.sinceBridge + 1;
      last = this.append(def, last.s1, last.endHeading, last.endX, last.endY);
      const h = last.hazards[0];
      if (h) {
        const i = this.bag.indexOf(h.kind);
        if (i >= 0) this.bag.splice(i, 1);
        this.nextLethalAt = h.z1 + this.rng.range(...TUNING.pacing.lethalGap);
      }
    }
  }

  /** Drop sections that are entirely behind s. */
  prune(s: number) {
    while (this.sections.length > 1 && this.sections[0].s1 < s) {
      this.sections.shift();
      this.cursor = Math.max(0, this.cursor - 1);
    }
  }

  sectionAt(s: number): Section {
    const secs = this.sections;
    let i = clamp(this.cursor, 0, secs.length - 1);
    while (i > 0 && s < secs[i].s0) i--;
    while (i < secs.length - 1 && s >= secs[i].s1) i++;
    this.cursor = i;
    return secs[i];
  }
}

