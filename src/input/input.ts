import Phaser from 'phaser';
import type { Intent } from '../sim/sim';

/**
 * Maps keyboard and touch gestures to gameplay intents.
 * Desktop: A/D (or arrows) lanes, W/Space/Up jump, S/Down downward action.
 * Secondary ability: E (desktop) / tap (mobile, during a run).
 * Mobile: swipe left/right/up/down. A tap is reported via onConfirm(true).
 */
export class InputController {
  private startX = 0;
  private startY = 0;
  private tracking = false;
  private swiped = false;

  constructor(scene: Phaser.Scene, private onIntent: (i: Intent) => void, private onConfirm: (tap?: boolean) => void) {
    scene.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.code) {
        case 'KeyA': case 'ArrowLeft': this.onIntent('left'); break;
        case 'KeyD': case 'ArrowRight': this.onIntent('right'); break;
        case 'KeyW': case 'ArrowUp': this.onIntent('jump'); break;
        case 'Space': this.onIntent('jump'); this.onConfirm(); break;
        case 'KeyS': case 'ArrowDown': this.onIntent('down'); break;
        case 'KeyE': this.onIntent('ability'); break; // secondary ability (Scrap / Full Heal)
        case 'Enter': this.onConfirm(); break;
      }
    });

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.tracking = true;
      this.swiped = false;
      this.startX = p.x;
      this.startY = p.y;
    });
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.tracking) return;
      const dx = p.x - this.startX, dy = p.y - this.startY;
      const threshold = Math.max(22, Math.min(scene.scale.width, scene.scale.height) * 0.045);
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) this.onIntent(dx < 0 ? 'left' : 'right');
      else this.onIntent(dy < 0 ? 'jump' : 'down');
      // Re-anchor so one long drag can chain several lane changes.
      this.startX = p.x;
      this.startY = p.y;
      this.swiped = true;
    });
    scene.input.on('pointerup', () => {
      if (this.tracking && !this.swiped) this.onConfirm(true); // tap: start / restart, or the secondary ability mid-run
      this.tracking = false;
    });
  }
}
