import { TUNING, clamp } from '../core/config';
import type { JumpKind, Sim } from '../sim/sim';
import type { RiderView } from './riderSprite';
import type { MachPose } from './mach/machRig';

/** Damped spring: every animated channel eases toward its target, so states never snap. */
class Spring {
  x = 0;
  private v = 0;
  constructor(private omega: number, private zeta: number) {}
  step(target: number, dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  /** Instant velocity impulse (take-off shove, landing impact). */
  kick(v: number) { this.v += v; }
}

export interface ForcedAnim { lateral: number; drift: number }

/** Curvature above which a corner is a real drifting corner (only the sharp-turn sections reach it). */
const DRIFT_CURVATURE = 0.0045;

/**
 * Turns gameplay state + elapsed time into the rig's view and body pose.
 * Presentation only: it reads the simulation and never changes it.
 *
 * Channels blend continuously rather than switching:
 *  - riding: suspension bob, breathing, slight weave
 *  - lane change: lean, weight shift, bars turning into the move
 *  - drift: deep lean, opposite lock, rider hanging inside with the knee out
 *    (full on sharp turns; a brief small slide when two lane changes are chained)
 *  - aerial: pitch, body posture and suspension follow the simulation's vertical
 *    velocity, height and jump type — normal jump, Air Jump, Surge Jump — and
 *    landing feeds the real impact speed into the suspension.
 */
export class RiderAnimator {
  readonly view: RiderView & { pose: MachPose } = { yaw: 0, roll: 0, pitch: 0, pose: { tuck: 0, steer: 0, suspension: 0, hang: 0, knee: 0, stand: 0 } };
  /** 0..1 how deep into a drift we are, and which way (-1 left, +1 right). */
  drift = 0;
  driftDir = 0;
  /** 0..1 exhaust / energy intensity: a pop on Air Jump, sustained through a Surge ascent. */
  boost = 0;
  /** Debug/inspection override (see ?anim=). */
  force: ForcedAnim | null = null;

  private yaw = new Spring(15, 0.85);
  private roll = new Spring(17, 0.62); // slightly under-damped: a touch of follow-through
  private steer = new Spring(24, 0.8);
  private hang = new Spring(11, 0.8); // the body lags the bike
  private knee = new Spring(12, 0.9);
  private tuck = new Spring(10, 0.9);
  private stand = new Spring(13, 0.8);
  private pitch = new Spring(17, 0.7);
  private susp = new Spring(27, 0.4); // springy: compress, rebound, settle
  private lastLaneT = 1;
  private lastDir = 0;
  private changeEndedAt = -9;
  private chain = 0;
  private clock = 0;
  private sinceAir = 9; // seconds since the last Air Jump kick
  private whipDir = 1;

  /** A jump just started in the simulation. */
  onJump(kind: JumpKind) {
    if (kind === 'air') {
      // second take-off: the bike kicks up and whips, the rider pops off the seat
      this.sinceAir = 0;
      this.whipDir = -this.whipDir;
      this.pitch.kick(4.5);
      this.stand.kick(9);
      this.boost = Math.max(this.boost, 0.75);
    } else {
      // take-off shove: the suspension loads, then the front comes up
      this.susp.kick(kind === 'surge' ? 17 : 10);
      this.pitch.kick(kind === 'surge' ? 7 : 3);
      if (kind === 'surge') this.boost = 1;
    }
  }

  /** The bike just touched down at the given vertical speed (m/s). */
  onLand(impact: number) {
    this.susp.kick(clamp(impact * 3.4, 14, 62));
    this.pitch.kick(-clamp(impact * 0.16, 0.8, 2.6)); // rear touches first, then the front drops
    this.tuck.kick(clamp(impact * 0.5, 2, 7)); // the rider soaks it up
  }

  update(sim: Sim, dt: number) {
    this.clock += dt;
    this.sinceAir += dt;
    const t = this.clock;
    const live = sim.alive;
    const s = sim.s, route = sim.route;
    const heading = sim.sec.heading(s);
    const kappa = (route.sectionAt(s + 5).heading(s + 5) - route.sectionAt(s - 5).heading(s - 5)) / 10;
    route.sectionAt(s);

    // --- chained lane changes (same direction, back to back) ---
    if (sim.laneT < this.lastLaneT) {
      const dir = Math.sign(sim.lane - sim.laneFrom);
      this.chain = t - this.changeEndedAt < 0.1 && dir === this.lastDir ? dir : 0;
      this.lastDir = dir;
    } else if (sim.laneT >= 1 && this.lastLaneT < 1) {
      this.changeEndedAt = t;
      this.chain = 0;
    }
    this.lastLaneT = sim.laneT;

    // --- drift: which way, and how much ---
    let lateral = sim.lateral;
    let want = 0, amount = 0;
    if (this.force) {
      lateral = this.force.lateral;
      want = this.force.drift;
      amount = want ? 1 : 0;
    } else if (live && !sim.airborne) {
      if (Math.abs(kappa) > DRIFT_CURVATURE) { want = Math.sign(kappa); amount = 1; } // a corner that needs it
      else if (this.chain) { want = this.chain; amount = 0.34; } // just a little slide
    }
    if (want) this.driftDir = Math.sign(want);
    this.drift += (amount - this.drift) * (1 - Math.exp(-dt * (amount > this.drift ? 9 : 4.5))); // quick in, gentler recovery
    if (this.drift < 0.002) this.drift = 0;
    const d = this.drift * this.driftDir;

    // --- aerial: everything keys off the simulation's vertical state ---
    const air = (sim.airborne || sim.falling) && live;
    const kind = sim.jumpKind;
    const v0 = kind === 'surge' ? TUNING.jump.surgeVelocity : kind === 'air' ? TUNING.jump.airVelocity : TUNING.jump.velocity;
    const u = clamp(sim.jumpV / v0, -1.4, 1); // +1 launch · 0 apex · -1 touchdown speed
    let pitchT = 0, tuckAir = 0, standT = 0;
    if (air) {
      const rise = Math.max(0, u), fall = Math.max(0, -u);
      if (kind === 'surge') {
        pitchT = 0.3 + rise * 0.56 - fall * 0.5; // near-vertical launch, long nose-down glide
        tuckAir = rise * 0.95; // flat on the tank while the engine fires
        standT = (1 - rise) * 0.75; // extends through the apex and holds
      } else if (kind === 'air') {
        pitchT = 0.2 + rise * 0.42 - fall * 0.34;
        tuckAir = rise * 0.25;
        standT = 0.45 + rise * 0.45 + fall * 0.1; // up off the seat
      } else {
        pitchT = 0.13 + rise * 0.3 - fall * 0.28;
        tuckAir = rise * 0.5; // crouched into the launch
        standT = (1 - rise) * 0.4 + fall * 0.15; // floats at the apex, legs ready below
      }
      // flare just above the tarmac so the rear tyre meets it first
      if (sim.jumpV < 0 && sim.jumpY < 0.55) { pitchT = 0.09; standT += 0.2; }
    }
    if (sim.falling) { pitchT = -0.9; standT = 0.9; tuckAir = 0; } // nose-first into the Chasm
    // Air Jump whip: a quick yaw flick that swings back
    const whip = Math.sin(this.sinceAir * 13) * Math.exp(-this.sinceAir * 4.5) * 0.5 * this.whipDir;

    const surging = air && kind === 'surge' && sim.jumpV > 0;
    this.boost += ((surging ? 1 : 0) - this.boost) * (1 - Math.exp(-dt * (surging ? 14 : 3.4)));
    if (this.boost < 0.004) this.boost = 0;

    // --- targets ---
    const grip = air ? 0.35 : 1; // cornering forces fade once the tyres leave the road
    const cornering = clamp(kappa * sim.speed * sim.speed * 0.1, -0.3, 0.3) * grip;
    const weave = live && !air ? Math.sin(t * 1.7) * 0.012 : 0;
    if (live || this.force) {
      this.yaw.step(clamp(lateral * 0.5 + heading * 0.9 + d * 0.62 + weave + whip, -0.95, 0.95), dt);
      this.roll.step(clamp(lateral * 0.38 + cornering * (1 - this.drift * 0.6) + d * 0.5 + weave * 0.8 + whip * 0.5, -0.7, 0.7), dt);
      this.steer.step(lateral * 0.24 - d * 0.34 + whip * 0.4, dt); // opposite lock while sliding
      this.hang.step(clamp(lateral * 0.55 + cornering * 1.2 + d * 0.95, -1.2, 1.2), dt);
      this.knee.step(air ? 0 : clamp(lateral * 0.35 + d, -1, 1), dt);
      const cruise = 0.1 + clamp((sim.speed - 26) / 60, 0, 0.3) + this.drift * 0.3 + Math.sin(t * 2.3) * 0.035;
      this.tuck.step(air ? tuckAir : cruise, dt);
      this.stand.step(standT, dt);
      this.pitch.step(pitchT, dt);
      // suspension: bob + road chatter on the ground; wheels hang free in the air
      const bob = 0.16 + Math.sin(t * 9.5) * 0.09 + Math.sin(t * 23.7 + 1.3) * 0.05 + this.drift * 0.3;
      this.susp.step(air ? -0.6 : bob, dt);
    }

    const v = this.view;
    v.yaw = this.yaw.x;
    v.roll = this.roll.x;
    v.pitch = clamp(this.pitch.x, -0.5, 1.0);
    v.pose.steer = this.steer.x;
    v.pose.hang = this.hang.x;
    v.pose.knee = this.knee.x;
    v.pose.tuck = clamp(this.tuck.x, 0, 1);
    v.pose.stand = clamp(this.stand.x, 0, 1);
    v.pose.suspension = clamp(this.susp.x, -0.7, 1.15);
  }

  /** Jump straight to the forced state's settled pose (for still captures). */
  settle(sim: Sim) {
    for (let i = 0; i < 90; i++) this.update(sim, 1 / 60);
  }
}
