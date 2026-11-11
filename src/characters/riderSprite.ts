import Phaser from 'phaser';
import { RigPainter, type RigPose, type V3 } from './rigPainter';
import { LIVERIES, NEUTRAL_POSE, REAR_CONTACT, paintMach, type Livery, type MachPose } from './mach/machRig';

export interface RiderView {
  yaw: number;
  roll: number;
  pitch: number;
  pose?: Partial<MachPose>;
}

/**
 * Renders the rider rig into a canvas texture whenever its view or pose changes.
 * The texture is used by an ordinary Phaser image, anchored at the point where
 * the rig's origin (ground, mid-wheelbase) sits.
 */
export class RiderSprite {
  static readonly W = 430; // wide enough for a full drift lean
  static readonly H = 400;
  static readonly OX = 215;
  static readonly OY = 306;
  /** Texture pixels per model metre. */
  static readonly PPM = 130;
  /** Camera elevation the rig is drawn from: a little flatter than the chase camera, as in the reference art. */
  static readonly ELEVATION = 0.42;

  readonly texture: Phaser.Textures.CanvasTexture;
  private painter: RigPainter;
  private ctx: CanvasRenderingContext2D;
  private last = '';
  private cooldown = 0;
  private livery: Livery = LIVERIES.mach;

  constructor(scene: Phaser.Scene, readonly key: string) {
    // A CPU-backed canvas (willReadFrequently): uploading a GPU-accelerated canvas to a
    // WebGL texture every frame stalls badly on integrated graphics.
    const canvas = document.createElement('canvas');
    canvas.width = RiderSprite.W;
    canvas.height = RiderSprite.H;
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.texture = scene.textures.addCanvas(key, canvas)!;
    this.painter = new RigPainter(this.ctx, RiderSprite.PPM, RiderSprite.OX, RiderSprite.OY, RiderSprite.ELEVATION);
  }

  /** Texture-pixel offset from the sprite origin of a model-space point, for the pose last rendered. */
  anchor(p: V3) {
    const v = this.painter.project(p);
    return { x: v.x - RiderSprite.OX, y: v.y - RiderSprite.OY };
  }

  setLivery(l: Livery) {
    if (l === this.livery) return;
    this.livery = l;
    this.last = '';
    this.cooldown = 0;
  }

  /** Redraws only when something visibly changed. */
  render(view: RiderView) {
    const pose: MachPose = { ...NEUTRAL_POSE, ...view.pose };
    const q = (v: number, step: number) => Math.round(v / step);
    const sig = `${q(view.yaw, 0.02)},${q(view.roll, 0.02)},${q(view.pitch, 0.02)},${q(pose.tuck, 0.04)},${q(pose.steer, 0.03)},${q(pose.suspension, 0.08)},${q(pose.hang, 0.06)},${q(pose.knee, 0.1)},${q(pose.stand, 0.06)}`;
    if (sig === this.last) { this.cooldown = 0; return; }
    // texture uploads are the expensive part: redraw at most every other frame while animating
    if (this.cooldown > 0) { this.cooldown--; return; }
    this.cooldown = 1;
    this.last = sig;
    const rig: RigPose = { yaw: view.yaw, roll: view.roll, pitch: view.pitch, pitchPivot: REAR_CONTACT };
    this.ctx.clearRect(0, 0, RiderSprite.W, RiderSprite.H);
    this.painter.begin(rig);
    paintMach(this.painter, pose, this.livery);
    this.painter.end();
    this.texture.refresh();
  }
}
