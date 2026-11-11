/**
 * A tiny cel-shaded 3D painter for character rigs.
 *
 * Rigs are described in model space (x right, y up, z forward, metres) out of convex
 * parts — capsules, ellipsoids, boxes, discs. Each part is projected for the current
 * pose and camera, filled flat with a lit tone and inked with a thick outline, then
 * all parts are depth-sorted. Because the model is truly 3D, rear / three-quarter
 * views, lean and pitch are real views of one consistent character — never a
 * stretched or rotated picture.
 */
export type V3 = [number, number, number];

export interface RigPose {
  yaw: number; // radians, + = nose swings right (camera sees the left flank)
  roll: number; // radians, + = leaning right
  pitch: number; // radians, + = nose up
  pitchPivot: V3; // usually the rear-wheel contact point
}

export interface Decal {
  pts: V3[];
  fill: string;
  normal?: V3; // only drawn when this faces the camera
  ink?: boolean; // outline the decal too
}

interface PartOpts {
  decals?: Decal[];
  bias?: number; // depth bias, + = draw later (nearer)
  facing?: V3; // skip the whole part unless this normal faces the camera
  flat?: boolean; // no cel highlight
  inkScale?: number;
}

interface Item { depth: number; run: () => void }
interface P2 { x: number; y: number }

export const INK = '#15102b';

const hull2 = (pts: P2[]): P2[] => {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  lower.pop(); upper.pop();
  return lower.concat(upper);
};

const shadeHex = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? c * k + 0x1c * (1 - k) * 0.6 : c + (255 - c) * (k - 1))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

export class RigPainter {
  private items: Item[] = [];
  private pose: RigPose = { yaw: 0, roll: 0, pitch: 0, pitchPivot: [0, 0, 0] };
  private cy = 1; private sy = 0; private cr = 1; private sr = 0; private cp = 1; private sp = 0;
  private ce: number; private se: number;
  /** Optional sub-assembly transform applied before the pose (e.g. a rider thrown off the bike). */
  local: ((p: V3) => V3) | null = null;

  constructor(private ctx: CanvasRenderingContext2D, private ppm: number, private ox: number, private oy: number, elevation: number) {
    this.ce = Math.cos(elevation); this.se = Math.sin(elevation);
  }

  begin(pose: RigPose) {
    this.pose = pose;
    this.items.length = 0;
    this.cy = Math.cos(pose.yaw); this.sy = Math.sin(pose.yaw);
    this.cr = Math.cos(pose.roll); this.sr = Math.sin(pose.roll);
    this.cp = Math.cos(pose.pitch); this.sp = Math.sin(pose.pitch);
  }

  /** Model space -> posed space (pitch about the pivot, roll about the ground line, yaw). */
  private rot(p: V3, translate: boolean): V3 {
    let [x, y, z] = p;
    const [, py, pz] = translate ? this.pose.pitchPivot : [0, 0, 0];
    const dy = y - py, dz = z - pz;
    y = py + dy * this.cp + dz * this.sp;
    z = pz - dy * this.sp + dz * this.cp;
    const x2 = x * this.cr + y * this.sr, y2 = -x * this.sr + y * this.cr;
    return [x2 * this.cy + z * this.sy, y2, -x2 * this.sy + z * this.cy];
  }

  /** Posed space -> canvas pixels + depth (larger = farther from the camera). */
  private view(p: V3): { x: number; y: number; d: number } {
    return { x: this.ox + p[0] * this.ppm, y: this.oy - (p[1] * this.ce + p[2] * this.se) * this.ppm, d: -p[1] * this.se + p[2] * this.ce };
  }

  project(p: V3) { return this.view(this.rot(this.local ? this.local(p) : p, true)); }

  private faces(normal: V3) {
    const n = this.rot(normal, false);
    return n[1] * this.se - n[2] * this.ce > 0.04; // dot with the direction toward the camera
  }

  private trace(poly: P2[]) {
    const c = this.ctx;
    c.beginPath();
    poly.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
    c.closePath();
  }

  /** Convex part from a 3D point cloud. */
  hull(points: V3[], fill: string, o: PartOpts = {}) {
    if (o.facing && !this.faces(o.facing)) return;
    let depth = 0;
    const flat: P2[] = [];
    for (const p of points) { const v = this.project(p); flat.push(v); depth += v.d; }
    const poly = hull2(flat);
    const decals = (o.decals ?? []).filter((d) => !d.normal || this.faces(d.normal)).map((d) => ({ d, poly: d.pts.map((p) => this.project(p)) }));
    const lw = this.ppm * 0.036 * (o.inkScale ?? 1);
    this.items.push({
      depth: depth / points.length - (o.bias ?? 0),
      run: () => {
        const c = this.ctx;
        this.trace(poly);
        c.fillStyle = o.flat ? fill : shadeHex(fill, 0.72);
        c.fill();
        c.save();
        c.clip();
        if (!o.flat) {
          // cel highlight: the lit tone, slid toward the sun (upper right)
          let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
          for (const q of poly) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
          const sx = Math.min((maxX - minX) * 0.16, this.ppm * 0.045), sy = Math.min((maxY - minY) * 0.12, this.ppm * 0.04);
          c.translate(sx, -sy);
          this.trace(poly);
          c.fillStyle = fill;
          c.fill();
          c.translate(-sx, sy);
        }
        for (const { d, poly: dp } of decals) {
          this.trace(dp);
          c.fillStyle = d.fill;
          c.fill();
          if (d.ink) { c.lineWidth = lw * 0.6; c.strokeStyle = INK; c.stroke(); }
        }
        c.restore();
        this.trace(poly);
        c.lineJoin = 'round';
        c.lineWidth = lw;
        c.strokeStyle = INK;
        c.stroke();
      },
    });
  }

  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, fill: string, o?: PartOpts) {
    const pts: V3[] = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push([x, y, z]);
    this.hull(pts, fill, o);
  }

  /** Ellipsoid, sampled. */
  ball(c: V3, r: number | V3, fill: string, o?: PartOpts) {
    const [rx, ry, rz] = typeof r === 'number' ? [r, r, r] : r;
    const pts: V3[] = [[c[0], c[1] + ry, c[2]], [c[0], c[1] - ry, c[2]]];
    for (let i = 1; i < 6; i++) {
      const lat = -Math.PI / 2 + (i / 6) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let j = 0; j < 12; j++) { const lon = (j / 12) * Math.PI * 2; pts.push([c[0] + Math.cos(lon) * cl * rx, c[1] + sl * ry, c[2] + Math.sin(lon) * cl * rz]); }
    }
    this.hull(pts, fill, o);
  }

  /** Tapered limb between two joints. */
  capsule(a: V3, b: V3, ra: number, rb: number, fill: string, o?: PartOpts) {
    const pts: V3[] = [];
    for (const [c, r] of [[a, ra], [b, rb]] as [V3, number][]) {
      for (let i = 0; i < 3; i++) {
        const lat = (i - 1) * 0.9, cl = Math.cos(lat) * r, sl = Math.sin(lat) * r;
        for (let j = 0; j < 8; j++) { const lon = (j / 8) * Math.PI * 2; pts.push([c[0] + Math.cos(lon) * cl, c[1] + sl, c[2] + Math.sin(lon) * cl]); }
      }
      pts.push([c[0], c[1] + r, c[2]], [c[0], c[1] - r, c[2]]);
    }
    this.hull(pts, fill, o);
  }

  /** Circle of points in the plane x = const (wheel faces, discs). */
  static ring(cx: number, cy: number, cz: number, r: number, n = 18): V3[] {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx, cy + Math.sin(a) * r, cz + Math.cos(a) * r]); }
    return pts;
  }

  /** Paint everything, farthest part first. */
  end() {
    this.items.sort((a, b) => b.depth - a.depth);
    for (const it of this.items) it.run();
  }
}
