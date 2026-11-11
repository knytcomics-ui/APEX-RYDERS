/**
 * The only seam between the menu layer and the game. It drives the existing scenes from
 * the outside, using what they already expose (startRun, the 'mode' event, the debug
 * `rider` flag, Phaser's own scene pause / visibility / keyboard switches). No gameplay
 * file is modified to support the menus.
 */
import Phaser from 'phaser';
import type { CharacterId } from '../core/config';
import type { GameScene, Mode } from '../scenes/GameScene';
import { Sim } from '../sim/sim';

/** GameScene internals the bridge reaches into, typed here so the cast is in one place. */
interface GameInternals {
  params: URLSearchParams;
  world: { reset(c?: CharacterId): void };
  snapCamera(): void;
  acc: number;
}

export interface RunStats { score: number; dist: number; coins: number }

export class GameBridge {
  constructor(private game: Phaser.Game) {}

  /** Resolves once the game and HUD scenes are up (i.e. Boot has finished loading). */
  ready(onProgress?: (p: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const boot = this.game.scene.getScene('boot');
      boot?.load?.on('progress', (p: number) => onProgress?.(p));
      const check = () => {
        if (this.game.scene.isActive('game') && this.game.scene.isActive('hud')) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  private get gs() { return this.game.scene.getScene('game') as GameScene; }
  private get internals() { return this.gs as unknown as GameInternals; }

  get mode(): Mode { return this.gs.mode; }
  onMode(cb: (m: Mode) => void) { this.gs.events.on('mode', cb); }

  /** HUD is the in-run layer; menus replace the title / game-over overlays it would draw. */
  hud(visible: boolean) { this.game.scene.getScene('hud')?.sys.setVisible(visible); }

  /** The game's own keyboard handling (Space / Enter start a run) is off while a menu is up. */
  gameKeys(on: boolean) {
    const kb = this.gs.input.keyboard;
    if (kb) kb.enabled = on;
  }

  /** Start an Endless run as the chosen class (via the game's existing `rider` flag). */
  start(cls: CharacterId) {
    const p = this.internals.params;
    if (cls === 'mach') p.delete('rider'); else p.set('rider', cls);
    this.resume();
    this.hud(true);
    this.gameKeys(true);
    this.gs.startRun();
  }

  pause() { this.game.scene.pause('game'); this.game.scene.pause('hud'); }
  resume() {
    if (this.game.scene.isPaused('game')) this.game.scene.resume('game');
    if (this.game.scene.isPaused('hud')) this.game.scene.resume('hud');
  }
  get paused() { return this.game.scene.isPaused('game'); }

  /** Back to the title cruise behind the menus: a fresh attract-mode ride, exactly as on boot. */
  toTitle() {
    this.resume();
    const gs = this.gs, inn = this.internals;
    gs.sim = new Sim({ seed: Date.now() & 0x7fffffff, attract: true });
    inn.world.reset('mach');
    inn.acc = 0;
    inn.snapCamera();
    gs.mode = 'title';
    gs.events.emit('mode', 'title');
    this.hud(false);
    this.gameKeys(false);
  }

  stats(): RunStats {
    const s = this.gs.sim;
    return { score: s.score, dist: Math.floor(s.distance), coins: s.coins };
  }
}
