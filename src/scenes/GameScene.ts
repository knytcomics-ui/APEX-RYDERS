import Phaser from 'phaser';
import { STEP, TUNING, type CharacterId } from '../core/config';
import { InputController } from '../input/input';
import { Camera, pt } from '../render/camera';
import { WorldRenderer } from '../render/worldRenderer';
import { Sim, type Intent, type SimEvent } from '../sim/sim';

export type Mode = 'title' | 'run' | 'over';

/** Owns the simulation loop and world presentation. HUD lives in HudScene. */
export class GameScene extends Phaser.Scene {
  sim!: Sim;
  mode: Mode = 'title';
  private cam = new Camera();
  private world!: WorldRenderer;
  private acc = 0;
  private clock = 0;
  private overAt = 0;
  private params = new URLSearchParams(location.search);
  private scratch = pt();

  constructor() { super('game'); }

  create() {
    this.cam.resize(this.scale.width, this.scale.height);
    this.registry.set('horizonY', this.cam.horizonY); // the HUD keeps hazard banners above it
    this.sim = new Sim({ seed: this.seed(), attract: true });
    this.world = new WorldRenderer(this, this.cam);
    new InputController(this, (i) => this.onIntent(i), (tap) => this.onConfirm(tap));
    this.scale.on('resize', (size: Phaser.Structs.Size) => {
      this.cam.resize(size.width, size.height);
      this.registry.set('horizonY', this.cam.horizonY);
      this.world.resize();
    });
    this.snapCamera();
    this.scriptedKeys();
    if (this.params.has('autostart')) this.debugStart();
  }

  /**
   * Debug helpers, all optional URL flags:
   *   autostart=1  skip the title        seed=<n>      fixed route
   *   god=1        no damage, Chasms are solid          mortal=1  drop god mode once the warp is done
   *   lane=<0-4>   start lane            warp=<s>      ride on for s seconds
   *   find=<kind>  ride until that section kind is `lead` metres ahead (e.g. find=chasm&lead=40)
   *   ride=<m>     then ride a further m metres (the Chasm edge is 150 m into its section)
   *   momentum=<n> set the Momentum meter        hp=<n> def=<n>  start damaged
   *   anim=<state> pin the rider animation (neutral|leanL|leanR|driftL|driftR)
   *   rider=brute  temporary test mode: ride as Brute (S = Smash) on the shared rig
   *   rider=lynn   temporary test mode: ride as Lynn (S = Mutagen Repellent) on the shared rig
   */
  private debugStart() {
    this.startRun();
    const sim = this.sim, p = this.params;
    const lane = Number(p.get('lane') ?? 2);
    while (sim.lane !== lane) { sim.intent(lane < sim.lane ? 'left' : 'right'); for (let i = 0; i < 30; i++) sim.step(STEP); }
    const warp = Number(p.get('warp') ?? 0);
    for (let t = 0; t < warp; t += STEP) sim.step(STEP);
    const find = p.get('find');
    const lead = Number(p.get('lead') ?? 60);
    for (let t = 0; find && t < 400 && sim.route.sectionAt(sim.s + lead).def.kind !== find; t += STEP) sim.step(STEP);
    // ride=<metres> carries on that much further (find/lead cannot look more than 90 m behind the rider)
    for (const until = sim.s + Number(p.get('ride') ?? 0); sim.s < until && sim.alive;) sim.step(STEP);
    // hp=<n> / def=<n>: start the encounter damaged (ability testing)
    if (p.has('hp')) sim.hp = Math.max(1, Math.min(TUNING.survival.hp, Number(p.get('hp'))));
    if (p.has('def')) sim.def = Math.max(0, Math.min(TUNING.survival.def, Number(p.get('def'))));
    if (p.has('momentum')) sim.momentum = Math.min(TUNING.momentum.max, Number(p.get('momentum')));
    if (p.has('mortal')) sim.god = false;
    sim.events.length = 0;
    this.snapCamera();
    const anim = p.get('anim');
    if (anim) {
      this.world.forceAnim(anim, sim);
      for (let i = 0; i < 40; i++) { sim.step(STEP); sim.step(STEP); sim.events.length = 0; this.world.draw(sim, 1 / 60, i / 60); }
    }
  }

  /** Debug: ?press=KeyD,KeyD,KeyW dispatches real keyboard events, one every 350 ms. */
  private scriptedKeys() {
    (this.params.get('press') ?? '').split(',').filter(Boolean).forEach((code, i) => {
      this.time.delayedCall(500 + i * 350, () => window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })));
    });
  }

  private seed() {
    return this.params.has('seed') ? Number(this.params.get('seed')) : (Date.now() & 0x7fffffff);
  }

  private snapCamera() {
    this.cam.x = this.sim.x;
    this.cam.y = this.sim.groundY + this.cam.height;
  }

  /** Who rides. Only Mach is production; ?rider=brute and ?rider=lynn are temporary test modes. */
  private character(): CharacterId {
    const r = this.params.get('rider');
    return r === 'brute' || r === 'lynn' ? r : 'mach';
  }

  startRun() {
    const character = this.character();
    this.sim = new Sim({ seed: this.seed(), god: this.params.has('god'), character });
    this.mode = 'run';
    this.acc = 0;
    this.snapCamera();
    this.world.reset(character);
    this.events.emit('mode', this.mode);
    if (character === 'brute') this.events.emit('toast', 'BRUTE (TEST RIG) — S = SMASH, E = SCRAP', '#7cc0ff');
    if (character === 'lynn') this.events.emit('toast', 'LYNN (TEST RIG) — S = REPELLENT, E = FULL HEAL', '#7dffb0');
  }

  private onIntent(i: Intent) {
    if (this.mode === 'run') this.sim.intent(i);
  }

  /** Space / Enter / tap. During a run a tap is the secondary ability (Scrap / Full Heal). */
  private onConfirm(tap = false) {
    if (this.mode === 'run' && tap) { this.sim.intent('ability'); return; }
    if (this.mode === 'title') this.startRun();
    else if (this.mode === 'over' && this.clock - this.overAt > 0.9) this.startRun();
  }

  override update(_t: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 100) / 1000;
    this.clock += dt;
    this.acc += dt;
    while (this.acc >= STEP) { this.sim.step(STEP); this.acc -= STEP; }
    for (const e of this.sim.events) this.present(e);
    this.sim.events.length = 0;
    this.world.draw(this.sim, dt, this.clock);
  }

  /** Turn simulation events into feedback. */
  private present(e: SimEvent) {
    const main = this.cameras.main;
    switch (e.type) {
      case 'pickup': {
        const p = this.cam.project(e.x, e.y + 0.9, e.z, this.scratch);
        const tint = e.kind === 'coin' ? 0xffd35a : 0xff9a2a;
        const ring = this.add.image(p.x, p.y, 'spark').setDepth(25).setTint(tint).setScale(0.25).setBlendMode(Phaser.BlendModes.ADD);
        this.tweens.add({ targets: ring, scale: e.kind === 'coin' ? 0.9 : 1.6, alpha: 0, duration: 260, ease: 'Cubic.easeOut', onComplete: () => ring.destroy() });
        break;
      }
      case 'hit':
        main.shake(220, 0.012);
        main.flash(160, 255, 60, 40);
        break;
      case 'blocked':
        main.shake(70, 0.003);
        break;
      case 'denied': {
        const msg = e.ability === 'smash'
          ? (e.reason === 'noTarget' ? 'NOTHING TO SMASH' : `SMASH NEEDS ${TUNING.smash.cost} MOMENTUM`)
          : e.ability === 'phantomDrive' ? ({ active: 'PHANTOM ALREADY ACTIVE', cooldown: 'PHANTOM COOLING DOWN', surge: 'NO PHANTOM DURING SURGE', chasm: 'NO PHANTOM NEAR A CHASM' } as Record<string, string>)[e.reason ?? ''] ?? `PHANTOM NEEDS ${TUNING.phantom.cost} MOMENTUM`
          : e.ability === 'scrap' ? (e.reason === 'active' ? 'SCRAP ALREADY ACTIVE' : 'SCRAP NEEDS 1 DEF')
          : e.ability === 'fullHeal' ? (e.reason === 'hpFull' ? 'HP ALREADY FULL' : `FULL HEAL NEEDS ${TUNING.fullHeal.cost} MOMENTUM`)
          : e.ability === 'mutagenRepellent' ? (e.reason === 'noTarget' ? 'NOTHING TO REPEL' : `REPELLENT NEEDS ${TUNING.repellent.cost} MOMENTUM`)
          : e.ability === 'surgeJump' ? (e.reason === 'phantom' ? 'NO SURGE DURING PHANTOM' : e.reason === 'airborne' ? 'SURGE FROM THE GROUND' : 'SURGE NEEDS FULL MOMENTUM')
          : e.ability === 'airJump' ? `DOUBLE JUMP NEEDS ${TUNING.jump.airCost} MOMENTUM` : 'NOT ENOUGH MOMENTUM';
        this.events.emit('toast', msg, '#ff8a7a');
        break;
      }
      case 'smash':
        main.shake(260, 0.016);
        main.flash(120, 90, 160, 255);
        this.world.onSmash(this.sim, e.z, e.lanes ?? []);
        this.events.emit('toast', 'SMASH!', '#7cc0ff');
        break;
      case 'phantom':
        main.flash(110, 200, 120, 255);
        this.events.emit('toast', 'PHANTOM DRIVE!', '#d6a8ff');
        break;
      case 'phantomPause':
        this.events.emit('toast', 'PHANTOM PAUSED — CHASM', '#d6a8ff');
        break;
      case 'blink':
        this.world.onBlink(this.sim, e.x0 ?? e.x, e.x, e.y, e.z);
        break;
      case 'regen':
        this.events.emit('toast', '+1 HP', '#7dffb0');
        break;
      case 'scrap':
        main.shake(160, 0.01);
        main.flash(110, 90, 160, 255);
        this.events.emit('toast', 'SCRAP!  DOUBLE CHAIN', '#7cc0ff');
        break;
      case 'heal':
        main.flash(140, 90, 255, 140);
        this.events.emit('toast', 'FULL HEAL!', '#7dffb0');
        break;
      case 'repel':
        main.flash(120, 90, 255, 140);
        this.world.onRepel(this.sim);
        this.events.emit('toast', 'REPELLENT!', '#7dffb0');
        break;
      case 'crash':
        main.shake(380, 0.022);
        main.flash(200, 255, 60, 40);
        if (e.hazard === 'mutantSpill') this.events.emit('toast', 'GRABBED!', '#ff8a7a');
        break;
      case 'jump':
        this.world.onJump(e.jump ?? 'normal', this.sim);
        if (e.jump === 'surge') { main.shake(180, 0.008); main.flash(140, 60, 190, 255); this.events.emit('toast', 'SURGE JUMP!', '#5fd8ff'); }
        break;
      case 'land':
        this.world.onLand(e.impact ?? 8, e.jump ?? 'normal', this.sim);
        if ((e.impact ?? 0) > 11) main.shake(140, 0.007);
        break;
      case 'cross':
        if (e.hazard !== 'chasm') { if (!e.ability) this.events.emit('toast', 'THROUGH THE GAP', '#7dffb0'); }
        else this.events.emit('toast', e.jump === 'surge' ? 'CHASM CLEARED — SURGE!' : 'CHASM CLEARED', '#7dffb0');
        break;
      case 'fall':
        main.shake(260, 0.01);
        break;
      case 'dead':
        this.mode = 'over';
        this.overAt = this.clock;
        this.events.emit('mode', this.mode);
        break;
      case 'route':
        this.events.emit('route', e.role);
        break;
    }
  }
}
