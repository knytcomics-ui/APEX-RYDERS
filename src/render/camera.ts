import { LANES, LANE_W } from '../core/config';

export interface Pt { x: number; y: number; s: number }
export const pt = (): Pt => ({ x: 0, y: 0, s: 1 });

/**
 * Elevated chase camera: sits above and behind the rider, pitched down, never yaws.
 * Every world object (road, scenery, pickups, rider) goes through project(), so
 * they all share one perspective.
 */
export class Camera {
  x = 0; y = 8; z = 0;
  w = 1280; h = 720; cx = 640; cy = 360;
  focal = 648;
  sin = 0; cos = 1;
  height = 8; // above the rider's road surface
  back = 9.5; // behind the rider
  horizonY = 0;
  /** >1 when the camera had to pull back to fit the road (portrait). */
  pull = 1;

  resize(w: number, h: number) {
    this.w = w; this.h = h; this.cx = w / 2; this.cy = h / 2;
    const pitch = 0.4;
    this.sin = Math.sin(pitch); this.cos = Math.cos(pitch);
    this.focal = 0.9 * h;
    const baseH = 8, baseB = 9.5;
    const depth = baseH * this.sin + baseB * this.cos;
    const roadPx = (LANES * LANE_W * this.focal) / depth;
    // Portrait: pull the camera back along its view axis until the road fits the width.
    this.pull = Math.max(1, roadPx / (w * 1.02));
    this.height = baseH * this.pull;
    this.back = baseB * this.pull;
    this.horizonY = this.cy - (this.focal * this.sin) / this.cos;
  }

  project(x: number, y: number, z: number, o: Pt): Pt {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    let d = -dy * this.sin + dz * this.cos;
    if (d < 0.35) d = 0.35;
    const up = dy * this.cos + dz * this.sin;
    o.s = this.focal / d;
    o.x = this.cx + dx * o.s;
    o.y = this.cy - up * o.s;
    return o;
  }
}
