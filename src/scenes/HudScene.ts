import Phaser from 'phaser';
import { TUNING, clamp } from '../core/config';
import { UI_FONT } from '../render/textures';
import type { Role } from '../world/sections';
import type { GameScene, Mode } from './GameScene';

const NAVY = 0x141a33;
const TAB = 0x232c55;
const RIM = 0x5563a8;
const CYAN = 0x38e1ff;
const AMBER = 0xffb020;

/**
 * HUD + title / game-over overlays, styled after the supplied gameplay reference:
 * slanted navy panels with a label tab. HP and DEF are pips (never numbers) and the
 * chain multiplier is the dominant figure.
 */
export class HudScene extends Phaser.Scene {
  private game_!: GameScene;
  private g!: Phaser.GameObjects.Graphics;
  private logo!: Phaser.GameObjects.Image;
  private titleLogo!: Phaser.GameObjects.Image;
  private coinIcon!: Phaser.GameObjects.Image;
  private boltIcon!: Phaser.GameObjects.Image;
  private t: Record<string, Phaser.GameObjects.Text> = {};
  private u = 1;
  private mode: Mode = 'title';
  private toastUntil = 0;
  private shownChain = 1;
  private shown = { dist: -1, coins: -1, score: -1, distAt: 0 };

  constructor() { super('hud'); }

  create() {
    this.game_ = this.scene.get('game') as GameScene;
    this.g = this.add.graphics();
    this.logo = this.add.image(0, 0, 'logo').setOrigin(0, 0);
    this.titleLogo = this.add.image(0, 0, 'logo').setOrigin(0.5);
    this.coinIcon = this.add.image(0, 0, 'coin').setDepth(2);
    this.boltIcon = this.add.image(0, 0, 'momentum_small').setDepth(2);
    const text = (key: string, color = '#ffffff', ox = 0, oy = 0) => {
      this.t[key] = this.add.text(0, 0, '', { fontFamily: UI_FONT, fontStyle: 'italic', color, stroke: '#0b1024', strokeThickness: 4 }).setOrigin(ox, oy).setDepth(1);
    };
    text('distLabel'); text('dist'); text('coinLabel'); text('coins', '#ffd35a');
    text('scoreLabel'); text('score', '#ffffff', 1, 0); text('chain', '#ffb020', 1, 0); text('chainLabel'); text('status', '#7cc0ff', 1, 0.5);
    text('hp', '#ff7a6e'); text('def', '#7cc0ff');
    text('prompt', '#ffffff', 0.5, 0.5); text('toast', '#ffffff', 0.5, 0.5);
    text('big', '#ffb020', 0.5, 0.5); text('sub', '#ffffff', 0.5, 0.5); text('hint', '#cfd8ff', 0.5, 0.5); text('stats', '#ffffff', 0.5, 0.5);
    this.t.toast.setAlpha(0);

    this.game_.events.on('mode', (m: Mode) => {
      this.mode = m;
      // a run starting or ending wipes any temporary notice (e.g. GRABBED!) so it can't sit on
      // the game-over headline or carry into the next run; toasts emitted after this still show
      if (m === 'over' || m === 'run') { this.t.toast.setAlpha(0); this.toastUntil = 0; }
      this.layout();
    });
    this.game_.events.on('route', (role: Role) => {
      this.t.toast.setText(role === 'risky' ? 'SHORTCUT!  MORE MOMENTUM' : 'SAFE ROUTE').setColor(role === 'risky' ? '#ffb020' : '#7dffb0').setAlpha(1);
      this.toastUntil = this.time.now + 1500;
    });
    this.game_.events.on('toast', (text: string, color: string) => {
      this.t.toast.setText(text).setColor(color).setAlpha(1);
      this.toastUntil = this.time.now + 1300;
    });
    this.mode = this.game_.mode;
    this.scale.on('resize', () => this.layout());
    this.layout();
  }

  // Panel geometry, shared by layout() and update().
  private get pad() { return 12 * this.u; }
  private get leftTop() { return this.pad + 66 * this.u; }

  private layout() {
    const { width: W, height: H } = this.scale;
    const u = (this.u = clamp(Math.min(W / 560, H / 640), 0.6, 1.4));
    const size = (key: string, px: number) => this.t[key].setFontSize(Math.round(px * u)).setStroke('#0b1024', Math.max(2, 4 * u));
    const playing = this.mode !== 'title';
    const pad = this.pad, top = this.leftTop;

    this.logo.setDisplaySize(168 * u, (168 * u * this.logo.height) / this.logo.width).setPosition(pad, pad * 0.6).setVisible(playing);
    size('distLabel', 11).setPosition(pad + 12 * u, top + 2 * u).setText('DISTANCE');
    size('dist', 22).setPosition(pad + 14 * u, top + 20 * u);
    size('coinLabel', 11).setPosition(pad + 12 * u, top + 60 * u).setText('COINS');
    size('coins', 22).setPosition(pad + 46 * u, top + 78 * u);
    this.coinIcon.setPosition(pad + 27 * u, top + 92 * u).setDisplaySize(28 * u, 28 * u).setVisible(playing);

    const rx = W - pad;
    size('chainLabel', 11).setPosition(rx - 138 * u, pad + 2 * u).setText('CHAIN');
    size('chain', 50).setPosition(rx - 14 * u, pad + 14 * u);
    size('scoreLabel', 11).setPosition(rx - 138 * u, pad + 84 * u).setText('SCORE');
    size('score', 22).setPosition(rx - 14 * u, pad + 102 * u);
    size('status', 13).setPosition(rx - 14 * u, pad + 139 * u);

    size('hp', 13).setPosition(pad + 12 * u, H - pad - 56 * u).setText('HP');
    size('def', 13).setPosition(pad + 12 * u, H - pad - 28 * u).setText('DEF');
    const bw = Math.min(W * 0.46, 300 * u);
    // centred, but never underneath the HP/DEF panel on narrow (portrait) screens
    const bcx = Math.max(W / 2, pad + 196 * u + bw / 2);
    this.boltIcon.setPosition(bcx - bw / 2 - 4 * u, H - pad - 19 * u).setDisplaySize(44 * u, 44 * u).setVisible(playing);
    size('prompt', 20).setPosition(W / 2, this.bannerY());
    size('toast', 26).setPosition(W / 2, H * 0.29);

    for (const k of ['distLabel', 'dist', 'coinLabel', 'coins', 'chainLabel', 'chain', 'scoreLabel', 'score', 'hp', 'def', 'prompt']) this.t[k].setVisible(playing);

    const title = this.mode === 'title', over = this.mode === 'over';
    const lw = Math.min(W * 0.82, 600 * u);
    this.titleLogo.setVisible(title).setPosition(W / 2, H * 0.3).setDisplaySize(lw, (lw * this.titleLogo.height) / this.titleLogo.width);
    // cause-specific game-over headline, shrunk to fit narrow screens
    const cause = this.game_.sim?.deathCause;
    const headline = cause === 'chasm' ? 'FELL INTO THE CHASM!' : cause === 'pillars' ? 'HIT THE PILLARS!' : cause === 'mutantSpill' ? 'GRABBED BY THE MUTANT SPILL!'
      : cause === 'crate' ? 'WRECKED BY A CRATE!' : cause === 'barricade' ? 'WRECKED BY A BARRICADE!' : 'WRECKED!';
    size('big', 60).setPosition(W / 2, H * 0.36).setText(headline).setVisible(over);
    if (this.t.big.width > W * 0.92) this.t.big.setFontSize(Math.floor(60 * u * (W * 0.92) / this.t.big.width));
    size('stats', 22).setPosition(W / 2, H * 0.5).setVisible(over).setAlign('center');
    size('sub', 24).setPosition(W / 2, title ? H * 0.8 : H * 0.66).setText(title ? 'PRESS SPACE  /  TAP TO RIDE' : 'PRESS SPACE  /  TAP TO RIDE AGAIN').setVisible(title || over);
    size('hint', 14).setPosition(W / 2, H * 0.8 + 40 * u).setAlign('center')
      .setText('A / D  lanes     W / SPACE  jump  (again in the air: Double Jump)     S  ability (Mach: Surge Jump)     E  2nd ability\nMobile: swipe left / right, up to jump, down for S ability, tap for E ability').setVisible(title);
  }

  /**
   * Where hazard and route banners sit: landscape — in the sky just above the horizon, so the
   * road where distant hazards appear stays clear; portrait — at the bottom, above the HP and
   * Momentum panels, over road the rider has already passed.
   */
  private bannerY() {
    const { width: W, height: H } = this.scale, u = this.u;
    if (W >= H) return Math.max(this.pad + 22 * u, ((this.registry.get('horizonY') as number | undefined) ?? H * 0.12) - 32 * u);
    return H - this.pad - 64 * u - 34 * u;
  }

  private slab(x: number, y: number, w: number, h: number, color = NAVY, alpha = 0.9, rim = 0) {
    const sk = h * 0.2, g = this.g;
    g.fillStyle(color, alpha);
    g.beginPath(); g.moveTo(x + sk, y); g.lineTo(x + w, y); g.lineTo(x + w - sk, y + h); g.lineTo(x, y + h); g.closePath(); g.fillPath();
    if (rim) { g.lineStyle(Math.max(1.5, 2 * this.u), rim, 0.9); g.strokePath(); }
  }

  /** Reference-style panel: small label tab sitting on a rimmed navy body. */
  private panel(x: number, y: number, w: number, h: number, tabW: number) {
    const u = this.u;
    this.slab(x + 2 * u, y, tabW, 20 * u, TAB, 0.95);
    this.slab(x, y + 17 * u, w, h, NAVY, 0.9, RIM);
  }

  override update(time: number) {
    const sim = this.game_.sim;
    const { width: W, height: H } = this.scale;
    const u = this.u, g = this.g, pad = this.pad;
    g.clear();

    if (this.mode === 'title') {
      g.fillStyle(0x0b1024, 0.35); g.fillRect(0, 0, W, H);
      this.t.sub.setAlpha(0.65 + 0.35 * Math.sin(time / 260));
      return;
    }

    // left: distance + coins
    const top = this.leftTop;
    this.panel(pad, top, 156 * u, 34 * u, 84 * u);
    this.panel(pad, top + 58 * u, 156 * u, 34 * u, 62 * u);
    // re-rasterising text is costly: only when the number actually changes
    const dist = Math.floor(sim.distance), shown = this.shown;
    // the distance readout refreshes ten times a second, not every metre
    if (dist !== shown.dist && (time - shown.distAt > 100 || !sim.alive)) { shown.dist = dist; shown.distAt = time; this.t.dist.setText(`${dist.toLocaleString()} m`); }
    if (sim.coins !== shown.coins) { shown.coins = sim.coins; this.t.coins.setText(sim.coins.toLocaleString()); }

    // right: chain multiplier — the dominant figure — with score beneath
    const rx = W - pad;
    this.panel(rx - 146 * u, pad, 146 * u, 60 * u, 62 * u);
    this.panel(rx - 146 * u, pad + 82 * u, 146 * u, 34 * u, 62 * u);
    const chain = sim.scoreChain; // doubled while Scrap is active
    this.t.chain.setText(`x${chain}`);
    if (chain !== this.shownChain) {
      if (chain > this.shownChain) this.tweens.add({ targets: this.t.chain, scale: { from: 1.35, to: 1 }, duration: 220, ease: 'Back.easeOut' });
      this.shownChain = chain;
    }
    // temporary ability status line under the score: Scrap (Brute), Phantom Drive (Mach)
    let status: [string, number, number] | null = null; // text, colour, bar fraction
    if (sim.scrapT > 0) status = [`SCRAP x2  ${sim.scrapT.toFixed(1)}s`, 0x7cc0ff, sim.scrapT / TUNING.scrap.duration];
    else if (sim.phantomT > 0) status = sim.phantomHold ? ['PHANTOM PAUSED', 0xd6a8ff, sim.phantomT / TUNING.phantom.duration] : [`PHANTOM  ${sim.phantomT.toFixed(1)}s`, 0xd6a8ff, sim.phantomT / TUNING.phantom.duration];
    else if (sim.phantomCd > 0) status = [`PHANTOM READY IN ${sim.phantomCd.toFixed(1)}s`, 0x8a8fb8, 1 - sim.phantomCd / TUNING.phantom.cooldown];
    if (status && this.mode === 'run') {
      const sy = pad + 140 * u;
      this.slab(rx - 146 * u, sy - 13 * u, 146 * u, 26 * u, 0x1a1f45, 0.92, status[1]);
      this.slab(rx - 140 * u, sy + 8 * u, 134 * u * status[2], 3 * u, status[1], 1);
      this.t.status.setText(status[0]).setColor('#' + status[1].toString(16).padStart(6, '0')).setVisible(true);
    } else this.t.status.setVisible(false);
    if (sim.score !== shown.score) { shown.score = sim.score; this.t.score.setText(sim.score.toLocaleString()); }

    // HP / DEF pips
    this.slab(pad, H - pad - 64 * u, 142 * u, 64 * u, NAVY, 0.9, RIM);
    const pip = (row: number, count: number, max: number, color: number) => {
      const y = H - pad - (row === 0 ? 55 : 27) * u;
      for (let i = 0; i < max; i++) {
        const x = pad + 54 * u + i * 34 * u, on = i < count;
        this.slab(x - 2 * u, y - 2 * u, 32 * u, 21 * u, 0x0b1024, 1);
        this.slab(x, y, 28 * u, 17 * u, on ? color : 0x333a5c, 1);
        if (on) this.slab(x + 4 * u, y + 2 * u, 18 * u, 5 * u, 0xffffff, 0.35);
      }
    };
    pip(0, sim.hp, TUNING.survival.hp, 0xff4a3d);
    pip(1, sim.def, TUNING.survival.def, 0x3f9dff);

    // momentum bar
    const bw = Math.min(W * 0.46, 300 * u), bh = 20 * u, bx = Math.max(W / 2, pad + 196 * u + bw / 2) - bw / 2 + 22 * u, by = H - pad - 29 * u;
    this.slab(bx - 44 * u, by - 9 * u, bw + 40 * u, bh + 18 * u, NAVY, 0.9, RIM);
    const segs = 10, full = sim.momentum >= TUNING.momentum.max, sw = (bw - 22 * u) / segs;
    for (let i = 0; i < segs; i++) {
      const on = sim.momentum >= (i + 1) * (TUNING.momentum.max / segs);
      const pulse = full ? 0.75 + 0.25 * Math.sin(time / 90) : 1;
      this.slab(bx + i * sw, by, sw - 3 * u, bh, on ? (full ? AMBER : CYAN) : 0x29305a, on ? pulse : 1);
      if (on) this.slab(bx + i * sw + 4 * u, by + 2 * u, sw - 11 * u, 5 * u, 0xffffff, 0.35);
    }

    // route-choice prompt
    // lethal hazard warning: where the safe passage is, and whether the signature ability is ready
    const warn = this.mode === 'run' ? sim.hazardAhead() : null;
    const fork = !warn && this.mode === 'run' ? sim.forkAhead() : null;
    if (warn) {
      const o = warn.laneOffset;
      const kind = warn.hazard.kind;
      const passage = kind === 'chasm' ? 'RAMP' : 'GAP';
      const name = kind === 'chasm' ? 'CHASM!' : kind === 'pillars' ? 'PILLARS!' : 'MUTANT!';
      const counter = warn.ability === 'surgeJump' ? 'SURGE' : warn.ability === 'smash' ? 'SMASH' : 'REPEL';
      const where = o < 0 ? `${'◀'.repeat(Math.min(3, -o))} ${passage}` : o > 0 ? `${passage} ${'▶'.repeat(Math.min(3, o))}` : `▲ ${passage} AHEAD ▲`;
      this.t.prompt.setText(`${name}   ${where}${warn.bypassReady ? `    or  S = ${counter}` : ''}`).setVisible(true);
      const py = this.bannerY(); this.t.prompt.setY(py);
      const w = this.t.prompt.width + 50 * u, pulse = 0.75 + 0.25 * Math.sin(time / 70);
      this.slab(W / 2 - w / 2, py - 21 * u, w, 42 * u, 0x3a0f1c, 0.94, 0xff4a3d);
      this.slab(W / 2 - w / 2 + 4 * u, py + 15 * u, w - 10 * u, 5 * u, o === 0 ? 0x2fd27a : 0xff4a3d, pulse);
    } else if (fork) {
      const left = fork.riskySide === 'left';
      this.t.prompt.setText(left ? '◀ SHORTCUT          SAFE ROUTE ▶' : '◀ SAFE ROUTE          SHORTCUT ▶').setVisible(true);
      const py = this.bannerY(); this.t.prompt.setY(py);
      const w = this.t.prompt.width + 50 * u;
      this.slab(W / 2 - w / 2, py - 21 * u, w, 42 * u, NAVY, 0.92, RIM);
      this.slab(W / 2 - w / 2 + 4 * u, py + 15 * u, w * 0.5 - 6 * u, 5 * u, left ? AMBER : 0x2fd27a, 1);
      this.slab(W / 2 + 2 * u, py + 15 * u, w * 0.5 - 6 * u, 5 * u, left ? 0x2fd27a : AMBER, 1);
    } else this.t.prompt.setVisible(false);

    if (this.t.toast.alpha > 0 && time > this.toastUntil) this.t.toast.setAlpha(Math.max(0, this.t.toast.alpha - 0.05));

    if (this.mode === 'over') {
      g.fillStyle(0x0b1024, 0.6); g.fillRect(0, 0, W, H);
      this.t.stats.setText(`BEST CHAIN SCORE  ${sim.score.toLocaleString()}\nDISTANCE  ${Math.floor(sim.distance).toLocaleString()} m     COINS  ${sim.coins}`);
      this.t.sub.setAlpha(0.65 + 0.35 * Math.sin(time / 260));
    }
  }
}
