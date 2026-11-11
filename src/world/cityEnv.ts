import type { Rng } from '../core/rng';
import type { Environment, Prop, PropKind } from './environment';
import type { Section } from './route';

/** CITY: a Lagos-inspired expressway — danfo buses, keke, markets, tin roofs, lagoon bridge. */
const WALLS = [0xf4dba6, 0xeda35a, 0xe0694a, 0x66c7ba, 0xf3c4bd, 0xc9d4f2, 0xf7e7c6, 0x8fd0ea, 0xefb548, 0xb9da78, 0xd9a0d6, 0x9fb4e8];
const ROOFS = [0xc45a2c, 0x9c4f2e, 0xa9623e, 0x77728f, 0x8292ad, 0xb8472e];
const TOWERS = [0x7fb6d9, 0x9aa7d6, 0xd9c7a8, 0x86c5c0, 0xb7b0d0];
const AWNINGS = [0xe53935, 0x1e9e5a, 0xf5b921, 0x2f7fe0, 0xff7f2a, 0xffffff];
const KIOSKS: [number, number][] = [[0xffd23f, 0xe53127], [0x1e9e5a, 0xffffff], [0xe53127, 0xffffff], [0x2f7fe0, 0xffd23f]];
const GREENS: [number, number][] = [[0x6fb83f, 0x2f7a3c], [0x8cc63f, 0x3f8f3a], [0x4fae52, 0x2c7a3c], [0xa8c93a, 0x4f8a2e]];
const BILLBOARDS = 6;

export const cityEnvironment: Environment = {
  id: 'city',
  name: 'City',
  backdropKey: 'skyline-city',
  palette: {
    skyTop: 0x1f6fe0,
    skyBottom: 0xc4ecff,
    haze: 0xcbd9f6,
    asphalt: [0x4e4865, 0x4a4460],
    asphaltRisky: [0x5a4258, 0x553d52],
    shoulder: 0x8f88ad,
    edgeLine: 0xf5a81f,
    laneDash: 0xece7f8,
    sidewalk: [0xaaa2cb, 0x9e96c0],
    service: [0x7d7594, 0x776f8e],
    ground: [0xcb8a5c, 0xc28154],
    water: [0x2f93d6, 0x2a89cb],
    median: 0x6aa84a,
    barrierA: 0xf6b81f,
    barrierB: 0x2b2539,
    concrete: 0xbdb8ce,
    outline: 0x1a1430,
  },

  dress(sec: Section, rng: Rng): Prop[] {
    const props: Prop[] = [];
    const put = (kind: PropKind, side: -1 | 1, x: number, y: number, z: number, w: number, h: number, d: number, c = 0, c2 = 0) =>
      props.push({ kind, side, x, y, z, w, h, d, c, c2, v: rng.int(0, 9999) });
    const edge = (side: -1 | 1, s: number) => sec.extents(s)[side < 0 ? 0 : 1];
    /** Outermost edge over a z-range, so long props never cut into a curving road. */
    const outer = (side: -1 | 1, z0: number, z1: number) => {
      const a = edge(side, z0), b = edge(side, (z0 + z1) / 2), c = edge(side, z1);
      return side < 0 ? Math.min(a, b, c) : Math.max(a, b, c);
    };
    const edgeY = (side: -1 | 1, s: number) => sec.y(side < 0 ? 0 : sec.ribbons.length - 1, s);
    const water = sec.def.ground === 'water';
    const green = () => rng.pick(GREENS);

    // Route-choice gantry at the mouth of every split, chevron board at its nose.
    if (sec.def.kind === 'split') {
      const z = sec.s0 + 9;
      const [l, r] = sec.extents(z);
      put('gantry', sec.ribbons[0].role === 'risky' ? -1 : 1, (l + r) / 2, sec.centerY(z), z, r - l + 3, 10.5, 0.6);
      const zn = sec.s0 + 30;
      put('goreSign', 1, (sec.right(0, zn) + sec.left(1, zn)) / 2, sec.centerY(zn), zn, 3, 3, 0.2);
    }

    // Chevron boards around the outside of every sharp turn.
    if (Math.abs(sec.def.turn) >= 0.45) {
      const outside = sec.def.turn > 0 ? -1 : 1;
      for (let z = sec.s0 + 18; z < sec.s1 - 12; z += 12) {
        put('chevron', outside, edge(outside, z) + outside * 2.1, edgeY(outside, z), z + 6, 2.6, 2.9, 0.2, 0xf6b81f, sec.def.turn > 0 ? 1 : 0);
      }
    }

    for (const side of [-1, 1] as const) {
      // Row 0: street furniture on the pavement and the service strip behind it.
      for (let z = sec.s0; z < sec.s1; z += 12) {
        const slot = Math.round(z / 12);
        const x = edge(side, z);
        // nothing stands on the pavement where a Chasm has taken it
        if (sec.hazards.some((h) => z > h.z0 - 6 && z < h.z1 + 6)) continue;
        const elevated = edgeY(side, z) > 1.5;
        if (slot % 3 === 0) {
          put('lamp', side, x + side * 1.3, edgeY(side, z), z, 0.3, 8.5, 0.3);
          continue;
        }
        if (water) {
          if (rng.chance(0.22)) put('canoe', side, x + side * rng.range(8, 42), 0, z, 1.5, 0.5, rng.range(6, 9), 0x8a5632, rng.pick(AWNINGS));
          else if (rng.chance(0.08)) put('stiltHut', side, x + side * rng.range(14, 46), 0, z, 5, 3, 5, rng.pick(WALLS), rng.pick(ROOFS));
          continue;
        }
        if (elevated) {
          if (rng.chance(0.3)) { const [c, c2] = green(); put('tree', side, x + side * rng.range(4, 7), 0, z, rng.range(4, 6), rng.range(6, 8), 1, c, c2); }
          continue;
        }
        // Utility poles strung with wires along one side of the road.
        if (side < 0 && slot % 4 === 1) {
          const zn = Math.min(z + 48, sec.s1);
          put('pole', side, x + side * 5.6, 0, z, edge(side, zn) - x, 9.5, zn - z);
        }
        const r = rng.next();
        if (r < 0.08) put('banner', side, x + side * 1.4, 0, z, 2.1, 7.5, 0.2, 0xe53127, 0xffffff);
        else if (r < 0.27) { const [c, c2] = green(); put('tree', side, x + side * rng.range(2.6, 4.2), 0, z, rng.range(4, 6), rng.range(5.5, 8), 1, c, c2); }
        else if (r < 0.4) put('palm', side, x + side * rng.range(2.6, 4.2), 0, z, 5, rng.range(8, 11), 1, 0x4fae3f, 0x8a5a36);
        else if (r < 0.56) put('stall', side, x + side * rng.range(3, 4), 0, z, 2.8, 2.6, 2.2, rng.pick(AWNINGS), rng.pick(AWNINGS));
        else if (r < 0.66) put('danfo', side, x + side * rng.range(7.4, 9), 0, z, 2.3, 2.5, 5.4, 0xf7c600, 0x1c1a24);
        else if (r < 0.73) put('keke', side, x + side * rng.range(7, 9), 0, z, 1.6, 1.9, 2.7, 0xf7c600, 0x23202e);
        else if (r < 0.79) put('billboard', side, x + side * 8, 0, z, 9, 11, 0.5, 0x3a3550, rng.int(0, BILLBOARDS - 1));
        else if (r < 0.88) { const [c, c2] = rng.pick(KIOSKS); put('kiosk', side, x + side * rng.range(6.6, 8.2), 0, z, 2.4, 2.7, 2.2, c, c2); }
        else if (r < 0.96) { const [c, c2] = green(); put('bush', side, x + side * rng.range(2.4, 4), 0, z, rng.range(2, 3.4), 1.6, 1, c, c2); }
      }
      if (water) continue;

      // Row 1: shopfront buildings behind the service strip.
      let z = sec.s0 + rng.range(0, 4);
      while (z < sec.s1 - 7) {
        const d = Math.min(rng.range(9, 19), sec.s1 - z - 0.5);
        const w = rng.range(9, 15);
        const h = rng.pick([4.5, 4.5, 4.5, 7.6, 7.6, 10.8, 10.8, 14, 17.5]);
        const x = outer(side, z, z + d) + side * (13 + rng.range(0, 3) + w / 2);
        put('building', side, x, 0, z, w, h, d, rng.pick(WALLS), rng.pick(ROOFS));
        z += d + (rng.chance(0.25) ? rng.range(5, 11) : 0.8);
      }
      // Row 2: taller towers and telecom masts behind.
      for (let zt = sec.s0 + rng.range(0, 20); zt < sec.s1 - 16; zt += rng.range(30, 55)) {
        if (rng.chance(0.3)) continue;
        if (rng.chance(0.2)) { put('mast', side, outer(side, zt, zt + 4) + side * rng.range(34, 60), 0, zt, 5, rng.range(34, 48), 1); continue; }
        const w = rng.range(13, 20), d = rng.range(12, 16);
        put('tower', side, outer(side, zt, zt + d) + side * (rng.range(32, 58) + w / 2), 0, zt, w, rng.range(24, 52), d, rng.pick(TOWERS), 0x2c3f6e);
      }
    }

    // Planted median between separated ribbons.
    if (sec.def.kind === 'branch') {
      for (let z = sec.s0 + 6; z < sec.s1; z += 18) {
        const x = (sec.right(0, z) + sec.left(1, z)) / 2;
        const [c, c2] = green();
        if (rng.chance(0.6)) put('bush', 1, x + rng.range(-2, 2), 0, z, rng.range(2, 3.2), 1.5, 1, c, c2);
        else put('palm', 1, x + rng.range(-1.5, 1.5), 0, z, 5, rng.range(7, 9), 1, 0x4fae3f, 0x8a5a36);
      }
    }
    return props;
  },
};
