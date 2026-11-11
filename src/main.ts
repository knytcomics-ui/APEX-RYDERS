import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { HudScene } from './scenes/HudScene';
import { RiderLabScene } from './scenes/RiderLabScene';
import { Sim } from './sim/sim';
import { STEP, TUNING } from './core/config';
import { CHASM, MUTANT, PILLARS } from './world/hazards';
import { mountUI } from './ui/menu';
import './ui/ui.css';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0b1024',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  render: { antialias: true, powerPreference: 'high-performance' },
  scene: [BootScene, GameScene, HudScene, RiderLabScene],
});

// Front-end menus around the run (skipped for the debug / test entry points).
const q = new URLSearchParams(location.search);
if (!q.has('autostart') && !q.has('lab') && !q.has('nomenu')) mountUI(game);
else document.getElementById('boot-splash')?.remove(); // debug entries show the game's own loader

// Handy for debugging from the browser console.
(window as unknown as { apex: Phaser.Game }).apex = game;
// The simulation itself, so mechanics can be exercised headlessly (tools/mechanics-test.mjs).
(window as unknown as { apexSim: object }).apexSim = { Sim, STEP, TUNING, CHASM, PILLARS, MUTANT };
