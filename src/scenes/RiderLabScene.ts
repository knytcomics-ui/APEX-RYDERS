import Phaser from 'phaser';
import { RiderSprite, type RiderView } from '../characters/riderSprite';
import { UI_FONT } from '../render/textures';

/**
 * Inspection page for the rider rig: open /?lab=rider.
 * Top row: the three gameplay views. Bottom row: lean, pitch and pose checks,
 * next to the original single-image cut-out for comparison.
 */
export class RiderLabScene extends Phaser.Scene {
  constructor() { super('riderlab'); }

  create() {
    const { width: W, height: H } = this.scale;
    this.add.rectangle(0, 0, W, H, 0x4e4865).setOrigin(0);
    this.add.rectangle(0, H * 0.6, W, 3, 0x1a1430).setOrigin(0);

    const cell = (label: string, view: RiderView, x: number, y: number, scale: number) => {
      const key = `lab-${label}`;
      new RiderSprite(this, key).render(view);
      this.add.ellipse(x, y, 150 * scale, 56 * scale, 0x150d36, 0.35);
      this.add.image(x, y, key).setOrigin(RiderSprite.OX / RiderSprite.W, RiderSprite.OY / RiderSprite.H).setScale(scale);
      this.add.text(x, y + 60 * scale, label, { fontFamily: UI_FONT, fontStyle: 'italic', fontSize: `${Math.round(17 * Math.min(1, scale + 0.3))}px`, color: '#ffffff', stroke: '#0b1024', strokeThickness: 4 }).setOrigin(0.5, 0);
    };

    const top = H * 0.46, s1 = Math.min(W / 1300, H / 760) * 1.3;
    cell('REAR-LEFT VIEW', { yaw: 0.56, roll: 0, pitch: 0 }, W * 0.2, top, s1);
    cell('REAR VIEW', { yaw: 0, roll: 0, pitch: 0 }, W * 0.5, top, s1);
    cell('REAR-RIGHT VIEW', { yaw: -0.56, roll: 0, pitch: 0 }, W * 0.8, top, s1);

    const bottom = H * 0.9, s2 = s1 * 0.52;
    cell('LEAN LEFT', { yaw: -0.3, roll: -0.36, pitch: 0, pose: { hang: -0.6 } }, W * 0.1, bottom, s2);
    cell('LEAN RIGHT', { yaw: 0.3, roll: 0.36, pitch: 0, pose: { hang: 0.6 } }, W * 0.26, bottom, s2);
    cell('NOSE UP', { yaw: 0, roll: 0, pitch: 0.5 }, W * 0.42, bottom, s2);
    cell('DRIFT LEFT', { yaw: -0.52, roll: -0.44, pitch: 0, pose: { hang: -1, knee: -1, steer: 0.34, tuck: 0.4, suspension: 0.4 } }, W * 0.58, bottom, s2);
    cell('DRIFT RIGHT', { yaw: 0.52, roll: 0.44, pitch: 0, pose: { hang: 1, knee: 1, steer: -0.34, tuck: 0.4, suspension: 0.4 } }, W * 0.74, bottom, s2);

    // the previous single-image rider, for comparison
    const old = this.add.image(W * 0.91, bottom, 'mach_rider').setOrigin(0.5, 0.965);
    old.setScale((230 * s2) / old.height);
    this.add.text(W * 0.91, bottom + 60 * s2, 'OLD CUT-OUT', { fontFamily: UI_FONT, fontStyle: 'italic', fontSize: '13px', color: '#cfd8ff', stroke: '#0b1024', strokeThickness: 4 }).setOrigin(0.5, 0);
  }
}
