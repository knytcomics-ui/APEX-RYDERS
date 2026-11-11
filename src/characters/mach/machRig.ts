import { RigPainter, type Decal, type V3 } from '../rigPainter';

/**
 * MACH and his approved motorcycle as a cel-shaded rig, modelled from the supplied
 * character sheet and garage sheet, in the compact arcade proportions of the
 * gameplay reference (big helmet, wide bars, fat rear tyre, short wheelbase).
 * Model space: x right, y up, z forward, origin on the ground between the wheels.
 */
const MACH_LIVERY = {
  red: '#ee2f1e',
  suit: '#232133',
  white: '#f6f4fa',
  tyre: '#2b2838',
  rim: '#9a96b3',
  metal: '#84809d',
  metalDark: '#5b5873',
  silver: '#cfccdd',
  gold: '#f4b21f',
  seat: '#2b2838',
  glove: '#2f2c3e',
  lamp: '#ffc93a',
  tail: '#ffb52e',
};
export type Livery = typeof MACH_LIVERY;
/** Colour schemes for the shared rig. Brute's is a temporary stand-in until his own model exists. */
export const LIVERIES: Record<'mach' | 'brute' | 'lynn', Livery> = {
  mach: MACH_LIVERY,
  brute: { ...MACH_LIVERY, red: '#2f86f0', gold: '#c9d2e8', tail: '#ffb52e' },
  lynn: { ...MACH_LIVERY, red: '#2fbf5a', gold: '#f6f4fa', tail: '#ffb52e' },
};
let C: Livery = MACH_LIVERY;

/** Body pose parameters (0 = neutral riding). */
export interface MachPose {
  tuck: number; // 0..1 crouch over the tank
  steer: number; // radians, handlebar turn
  suspension: number; // 0..1 compression
  hang: number; // -1..1 rider shifts weight left/right (drift / counterbalance)
  knee: number; // -1..1 the left/right knee comes off the tank, toward the road
  stand: number; // 0..1 rises off the seat (aerial posture)
}
export const NEUTRAL_POSE: MachPose = { tuck: 0, steer: 0, suspension: 0, hang: 0, knee: 0, stand: 0 };

const REAR_Z = -0.42, FRONT_Z = 0.5, TAIL_Z = -0.66;
/** Rear-wheel ground contact: the bike pitches about this point. */
export const REAR_CONTACT: V3 = [0, 0, REAR_Z];
export const FRONT_CONTACT: V3 = [0, 0, FRONT_Z];
/** Exhaust outlets in model space, for flame effects. */
export const EXHAUST_TIPS: V3[] = [[-0.27, 0.46, -0.57], [0.27, 0.46, -0.57]];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

function tyre(p: RigPainter, c: V3, r: number, w: number) {
  // rounded tread: narrower rings toward the shoulders
  const pts: V3[] = [];
  for (const [fx, fr] of [[0, 1], [0.3, 0.985], [-0.3, 0.985], [0.5, 0.9], [-0.5, 0.9]]) pts.push(...RigPainter.ring(c[0] + fx * w, c[1], c[2], r * fr, 20));
  const face = (side: number): Decal[] => [
    { pts: RigPainter.ring(side * w * 0.5, c[1], c[2], r * 0.66), fill: C.rim, normal: [side, 0, 0], ink: true },
    { pts: RigPainter.ring(side * w * 0.5, c[1], c[2], r * 0.44), fill: C.metalDark, normal: [side, 0, 0] },
    { pts: RigPainter.ring(side * w * 0.5, c[1], c[2], r * 0.17), fill: C.silver, normal: [side, 0, 0], ink: true },
  ];
  p.hull(pts, C.tyre, { decals: [...face(1), ...face(-1)] });
}

function bike(p: RigPainter, pose: MachPose) {
  const sag = pose.suspension * 0.07;
  const up = (y: number) => y - sag; // sprung parts sink on compression

  tyre(p, [0, 0.33, REAR_Z], 0.33, 0.3);
  tyre(p, [0, 0.3, FRONT_Z], 0.3, 0.18);

  // swingarm, engine
  p.box(-0.17, 0.17, 0.26, 0.4, REAR_Z, -0.05, C.metalDark);
  const cover = (s: number): Decal => ({ pts: [[s * 0.191, up(0.3), -0.1], [s * 0.191, up(0.56), -0.1], [s * 0.191, up(0.5), 0.25], [s * 0.191, up(0.3), 0.2]], fill: C.metalDark, normal: [s, 0, 0], ink: true });
  p.box(-0.19, 0.19, up(0.2), up(0.63), -0.2, 0.32, C.metal, { decals: [cover(1), cover(-1)] });

  // twin exhausts with dark outlets
  for (const s of [-1, 1]) {
    p.capsule([s * 0.21, up(0.36), -0.02], [s * 0.27, up(0.46), -0.48], 0.06, 0.088, C.silver);
    p.hull(RigPainter.ring(0, 0, 0, 0.058, 10).map(([, y, z]): V3 => [s * 0.27 + z, up(0.46) + y, -0.572]), '#1c1930', { facing: [0, 0, -1], flat: true, bias: 0.3, inkScale: 0.6 });
    p.capsule([s * 0.18, up(0.4), -0.1], [s * 0.33, up(0.4), -0.1], 0.032, 0.032, C.metalDark); // foot peg
  }

  // fuel tank with the black "A" side panels
  const panel = (s: number): Decal[] => {
    const x = s * 0.206;
    return [
      { pts: [[x, up(0.92), 0.0], [x, up(0.92), 0.32], [x, up(0.74), 0.26], [x, up(0.74), -0.06]], fill: C.suit, normal: [s, 0.2, 0], ink: true },
      { pts: [[x, up(0.89), 0.14], [x, up(0.77), 0.23], [x, up(0.77), 0.18], [x, up(0.82), 0.14], [x, up(0.77), 0.1], [x, up(0.77), 0.05]], fill: C.white, normal: [s, 0.2, 0] },
    ];
  };
  p.ball([0, up(0.82), 0.15], [0.21, 0.155, 0.27], C.red, { decals: [...panel(1), ...panel(-1)] });

  // seat + tail unit with the amber tail light
  p.box(-0.15, 0.15, up(0.72), up(0.81), -0.36, 0.0, C.seat);
  const tail: V3[] = [];
  for (const s of [-1, 1]) tail.push([s * 0.17, up(0.7), -0.26], [s * 0.21, up(0.86), -0.3], [s * 0.2, up(0.78), TAIL_Z + 0.02], [s * 0.2, up(0.95), TAIL_Z], [s * 0.1, up(0.72), TAIL_Z + 0.08]);
  const tz = TAIL_Z - 0.004;
  p.hull(tail, C.red, {
    decals: [
      { pts: [[-0.18, up(0.8), tz + 0.02], [0.18, up(0.8), tz + 0.02], [0.18, up(0.935), tz], [-0.18, up(0.935), tz]], fill: C.suit, normal: [0, 0.1, -1] },
      { pts: [[-0.15, up(0.825), tz + 0.016], [0.15, up(0.825), tz + 0.016], [0.15, up(0.915), tz], [-0.15, up(0.915), tz]], fill: C.tail, normal: [0, 0.1, -1], ink: true },
      { pts: [[-0.09, up(0.85), tz + 0.01], [0.09, up(0.85), tz + 0.01], [0.09, up(0.89), tz], [-0.09, up(0.89), tz]], fill: '#fff3b0', normal: [0, 0.1, -1] },
      { pts: [[-0.11, up(0.865), -0.3], [0.11, up(0.865), -0.3], [0.1, up(0.954), TAIL_Z + 0.04], [-0.1, up(0.954), TAIL_Z + 0.04]], fill: C.seat, normal: [0, 1, 0] },
    ],
  });
  p.box(-0.055, 0.055, up(0.6), up(0.74), TAIL_Z - 0.03, -0.5, C.suit); // plate hanger
  p.box(-0.17, 0.17, 0.63, 0.69, -0.62, -0.26, C.metalDark); // rear hugger

  // front end: forks, fender, headlight
  for (const s of [-1, 1]) {
    p.capsule([s * 0.11, 0.3, FRONT_Z], [s * 0.1, up(0.64), 0.43], 0.042, 0.042, C.silver);
    p.capsule([s * 0.1, up(0.64), 0.43], [s * 0.095, up(1.0), 0.35], 0.038, 0.038, C.gold);
  }
  p.box(-0.11, 0.11, 0.58, 0.65, 0.3, 0.7, C.red);
  p.ball([0, up(0.9), 0.47], [0.14, 0.13, 0.1], C.metalDark, {
    decals: [{ pts: RigPainter.ring(0, 0, 0, 0.09, 14).map(([, y, z]): V3 => [z, up(0.9) + y, 0.573]), fill: C.lamp, normal: [0, 0, 1], ink: true }],
  });

  // handlebar, chunky bar-end guards and mirrors
  const st = pose.steer;
  const bar = (x: number, y: number, z: number): V3 => [x * Math.cos(st) + (z - 0.35) * Math.sin(st), up(y), 0.35 - x * Math.sin(st) + (z - 0.35) * Math.cos(st)];
  p.capsule(bar(-0.46, 1.02, 0.35), bar(0.46, 1.02, 0.35), 0.034, 0.034, '#33303f');
  for (const s of [-1, 1]) {
    const g: V3[] = [];
    for (const x of [0.41, 0.57]) for (const y of [0.955, 1.085]) for (const z of [0.27, 0.43]) g.push(bar(s * x, y, z));
    p.hull(g, C.metal);
    p.capsule(bar(s * 0.36, 1.04, 0.37), bar(s * 0.47, 1.22, 0.34), 0.022, 0.022, C.metalDark);
    const m: V3[] = [];
    for (const x of [0.42, 0.6]) for (const y of [1.19, 1.3]) for (const z of [0.31, 0.37]) m.push(bar(s * x, y, z));
    p.hull(m, '#716d8c');
  }
  return bar;
}

function rider(p: RigPainter, pose: MachPose, bar: (x: number, y: number, z: number) => V3) {
  const sag = pose.suspension * 0.07, t = pose.tuck, hang = pose.hang * 0.1;
  const up = pose.stand;
  const hip: V3 = [hang * 0.5, 0.9 - sag + up * 0.17, -0.17 + up * 0.03];
  const chest: V3 = [hang, 1.3 - sag - t * 0.14 + up * 0.2, 0.08 + t * 0.12 + up * 0.05];
  const head: V3 = [hang * 1.1, 1.6 - sag - t * 0.2 + up * 0.22, 0.17 + t * 0.16 + up * 0.06];

  // spine frame for the back decals
  const sLen = Math.hypot(chest[1] - hip[1], chest[2] - hip[2]);
  const S: V3 = [0, (chest[1] - hip[1]) / sLen, (chest[2] - hip[2]) / sLen];
  const N: V3 = [0, S[2], -S[1]]; // out of the back
  const mid = mul(add(hip, chest), 0.5);
  const back = (u: number, v: number): V3 => add(add(mid, [u, 0, 0]), add(mul(S, v), mul(N, 0.135 + 0.02 * (1 - Math.abs(u) / 0.28))));

  // torso: waist ring -> shoulder ring
  const torso: V3[] = [];
  for (const [c, rx, rd] of [[add(hip, [0, 0.05, 0]), 0.19, 0.135], [mid, 0.24, 0.15], [chest, 0.28, 0.145]] as [V3, number, number][]) {
    for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; torso.push(add(c, add([Math.cos(a) * rx, 0, 0], mul(N, Math.sin(a) * rd)))); }
  }
  const flank = (s: number): Decal[] => [
    { pts: [back(s * 0.29, 0.24), back(s * 0.18, 0.24), back(s * 0.15, 0.03), back(s * 0.17, -0.17), back(s * 0.23, -0.17)], fill: C.red, normal: N },
    { pts: [back(s * 0.18, 0.22), back(s * 0.155, 0.22), back(s * 0.125, 0.03), back(s * 0.15, 0.03)], fill: C.white, normal: N },
    { pts: [back(s * 0.2, -0.03), back(s * 0.27, -0.03), back(s * 0.22, -0.16), back(s * 0.17, -0.16)], fill: C.white, normal: N },
  ];
  p.hull(torso, C.suit, {
    decals: [
      ...flank(1), ...flank(-1),
      // the white "A" on Mach's back
      { pts: [back(0, 0.2), back(0.1, 0.0), back(0.056, 0.0), back(0.036, 0.042), back(-0.036, 0.042), back(-0.056, 0.0), back(-0.1, 0.0)], fill: C.white, normal: N },
      { pts: [back(0, 0.135), back(0.024, 0.078), back(-0.024, 0.078)], fill: C.suit, normal: N },
      // belt
      { pts: [back(-0.2, -0.16), back(0.2, -0.16), back(0.2, -0.21), back(-0.2, -0.21)], fill: C.white, normal: N, ink: true },
      { pts: [back(-0.045, -0.165), back(0.045, -0.165), back(0.045, -0.205), back(-0.045, -0.205)], fill: C.metal, normal: N },
    ],
  });
  p.ball(hip, [0.19, 0.13, 0.16], C.suit);

  // helmet: dark shell, slim red crown stripe with white pinstripes, red cheek flashes
  const R: V3 = [0.225, 0.23, 0.245];
  const hp = (lon: number, lat: number): V3 => {
    const lo = (lon * Math.PI) / 180, la = (lat * Math.PI) / 180;
    return add(head, [Math.sin(lo) * Math.cos(la) * R[0] * 1.01, Math.sin(la) * R[1] * 1.01, -Math.cos(lo) * Math.cos(la) * R[2] * 1.01]);
  };
  const stripe = (w: number, fill: string): Decal => ({ pts: [hp(-w, -45), hp(w, -45), hp(w * 1.2, -5), hp(w * 1.1, 40), hp(w * 2.2, 78), hp(-w * 2.2, 78), hp(-w * 1.1, 40), hp(-w * 1.2, -5)], fill, normal: [0, 0.4, -1] });
  const cheek = (s: number): Decal => ({ pts: [hp(s * 48, -40), hp(s * 112, -32), hp(s * 124, 4), hp(s * 92, 0), hp(s * 62, -14)], fill: C.red, normal: [s, 0, -0.3] });
  const flash = (s: number): Decal => ({ pts: [hp(s * 50, 18), hp(s * 96, 30), hp(s * 100, 44), hp(s * 58, 36)], fill: C.white, normal: [s, 0.3, -0.3] });
  p.ball(add(head, [0, -0.22, -0.03]), [0.14, 0.07, 0.14], C.metalDark); // neck roll
  p.ball(head, R, C.suit, {
    decals: [
      stripe(19, C.white), stripe(13, C.red), cheek(1), cheek(-1), flash(1), flash(-1),
      // visor (seen once the view swings round to the front)
      { pts: [hp(125, -8), hp(180, -12), hp(-125, -8), hp(-118, 24), hp(180, 30), hp(118, 24)], fill: '#3b2f6e', normal: [0, 0, 1], ink: true },
    ],
    bias: 0.05,
  });

  // arms reach out to the bar-end grips
  for (const s of [-1, 1]) {
    const shoulder: V3 = [chest[0] + s * 0.28, chest[1] + 0.02, chest[2]];
    const hand = bar(s * 0.47, 1.05, 0.32);
    const elbow: V3 = [(shoulder[0] + hand[0]) / 2 + s * 0.07, (shoulder[1] + hand[1]) / 2 - 0.03 + t * 0.03, (shoulder[2] + hand[2]) / 2 - 0.05];
    p.ball(shoulder, 0.125, C.red);
    p.capsule(shoulder, elbow, 0.098, 0.085, C.red);
    p.ball(elbow, 0.088, C.suit);
    p.capsule(elbow, hand, 0.082, 0.076, C.white);
    p.ball(hand, 0.095, C.glove, { bias: 0.05 });
  }

  // legs grip the tank, boots on the pegs
  for (const s of [-1, 1]) {
    const hipJ: V3 = [hip[0] + s * 0.12, hip[1] - 0.03, hip[2] + 0.04];
    const out = Math.max(0, s * pose.knee); // inside knee drops out toward the tarmac
    const knee: V3 = [s * (0.3 + out * 0.2), 0.78 - sag * 0.6 - out * 0.13, 0.2 - out * 0.05];
    const ankle: V3 = [s * 0.275, 0.46 - sag * 0.3, -0.08];
    p.capsule(hipJ, knee, 0.135, 0.118, C.suit);
    p.ball(knee, 0.125, C.red);
    p.capsule(knee, ankle, 0.108, 0.092, C.suit, {
      decals: [{ pts: [[s * 0.33, 0.7, 0.12], [s * 0.385, 0.7, 0.08], [s * 0.37, 0.52, -0.05], [s * 0.315, 0.52, -0.01]], fill: C.white, normal: [s, 0, -0.5] }],
    });
    const bx0 = Math.min(s * 0.18, s * 0.365), bx1 = Math.max(s * 0.18, s * 0.365);
    const by = 0.28 - sag * 0.3;
    p.box(bx0, bx1, by, by + 0.25, -0.24, 0.12, C.red, {
      decals: [
        { pts: [[bx0, by, -0.241], [bx1, by, -0.241], [bx1, by + 0.065, -0.241], [bx0, by + 0.065, -0.241]], fill: C.suit, normal: [0, 0, -1] },
        { pts: [[bx0, by + 0.13, -0.241], [bx1, by + 0.13, -0.241], [bx1, by + 0.185, -0.241], [bx0, by + 0.185, -0.241]], fill: C.white, normal: [0, 0, -1] },
      ],
      bias: 0.04,
    });
  }
}

/** Paint Mach mounted on his motorcycle. Call between painter.begin() and painter.end(). */
export function paintMach(p: RigPainter, pose: MachPose = NEUTRAL_POSE, livery: Livery = MACH_LIVERY) {
  C = livery;
  const bar = bike(p, pose);
  rider(p, pose, bar);
}
