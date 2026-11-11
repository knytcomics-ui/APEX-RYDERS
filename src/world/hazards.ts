import type { CharacterId } from '../core/config';

/**
 * Class-specific lethal hazards and the character abilities that interact with them.
 * Rules live here, independent of any character's rendering or of Mach in particular.
 */
export type HazardKind = 'chasm' | 'pillars' | 'mutantSpill';
export type AbilityId = 'airJump' | 'surgeJump' | 'smash' | 'scrap' | 'fullHeal' | 'mutagenRepellent' | 'phantomDrive';

/** Seconds of riding before a lethal hazard at which it is announced; also the range in which
 * Blink is disabled and Phantom Drive is held for a Chasm. */
export const HAZARD_WARNING_S = 3.2;

/**
 * A placed lethal hazard: a span of road with exactly one safe passage lane.
 * Lethal hazards are separate from common debris (world/populate.ts), which deals
 * ordinary DEF-first damage. Failing a lethal hazard kills outright: HP, DEF and
 * damage invulnerability do not apply.
 */
export interface Hazard {
  kind: HazardKind;
  z0: number; // where it begins (for the Chasm: the near edge)
  z1: number; // where it ends (the far edge)
  safeLane: number; // the randomly chosen passage (for the Chasm: the ramp lane)
  /** Destroyed by its class counter (Pillars smashed). Set once; never re-processed. */
  cleared?: boolean;
  /**
   * Mutant Spill repelled by Lynn: the organism stays, but recoils from her for this one
   * encounter only. Set once; never re-processed; does not carry to any other encounter.
   */
  repelled?: boolean;
}

/** Which character's ability lets them ignore each lethal hazard. Everyone else must use the passage. */
export const HAZARD_BYPASS: Record<HazardKind, { character: CharacterId; ability: AbilityId }> = {
  chasm: { character: 'mach', ability: 'surgeJump' },
  pillars: { character: 'brute', ability: 'smash' },
  mutantSpill: { character: 'lynn', ability: 'mutagenRepellent' },
};

export const bypasses = (hazard: HazardKind, character: CharacterId, ability: AbilityId | null) =>
  ability !== null && HAZARD_BYPASS[hazard].character === character && HAZARD_BYPASS[hazard].ability === ability;

/**
 * What each character can do.
 *  - `passive`: automatic trait (Mach Blink, Brute Near-Miss Momentum, Lynn HP regeneration).
 *  - `signature`: the Ultimate / class counter, on S / swipe down.
 *  - `secondary`: the second ability, on E / tap.
 *  - `airJump`: the universal Double Jump (all riders; 25 Momentum, once per ordinary jump).
 * No passive or secondary counters any lethal hazard: they are absent from HAZARD_BYPASS.
 */
export type PassiveId = 'blink' | 'nearMiss' | 'regen';
export const CHARACTER_KIT: Record<CharacterId, { airJump: boolean; passive: PassiveId; signature: AbilityId; secondary: AbilityId }> = {
  mach: { airJump: true, passive: 'blink', signature: 'surgeJump', secondary: 'phantomDrive' },
  brute: { airJump: true, passive: 'nearMiss', signature: 'smash', secondary: 'scrap' },
  lynn: { airJump: true, passive: 'regen', signature: 'mutagenRepellent', secondary: 'fullHeal' },
};

/** Lethal hazards the route generator draws from. Section kind = hazard kind. */
export const HAZARD_POOL: HazardKind[] = ['chasm', 'pillars', 'mutantSpill'];

/** Mutant Spill: a living organism sprawled across four lanes, tentacles up. */
export const MUTANT = {
  approach: 120, // metres of clean road from the section start to the organism's near edge
  depth: 14, // how far along the road it sprawls
  grabTime: 0.75, // seconds from being grabbed to being pulled under
};

/** Pillars geometry. */
export const PILLARS = {
  approach: 120, // metres of clean road from the section start to the pillar faces
  depth: 4,
  height: 10,
};

/** Chasm geometry and tuning. */
export const CHASM = {
  approach: 150, // metres of clean road from the section start to the near edge
  gapSeconds: 1.65, // gap length = this x the expected riding speed there: beyond Jump + Air Jump, within Surge
  rampLength: 15,
  rampHeight: 2.4,
  landing: 10, // a ramp flight touches down this far past the far edge
  depth: 14,
  fallTime: 0.9, // seconds of falling before the run ends
};
