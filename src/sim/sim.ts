import { LANES, LANE_W, TUNING, clamp, lerp, smooth, type CharacterId } from '../core/config';
import { Route, type Section } from '../world/route';
import { isPickup, type EntityKind } from '../world/populate';
import type { Role } from '../world/sections';
import { CHARACTER_KIT, CHASM, HAZARD_WARNING_S, MUTANT, bypasses, type AbilityId, type Hazard, type HazardKind } from '../world/hazards';

/** 'down' = signature ability (S / swipe down); 'ability' = secondary ability (E / tap). */
export type Intent = 'left' | 'right' | 'jump' | 'down' | 'ability';
/** What kind of flight the bike is in. 'ramp' is a launch off a Chasm crossing ramp. */
export type JumpKind = 'none' | 'normal' | 'air' | 'surge' | 'ramp';

export interface SimEvent {
  type: 'pickup' | 'hit' | 'jump' | 'land' | 'lane' | 'blocked' | 'denied' | 'dead' | 'route' | 'fall' | 'cross' | 'smash' | 'repel' | 'scrap' | 'heal' | 'crash'
    | 'phantom' | 'phantomPause' | 'phantomResume' | 'phantomEnd' | 'blink' | 'nearMiss' | 'regen';
  kind?: EntityKind;
  role?: Role;
  jump?: JumpKind; // jump / land / cross: the flight involved
  impact?: number; // land: vertical speed at touchdown (m/s)
  ability?: AbilityId; // denied: which ability was refused
  reason?: 'momentum' | 'noTarget' | 'airborne' | 'noDef' | 'active' | 'hpFull' | 'cooldown' | 'surge' | 'chasm' | 'phantom'; // denied: why
  x0?: number; // blink: lateral position before the teleport
  hazard?: HazardKind; // cross / smash / crash: which lethal hazard
  lanes?: number[]; // smash: the lanes whose pillars were destroyed
  x: number;
  y: number;
  z: number;
}

export interface SimOptions {
  seed: number;
  character?: CharacterId;
  attract?: boolean; // title-screen cruise: no collisions, no lethal hazards
  god?: boolean; // debug: ignore damage and lethal hazards
}

/**
 * Deterministic gameplay simulation. Knows nothing about rendering or input devices:
 * it consumes intents, advances in fixed steps and emits events for presentation.
 */
export class Sim {
  readonly route: Route;
  readonly character: CharacterId;
  readonly attract: boolean;
  god: boolean;

  s = 0; // distance along the route (metres)
  /** Effective riding speed (m/s): baseSpeed, x1.25 while Phantom Drive is boosting. */
  speed = 0;
  /** Normal riding speed, before Phantom Drive. */
  baseSpeed = 0;
  lane = 2;
  laneFrom = 2;
  laneT = 1;
  private queued: Intent | null = null;

  // --- vertical state ---
  jumpY = 0; // height above the road surface (negative while falling into a Chasm)
  jumpV = 0;
  airborne = false;
  jumpKind: JumpKind = 'none';
  private gravity = TUNING.jump.gravity;
  private airJumpUsed = false;
  /** Height of a crossing ramp under the wheels. */
  private rampLift = 0;

  // --- lethal hazards ---
  /** The hazard currently being approached or crossed, if any. */
  hazard: Hazard | null = null;
  falling = false;
  /** Seized by the Mutant Spill's tentacles: no control, being pulled under. */
  grabbed = false;
  grabT = 0;
  fallT = 0;

  hp = TUNING.survival.hp;
  def = TUNING.survival.def;
  momentum = 0;
  coins = 0;
  score = 0;
  chain = 1;
  private combo = 0;
  private comboTimer = 0;
  invuln = 0;
  alive = true;
  /** What ended the run (set at the game-ending transition; a new run starts null). */
  deathCause: 'chasm' | 'pillars' | 'mutantSpill' | 'crate' | 'barricade' | null = null;

  // --- Mach: Phantom Drive (secondary) and Blink (passive) ---
  phantomT = 0; // boosted seconds remaining (0 = not active)
  phantomCd = 0; // cooldown seconds remaining
  /** The Chasm currently holding Phantom Drive's boost and timer, until its far edge is cleared. */
  phantomHold: Hazard | null = null;
  /** True during steps that are actually boosted (score bonus applies). */
  phantomOn = false;
  blinkCd = 0;
  // --- Lynn: HP regeneration (passive) ---
  private regenQuiet = 0; // damage-free seconds
  private regenAcc = 0; // progress through the current interval
  time = 0;
  role: Role = 'main';
  sec: Section;
  events: SimEvent[] = [];

  constructor(opts: SimOptions) {
    this.character = opts.character ?? 'mach';
    this.attract = !!opts.attract;
    this.god = !!opts.god;
    this.route = new Route(opts.seed, 'city', !this.attract);
    this.route.ensure(450);
    this.sec = this.route.sectionAt(0);
    this.speed = this.baseSpeed = this.attract ? TUNING.speed.attract : TUNING.speed.base;
  }

  get x() { return lerp(this.sec.laneX(this.laneFrom, this.s), this.sec.laneX(this.lane, this.s), smooth(this.laneT)); }
  get groundY() { return lerp(this.sec.laneY(this.laneFrom, this.s), this.sec.laneY(this.lane, this.s), smooth(this.laneT)) + this.rampLift; }
  /** Signed lateral speed in lanes/second-ish, for presentation lean. */
  get lateral() { return this.laneT < 1 ? (this.lane - this.laneFrom) * Math.sin(Math.PI * this.laneT) : 0; }
  get distance() { return Math.max(0, this.s); }
  /** The lane the bike is mostly in right now. */
  get laneNow() { return this.laneT < 0.5 ? this.laneFrom : this.lane; }
  /** True while the bike is above (or in) a Chasm's gap. */
  get overGap() { const h = this.hazard; return !!h && h.kind === 'chasm' && this.s > h.z0 && this.s < h.z1; }

  intent(i: Intent) {
    if (!this.alive || this.attract || this.falling || this.grabbed) return;
    if (i === 'left' || i === 'right') {
      if (this.laneT < 1) { this.queued = i; return; }
      this.changeLane(i === 'left' ? -1 : 1);
    } else if (i === 'jump') {
      if (!this.airborne) this.normalJump();
      else this.airJump();
    } else if (i === 'ability') {
      this.secondary();
    } else if (i === 'down') {
      this.signature();
    }
  }

  // --- abilities ---

  /** Normal Jump: free, grounded only. */
  private normalJump() {
    this.airborne = true;
    this.jumpKind = 'normal';
    this.jumpV = TUNING.jump.velocity;
    this.gravity = TUNING.jump.gravity;
    this.airJumpUsed = false;
    this.emit('jump').jump = 'normal';
  }

  /**
   * Double Jump (all riders): one per ordinary jump, costs Momentum. Not available during a
   * ramp flight or a Surge. A refused attempt leaves the current jump untouched.
   */
  private airJump() {
    const cost = TUNING.jump.airCost;
    const allowed = CHARACTER_KIT[this.character].airJump && this.jumpKind === 'normal' && !this.airJumpUsed;
    if (!allowed || this.momentum < cost) {
      if (allowed) { const e = this.emit('denied'); e.ability = 'airJump'; e.reason = 'momentum'; }
      return;
    }
    this.momentum -= cost;
    this.airJumpUsed = true;
    this.jumpKind = 'air';
    this.jumpV = TUNING.jump.airVelocity;
    this.emit('jump').jump = 'air';
  }

  /** Seconds of Scrap's double chain remaining (0 = inactive). */
  scrapT = 0;

  /** The multiplier pickups actually score at: the chain, doubled while Scrap is active. */
  get scoreChain() { return this.chain * (this.scrapT > 0 ? TUNING.scrap.chainFactor : 1); }

  /** The character's secondary (E / tap) ability. */
  private secondary() {
    const ability = CHARACTER_KIT[this.character].secondary;
    if (ability === 'phantomDrive') this.phantomDrive();
    else if (ability === 'scrap') this.scrap();
    else if (ability === 'fullHeal') this.fullHeal();
  }

  /**
   * Scrap (Brute): sacrifice exactly one DEF for double chain. Costs no Momentum, grants
   * no invulnerability and counters no hazard. Never stacks or extends: pressing it again
   * while active is refused and costs nothing.
   */
  private scrap() {
    const deny = (reason: SimEvent['reason']) => { const e = this.emit('denied'); e.ability = 'scrap'; e.reason = reason; };
    if (this.scrapT > 0) return deny('active');
    if (this.def < 1) return deny('noDef');
    this.def -= 1;
    this.scrapT = TUNING.scrap.duration;
    this.emit('scrap');
  }

  /**
   * Full Heal (Lynn): restore HP to its maximum for Momentum. Refused at full HP or
   * without enough Momentum, in which case nothing changes. Never touches DEF.
   */
  private fullHeal() {
    const deny = (reason: SimEvent['reason']) => { const e = this.emit('denied'); e.ability = 'fullHeal'; e.reason = reason; };
    if (this.hp >= TUNING.survival.hp) return deny('hpFull');
    if (this.momentum < TUNING.fullHeal.cost) return deny('momentum');
    this.momentum -= TUNING.fullHeal.cost;
    this.hp = TUNING.survival.hp;
    this.emit('heal');
  }

  /**
   * Phantom Drive (Mach): +25% speed, immediately, for 4 s of boosted riding, with a 1.25x
   * bonus on score earned while boosted. No protection of any kind. Refused (at no cost)
   * while active, cooling down, during a Surge, with a Chasm in warning range, or without
   * 50 Momentum.
   */
  private phantomDrive() {
    const P = TUNING.phantom;
    const deny = (reason: SimEvent['reason']) => { const e = this.emit('denied'); e.ability = 'phantomDrive'; e.reason = reason; };
    if (this.phantomT > 0) return deny('active');
    if (this.phantomCd > 0) return deny('cooldown');
    if (this.jumpKind === 'surge') return deny('surge');
    if (this.chasmInRange()) return deny('chasm');
    if (this.momentum < P.cost) return deny('momentum');
    this.momentum -= P.cost;
    this.phantomT = P.duration;
    this.phantomHold = null;
    this.phantomOn = true;
    this.speed = this.baseSpeed * P.speedFactor; // immediate
    this.emit('phantom');
  }

  /** A Chasm (not yet cleared to its far edge) within warning range. */
  private chasmInRange(): Hazard | null {
    const h = this.findHazard();
    return h && h.kind === 'chasm' && this.s <= h.z1 && h.z0 - this.s <= this.speed * HAZARD_WARNING_S ? h : null;
  }

  /**
   * Advance Phantom Drive for this step and return the speed factor. A Chasm entering warning
   * range holds the boost and pauses the timer until that Chasm's far edge is cleared (the
   * hold is sticky, so the slower un-boosted speed can't flicker it back on).
   */
  private stepPhantom(dt: number) {
    const P = TUNING.phantom;
    if (this.phantomCd > 0) this.phantomCd = Math.max(0, this.phantomCd - dt);
    this.phantomOn = false;
    if (this.phantomT <= 0) return 1;
    if (this.phantomHold && this.s > this.phantomHold.z1) { this.phantomHold = null; this.emit('phantomResume'); }
    if (!this.phantomHold) { const c = this.chasmInRange(); if (c) { this.phantomHold = c; this.emit('phantomPause'); } }
    if (this.phantomHold) return 1;
    this.phantomOn = true;
    this.phantomT -= dt;
    if (this.phantomT <= 1e-6) { this.phantomT = 0; this.phantomCd = P.cooldown; this.emit('phantomEnd'); }
    return P.speedFactor;
  }

  /**
   * Blink (Mach passive): an instant one-lane teleport away from an ordinary-debris hit that
   * would land within the next 0.25 s, by the same lane and height rules as collide(). Grounded
   * only, never with invulnerability, never anywhere near a lethal hazard, never into debris or
   * across a fork divider. A Blink that finds no safe lane does nothing and costs no cooldown.
   */
  private tryBlink() {
    const B = TUNING.blink;
    if (this.character !== 'mach' || this.god || this.blinkCd > 0 || this.airborne || this.invuln > 0) return;
    const h = this.hazard;
    if (h && this.s <= h.z1 + 1 && h.z0 - this.s <= this.speed * HAZARD_WARNING_S) return; // lethal hazards are not Blink's business
    const from = this.laneNow, reach = 1.1 + this.speed * B.window;
    const debrisIn = (lane: number, back: number, ahead: number) => {
      for (const sec of this.route.sections) {
        if (sec.s1 < this.s - back - 2 || sec.s0 > this.s + ahead + 2) continue;
        for (const e of sec.entities) {
          if (e.taken || isPickup(e.kind) || e.lane !== lane) continue;
          const dz = e.s - this.s;
          if (dz < -back || dz > ahead) continue;
          if (this.jumpY > (e.kind === 'barricade' ? 0.85 : 2)) continue; // same height rule as collide()
          return true;
        }
      }
      return false;
    };
    if (!debrisIn(from, 1.1, reach)) return;
    const safe = (lane: number) => {
      if (lane < 0 || lane >= LANES) return false;
      const ahead = this.s + this.speed * B.window;
      const ok = this.sec.canCross(from, lane, this.s) && this.route.sectionAt(ahead).canCross(from, lane, ahead);
      this.route.sectionAt(this.s);
      return ok && !debrisIn(lane, 1.5, 1.1 + this.speed * B.arrivalClear);
    };
    const dir = this.laneT < 1 ? Math.sign(this.lane - this.laneFrom) : 0;
    const prefer = dir !== 0 ? from - dir : from - 1; // opposite the lane change, else left
    const other = 2 * from - prefer;
    const to = safe(prefer) ? prefer : safe(other) ? other : -1;
    if (to < 0) return;
    const x0 = this.x;
    this.lane = this.laneFrom = to;
    this.laneT = 1;
    this.queued = null;
    this.blinkCd = B.cooldown;
    this.emit('blink').x0 = x0;
  }

  /** Lynn's passive: +1 HP per 12 s once 5 damage-free seconds have passed; never DEF, never past max. */
  private stepRegen(dt: number) {
    if (this.character !== 'lynn') return;
    const R = TUNING.regen;
    this.regenQuiet += dt;
    if (this.hp >= TUNING.survival.hp) { this.regenAcc = 0; return; }
    if (this.regenQuiet < R.delay) return;
    this.regenAcc += dt;
    if (this.regenAcc >= R.interval - 1e-9) {
      this.regenAcc = 0;
      this.hp = Math.min(TUNING.survival.hp, this.hp + 1);
      this.emit('regen');
    }
  }

  /** The character's signature (S / swipe-down) ability. */
  private signature() {
    const ability = CHARACTER_KIT[this.character].signature;
    if (ability === 'smash' || ability === 'mutagenRepellent') { this.counter(ability); return; }
    if (ability !== 'surgeJump') return;
    if (this.phantomT > 0) { const e = this.emit('denied'); e.ability = 'surgeJump'; e.reason = 'phantom'; return; } // no Surge while Phantom Drive is active (incl. paused)
    // Surge Jump: grounded, full meter only; spends all of it.
    if (this.airborne || this.momentum < TUNING.momentum.max) { const e = this.emit('denied'); e.ability = 'surgeJump'; e.reason = this.airborne ? 'airborne' : 'momentum'; return; }
    this.momentum = 0;
    this.airborne = true;
    this.jumpKind = 'surge';
    this.airJumpUsed = true;
    this.jumpV = TUNING.jump.surgeVelocity;
    this.gravity = TUNING.jump.gravity * TUNING.jump.surgeGravityScale;
    this.baseSpeed *= TUNING.jump.surgeSpeedBoost;
    this.speed = this.baseSpeed;
    this.emit('jump').jump = 'surge';
  }

  /**
   * Class counters fired on S: Smash (Brute) and Mutagen Repellent (Lynn). An intentional
   * action that works on the one lethal hazard directly ahead, if — and only if — this
   * character's ability is that hazard's listed counter (HAZARD_BYPASS) and it lies within
   * the activation window. Spends Momentum only on success; a refused attempt changes
   * nothing. Neither grants invulnerability:
   *  - Smash destroys the Pillars of that encounter (`cleared`);
   *  - Repellent makes that one Mutant Spill recoil from Lynn (`repelled`); it stays alive.
   */
  private counter(ability: 'smash' | 'mutagenRepellent') {
    const h = this.hazard;
    const target = !!h && !h.cleared && !h.repelled && bypasses(h.kind, this.character, ability) && this.inAbilityWindow(ability, h);
    if (!target) { const e = this.emit('denied'); e.ability = ability; e.reason = 'noTarget'; return; }
    const cost = this.abilityCost(ability);
    if (this.momentum < cost) { const e = this.emit('denied'); e.ability = ability; e.reason = 'momentum'; return; }
    this.momentum -= cost;
    if (ability === 'smash') {
      h!.cleared = true;
      const e = this.emit('smash');
      e.hazard = h!.kind;
      e.z = h!.z0;
      e.lanes = [0, 1, 2, 3, 4].filter((l) => l !== h!.safeLane);
    } else {
      h!.repelled = true;
      const e = this.emit('repel');
      e.hazard = h!.kind;
    }
  }

  /** True while Lynn's Repellent is shielding her through the encounter it was used on. */
  get repelActive() {
    const h = this.hazard;
    return !!h && !!h.repelled && this.s <= h.z1 + 1;
  }

  /**
   * True when firing the ability right now would actually beat the hazard ahead, so the
   * HUD only offers it when it works. Surge: the flight (from current speed and the jump
   * tuning) must carry the bike past the far edge. Smash: within its activation window.
   */
  inAbilityWindow(a: AbilityId, h: Hazard) {
    const dist = h.z0 - this.s;
    if (a === 'smash') return dist >= 0 && dist <= this.speed * TUNING.smash.window;
    if (a === 'mutagenRepellent') return dist >= 0 && dist <= this.speed * TUNING.repellent.window;
    if (a === 'surgeJump') {
      const J = TUNING.jump, airtime = (2 * J.surgeVelocity) / (J.gravity * J.surgeGravityScale);
      const reach = this.speed * J.surgeSpeedBoost * airtime;
      return !this.airborne && dist >= 0.2 && dist + (h.z1 - h.z0) + 0.5 <= reach; // reach is a slight underestimate: flight speed keeps rising
    }
    return true;
  }

  /** Momentum a signature ability needs before it can fire. */
  abilityCost(a: AbilityId) {
    return a === 'phantomDrive' ? TUNING.phantom.cost : a === 'surgeJump' ? TUNING.momentum.max : a === 'smash' ? TUNING.smash.cost : a === 'mutagenRepellent' ? TUNING.repellent.cost : a === 'fullHeal' ? TUNING.fullHeal.cost : a === 'airJump' ? TUNING.jump.airCost : 0;
  }

  /** The ability currently carrying the bike, for hazard-bypass rules. */
  get activeAbility(): AbilityId | null {
    return this.jumpKind === 'surge' ? 'surgeJump' : this.jumpKind === 'air' ? 'airJump' : null;
  }

  private changeLane(dir: -1 | 1) {
    const target = this.lane + dir;
    const ahead = this.s + this.speed * TUNING.laneChangeTime;
    const okNow = target >= 0 && target < LANES && this.sec.canCross(this.lane, target, this.s);
    const okAhead = okNow && this.route.sectionAt(ahead).canCross(this.lane, target, ahead);
    this.route.sectionAt(this.s);
    if (!okAhead) { this.emit('blocked'); return; }
    this.laneFrom = this.lane;
    this.lane = target;
    this.laneT = 0;
    this.emit('lane');
  }

  private emit(type: SimEvent['type'], kind?: EntityKind, role?: Role): SimEvent {
    const e: SimEvent = { type, kind, role, x: this.x, y: this.groundY + this.jumpY, z: this.s };
    this.events.push(e);
    return e;
  }

  step(dt: number) {
    if (!this.alive) {
      this.speed = Math.max(0, this.speed - 60 * dt);
      this.s += this.speed * dt;
      return;
    }
    this.time += dt;
    if (this.falling) { this.stepFall(dt); return; }
    if (this.grabbed) { this.stepGrab(dt); return; }

    const sp = TUNING.speed;
    let target = this.attract ? sp.attract : Math.min(sp.max, sp.base + this.distance * sp.perMetre);
    if (this.jumpKind === 'surge') target *= TUNING.jump.surgeSpeedBoost; // the kick lasts as long as the flight
    this.baseSpeed += clamp(target - this.baseSpeed, -20 * dt, 12 * dt);
    this.speed = this.baseSpeed * this.stepPhantom(dt); // Phantom Drive never stacks with Surge: they exclude each other
    const prevS = this.s;
    this.s += this.speed * dt;
    this.route.ensure(this.s + 520);
    this.route.prune(this.s - 90);
    this.sec = this.route.sectionAt(this.s);

    if (this.laneT < 1) {
      this.laneT = Math.min(1, this.laneT + dt / TUNING.laneChangeTime);
      if (this.laneT >= 1) {
        this.laneFrom = this.lane;
        if (this.queued) { const q = this.queued; this.queued = null; this.intent(q); }
      }
    }

    this.hazard = this.findHazard();

    if (this.airborne) {
      this.jumpV -= this.gravity * dt;
      this.jumpY += this.jumpV * dt;
      if (this.jumpY <= 0) {
        const impact = -this.jumpV, kind = this.jumpKind;
        this.jumpY = 0; this.jumpV = 0; this.airborne = false; this.jumpKind = 'none';
        // touching down inside the gap is not a landing: the Chasm rules below take over
        if (!this.overGap || this.god) { const e = this.emit('land'); e.jump = kind; e.impact = impact; }
      }
    }

    if (this.hazard?.kind !== 'chasm') this.rampLift = 0;
    if (this.hazard && !this.attract) {
      if (this.hazard.kind === 'chasm') this.stepChasm(this.hazard, prevS);
      else if (this.hazard.kind === 'pillars') this.stepPillars(this.hazard, prevS);
      else if (this.hazard.kind === 'mutantSpill') this.stepSpill(this.hazard, prevS);
    }
    if (!this.alive) return;
    if (this.falling || this.grabbed) return;

    if (this.invuln > 0) this.invuln -= dt;
    if (this.scrapT > 0) this.scrapT = Math.max(0, this.scrapT - dt);
    if (this.blinkCd > 0) this.blinkCd = Math.max(0, this.blinkCd - dt);
    this.stepRegen(dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) { this.combo = 0; this.chain = 1; }
    }

    // Which carriageway are we committed to?
    const rb = this.sec.laneRibbon[this.lane];
    const split = this.sec.ribbons.length > 1 && !this.sec.joined(0, this.sec.ribbons.length - 1, this.s);
    const role: Role = split ? this.sec.ribbons[rb].role : 'main';
    if (role !== this.role) {
      this.role = role;
      if (role !== 'main' && !this.attract) this.emit('route', undefined, role);
    }

    if (!this.attract) { this.tryBlink(); this.collide(prevS); }
  }

  // --- lethal hazards ---

  private findHazard(): Hazard | null {
    for (const sec of this.route.sections) {
      if (sec.s1 < this.s || sec.s0 > this.s + 400) continue;
      for (const h of sec.hazards) if (h.z1 > this.s - 1) return h;
    }
    return null;
  }

  /**
   * Chasm rules, decided from the real trajectory:
   *  - riding up the ramp lane launches a flight that is sized to reach the far side;
   *  - any flight may pass over the gap for as long as it stays in the air;
   *  - being on the "ground" inside the gap (rode in, or a jump that came down short) is a fall.
   * Only a Surge Jump stays up long enough to span the gap; Jump + Air Jump cannot (see CHASM.gapSeconds).
   */
  private stepChasm(h: Hazard, prevS: number) {
    if (h.kind !== 'chasm') return;
    const rampStart = h.z0 - CHASM.rampLength;
    const onRampLane = this.laneNow === h.safeLane;

    // the ramp lifts the wheels as the bike climbs it
    this.rampLift = 0;
    if (!this.god && !this.airborne && this.s >= rampStart && this.s < h.z0) {
      const weight = (this.lane === h.safeLane ? smooth(this.laneT) : 0) + (this.laneFrom === h.safeLane && this.lane !== h.safeLane ? 1 - smooth(this.laneT) : 0);
      this.rampLift = CHASM.rampHeight * smooth((this.s - rampStart) / CHASM.rampLength) * weight;
    }
    if (this.god) return; // debug: the gap behaves as solid road

    // leaving the lip
    if (prevS < h.z0 && this.s >= h.z0 && !this.airborne && onRampLane) {
      const T = ((h.z1 + CHASM.landing - this.s) / this.speed) * 1.1; // flight time, with margin
      this.airborne = true;
      this.jumpKind = 'ramp';
      this.airJumpUsed = true;
      this.jumpY = CHASM.rampHeight;
      this.jumpV = clamp(this.speed * 0.15, 4, 6);
      this.gravity = (2 * (this.jumpY + this.jumpV * T)) / (T * T); // lands exactly at T
      this.rampLift = 0;
      this.emit('jump').jump = 'ramp';
    }

    if (this.s > h.z0 && this.s < h.z1 && !this.airborne) this.startFall();
    else if (prevS < h.z1 && this.s >= h.z1) {
      const e = this.emit('cross');
      e.hazard = 'chasm';
      e.jump = this.jumpKind;
      e.ability = bypasses('chasm', this.character, this.activeAbility) ? 'surgeJump' : undefined;
    }
  }

  /**
   * Pillars: solid from the ground to well above any jump. Inside the span, any lane but
   * the safe passage is instant death unless the encounter has been cleared (smashed).
   * Height is deliberately ignored: no jump, Air Jump or Surge clears a pillar.
   */
  private stepPillars(h: Hazard, prevS: number) {
    if (this.god || h.cleared) {
      if (prevS < h.z1 && this.s >= h.z1) { const e = this.emit('cross'); e.hazard = 'pillars'; e.ability = h.cleared ? 'smash' : undefined; }
      return;
    }
    if (this.s >= h.z0 && this.s <= h.z1 && this.laneNow !== h.safeLane) {
      // lethal: HP, DEF and damage invulnerability do not apply
      const e = this.emit('crash'); e.hazard = 'pillars'; e.jump = this.jumpKind; // y = height at impact
      this.s = h.z0 - 0.6; // stopped dead against the pillar face
      this.speed = 0;
      this.jumpY = 0; this.jumpV = 0; this.airborne = false; this.jumpKind = 'none';
      this.hp = 0;
      this.alive = false;
      this.deathCause = 'pillars';
      this.combo = 0; this.chain = 1;
      this.emit('dead');
      return;
    }
    if (prevS < h.z1 && this.s >= h.z1) { const e = this.emit('cross'); e.hazard = 'pillars'; }
  }

  /**
   * Mutant Spill: the organism sprawls over every lane but the passage, tentacles reaching
   * up past any jump height. Inside its span, an occupied lane means being grabbed — unless
   * Lynn's Repellent was used on this encounter. Height is deliberately ignored.
   */
  private stepSpill(h: Hazard, prevS: number) {
    const passed = prevS < h.z1 && this.s >= h.z1;
    if (this.god || h.repelled) {
      if (passed) { const e = this.emit('cross'); e.hazard = 'mutantSpill'; e.ability = h.repelled ? 'mutagenRepellent' : undefined; }
      return;
    }
    if (this.s >= h.z0 && this.s <= h.z1 && this.laneNow !== h.safeLane) { this.startGrab(); return; }
    if (passed) { const e = this.emit('cross'); e.hazard = 'mutantSpill'; }
  }

  /** Lethal: HP, DEF and damage invulnerability do not apply. */
  private startGrab() {
    const e = this.emit('crash'); e.hazard = 'mutantSpill'; e.jump = this.jumpKind; // y = height when seized
    this.grabbed = true;
    this.grabT = 0;
    this.airborne = false;
    this.jumpKind = 'none';
    this.jumpV = 0;
    this.rampLift = 0;
    this.combo = 0;
    this.chain = 1;
  }

  /** Hauled to a stop and pulled down into the organism, then the run ends. */
  private stepGrab(dt: number) {
    this.grabT += dt;
    this.speed *= 1 - Math.min(1, dt * 7);
    this.s += this.speed * dt;
    this.jumpY += (-1.6 - this.jumpY) * Math.min(1, dt * 5);
    this.sec = this.route.sectionAt(this.s);
    if (this.grabT >= MUTANT.grabTime) {
      this.hp = 0;
      this.alive = false;
      this.deathCause = 'mutantSpill';
      this.emit('dead');
    }
  }

  private startFall() {
    this.falling = true;
    this.fallT = 0;
    this.airborne = false;
    this.jumpKind = 'none';
    this.jumpV = Math.min(this.jumpV, 0);
    this.rampLift = 0;
    this.combo = 0;
    this.chain = 1;
    this.emit('fall');
  }

  /** Dropping into the Chasm: no control, no collisions, then the run ends. */
  private stepFall(dt: number) {
    this.fallT += dt;
    this.jumpV -= TUNING.jump.gravity * dt;
    this.jumpY += this.jumpV * dt;
    this.speed *= 1 - Math.min(1, dt * 1.8);
    this.s += this.speed * dt;
    const wall = this.hazard ? this.hazard.z1 - 1.4 : this.s;
    if (this.s > wall) { this.s = wall; this.speed = 0; } // the far wall stops the bike
    this.sec = this.route.sectionAt(this.s);
    if (this.fallT >= CHASM.fallTime) {
      this.hp = 0;
      this.alive = false;
      this.deathCause = 'chasm';
      this.emit('dead');
    }
  }

  // --- ordinary collisions ---

  private collide(prevS: number) {
    const laneNow = this.laneNow;
    const nearMiss = CHARACTER_KIT[this.character].passive === 'nearMiss';
    for (const sec of this.route.sections) {
      if (sec.s1 < this.s - 3 || sec.s0 > this.s + 3) continue;
      for (const e of sec.entities) {
        if (e.taken) continue;
        const dz = e.s - this.s;
        if (isPickup(e.kind)) {
          if (dz > 1.7 || dz < -1.7) continue;
          if (e.lane !== this.lane && e.lane !== this.laneFrom) continue;
          if (Math.abs(this.jumpY - e.h) > 1.5) continue;
          e.taken = true;
          this.collect(e.kind);
        } else {
          const clears = this.jumpY > (e.kind === 'barricade' ? 0.85 : 2); // low debris can be hopped; crates need real height
          // Brute's Near-Miss: the object passes him this step, unhit, in an adjacent lane, close
          // beside him and at a height where it would have hit had he been in its lane. Once per object.
          if (nearMiss && !e.nearMissed && e.lane !== laneNow && Math.abs(e.lane - laneNow) === 1 && prevS < e.s && this.s >= e.s && !clears
            && Math.abs(this.x - sec.laneX(e.lane, e.s)) <= LANE_W * TUNING.nearMiss.lateral) {
            e.nearMissed = true;
            this.momentum = Math.min(TUNING.momentum.max, this.momentum + TUNING.nearMiss.reward);
            this.emit('nearMiss', e.kind);
          }
          if (dz > 1.1 || dz < -1.1 || e.lane !== laneNow) continue;
          if (clears) continue;
          e.taken = true;
          this.damage(e.kind);
        }
      }
    }
  }

  private collect(kind: EntityKind) {
    const sc = TUNING.score;
    const m = TUNING.momentum;
    this.combo++;
    this.comboTimer = sc.comboWindow;
    this.chain = Math.min(sc.maxChain, 1 + Math.floor(this.combo / sc.comboPerChain));
    // Phantom Drive: x1.25 on each gain while boosted, rounded per gain; the chain itself is untouched
    const gain = (v: number) => (this.phantomOn ? Math.round(v * this.scoreChain * TUNING.phantom.scoreFactor) : v * this.scoreChain);
    if (kind === 'coin') { this.coins++; this.score += gain(sc.coin); }
    else if (kind === 'momentumSmall') { this.momentum = Math.min(m.max, this.momentum + m.small); this.score += gain(sc.momentumSmall); }
    else if (kind === 'momentumLarge') { this.momentum = Math.min(m.max, this.momentum + m.large); this.score += gain(sc.momentumLarge); }
    this.emit('pickup', kind);
  }

  /** Ordinary damage: DEF absorbs first, then HP. */
  private damage(kind: EntityKind) {
    if (this.invuln > 0 || this.god) { this.emit('hit', kind); return; }
    if (this.def > 0) this.def--; else this.hp--;
    this.regenQuiet = 0; this.regenAcc = 0; // any DEF or HP loss restarts Lynn's regeneration delay
    this.combo = 0;
    this.chain = 1;
    this.invuln = TUNING.survival.invulnTime;
    this.baseSpeed *= 0.72;
    this.speed *= 0.72;
    this.emit('hit', kind);
    if (this.hp <= 0) { this.alive = false; this.deathCause = kind === 'barricade' ? 'barricade' : 'crate'; this.emit('dead'); }
  }

  // --- look-ahead for the HUD ---

  /** Upcoming route split the player can still choose at, if any. */
  forkAhead(range = 190): { dist: number; riskySide: 'left' | 'right' } | null {
    for (const sec of this.route.sections) {
      if (sec.def.kind !== 'split') continue;
      const commit = sec.s0 + sec.length * 0.1;
      if (commit < this.s || sec.s0 > this.s + range) continue;
      return { dist: Math.max(0, sec.s0 - this.s), riskySide: sec.ribbons[0].role === 'risky' ? 'left' : 'right' };
    }
    return null;
  }

  /** Lethal hazard coming up within warning distance: where the safe passage is and whether this character can bypass it. */
  hazardAhead(seconds = HAZARD_WARNING_S): { hazard: Hazard; dist: number; laneOffset: number; canBypass: boolean; bypassReady: boolean; ability: AbilityId } | null {
    const h = this.hazard;
    if (!h || h.cleared || h.repelled || this.s >= h.z0 || h.z0 - this.s > this.speed * seconds) return null;
    const ability = CHARACTER_KIT[this.character].signature;
    const canBypass = bypasses(h.kind, this.character, ability);
    return { hazard: h, dist: h.z0 - this.s, laneOffset: h.safeLane - this.lane, canBypass, bypassReady: canBypass && this.momentum >= this.abilityCost(ability) && this.inAbilityWindow(ability, h) && !(ability === 'surgeJump' && this.phantomT > 0), ability };
  }
}
