import Phaser from 'phaser';
import { buildTextures, UI_FONT } from '../render/textures';

export class BootScene extends Phaser.Scene {
  constructor() { super('boot'); }

  preload() {
    const { width, height } = this.scale;
    const text = this.add.text(width / 2, height / 2, 'LOADING…', { fontFamily: UI_FONT, fontSize: '28px', fontStyle: 'italic', color: '#ffb020' }).setOrigin(0.5);
    this.load.on('progress', (p: number) => text.setText(`LOADING ${Math.round(p * 100)}%`));
    this.load.setPath('assets');
    this.load.image('logo', 'logo.png');
    this.load.image('mach_rider', 'mach_rider.png');
    this.load.image('coin', 'coin.png');
    this.load.image('momentum_small', 'momentum_small.png');
    this.load.image('momentum_large', 'momentum_large.png');
  }

  create() {
    buildTextures(this);
    // /?lab=rider opens the rider-rig inspection page instead of the game
    if (new URLSearchParams(location.search).get('lab') === 'rider') { this.scene.start('riderlab'); return; }
    this.scene.start('game');
    this.scene.launch('hud');
  }
}
