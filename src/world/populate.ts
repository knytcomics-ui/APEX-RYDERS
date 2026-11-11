import { TUNING } from '../core/config';
import type { Rng } from '../core/rng';
import type { Section } from './route';

export type PickupKind = 'coin' | 'momentumSmall' | 'momentumLarge';
export type DebrisKind = 'crate' | 'barricade'; // common debris: ordinary DEF-first damage
export type EntityKind = PickupKind | DebrisKind;

export interface Entity {
  kind: EntityKind;
  lane: number;
  s: number;
  h: number; // height above the road surface
  taken: boolean;
}

export const isPickup = (k: EntityKind): k is PickupKind => k === 'coin' || k === 'momentumSmall' || k === 'momentumLarge';

const BEAT = 39; // metres between gameplay beats
const COIN_GAP = 4.5;

/**
 * Fills a section with collectibles and common debris, per ribbon.
 * Risky ribbons carry more Momentum and more debris; safe ribbons are calmer.
 * At least one lane of every ribbon is always left open.
 */
export function populate(sec: Section, rng: Rng, difficulty: number): Entity[] {
  const out: Entity[] = [];
  const add = (kind: EntityKind, lane: number, s: number, h = 0) => out.push({ kind, lane, s, h, taken: false });
  const hazard = sec.hazards[0];
  if (hazard) {
    // No debris around a lethal hazard. Momentum on the clean approach — never within
    // `hazardClearance` of the edge — then coins leading into the safe lane.
    const P = TUNING.pickups, a = sec.s0 + 18, b = hazard.z0 - P.hazardClearance;
    const n = P.hazardApproach.large + P.hazardApproach.small;
    for (let i = 0; i < n; i++) add(i < P.hazardApproach.large ? 'momentumLarge' : 'momentumSmall', rng.int(0, 4), a + ((b - a) * i) / Math.max(1, n - 1));
    add('momentumSmall', rng.int(0, 4), hazard.z1 + 40); // something to pick up on the way out
    for (let i = 0; i < 10; i++) add('coin', hazard.safeLane, hazard.z0 - 96 + i * COIN_GAP);
    for (let i = 0; i < 6; i++) add('coin', 2, hazard.z1 + 26 + i * COIN_GAP);
    return out;
  }
  const transitional = sec.def.kind === 'split' || sec.def.kind === 'merge';

  sec.ribbons.forEach((rb) => {
    const lanes = rb.lanes;
    const beats = Math.floor((sec.length - 18) / BEAT);
    let lastBlocked = -1;
    for (let b = 0; b < beats; b++) {
      const z = sec.s0 + 12 + b * BEAT;
      const blocked: number[] = [];
      let debris: 'crate' | 'barricade' = rng.chance(0.5) ? 'crate' : 'barricade';

      if (!transitional) {
        let debrisChance = 0.42 + 0.4 * difficulty;
        let maxBlocked = Math.min(lanes.length - 1, 1 + Math.round(difficulty * 2));
        if (rb.role === 'risky') { debrisChance = 0.9; maxBlocked = lanes.length - 1; }
        if (rb.role === 'safe') { debrisChance = 0.12 + 0.2 * difficulty; maxBlocked = 1; }
        if (rng.chance(debrisChance)) {
          const count = rng.int(1, Math.max(1, maxBlocked));
          const pool = lanes.filter((l) => !(rb.role === 'risky' && l === lastBlocked));
          while (blocked.length < count && pool.length) blocked.push(pool.splice(rng.int(0, pool.length - 1), 1)[0]);
          lastBlocked = blocked[0];
          for (const l of blocked) add(debris, l, z + COIN_GAP * 3);
        }
      }

      const free = lanes.filter((l) => !blocked.includes(l));
      const roll = rng.next();
      const rates = TUNING.pickups[rb.role];
      if (rb.role === 'risky') {
        // Momentum-rich: a token in the open lane every beat, a large one to finish the run.
        const lane = rng.pick(free);
        const last = b === beats - 1 && sec.def.kind === 'branch';
        add(last || rng.chance(rates.large) ? 'momentumLarge' : 'momentumSmall', lane, z + COIN_GAP * 3);
        for (let i = 0; i < 3; i++) add('coin', lane, z + COIN_GAP * (5 + i));
      } else if (roll < (rb.role === 'safe' ? 0.5 : 0.62)) {
        // Coin line; arcs over a barricade when it shares the lane.
        let lane = rng.pick(lanes);
        if (blocked.includes(lane) && debris === 'crate') lane = rng.pick(free);
        const arc = blocked.includes(lane);
        const drift = !arc && !transitional && rng.chance(0.3) ? (rng.chance(0.5) ? 1 : -1) : 0;
        for (let i = 0; i < 7; i++) {
          let l = lane;
          if (drift && i >= 4 && lanes.includes(lane + drift) && !blocked.includes(lane + drift)) l = lane + drift;
          const h = arc ? Math.sin((Math.PI * (i + 0.5)) / 7) * 1.5 : 0;
          add('coin', l, z + COIN_GAP * i, h);
        }
      }
      if (rb.role !== 'risky') {
        // Momentum: independent of the coin roll, in an open lane
        const m = rng.next();
        const kind = m < rates.large ? 'momentumLarge' : m < rates.large + rates.small ? 'momentumSmall' : null;
        if (kind) add(kind, rng.pick(free), z + COIN_GAP * 3 + 2);
      }
    }
  });
  return out;
}

