/** Shared world constants and tuning. Everything balance-related lives here. */
export const LANES = 5;
export const LANE_W = 3.2; // metres
export const SLICE = 3; // metres; road is drawn in world-aligned slices, section lengths are multiples of this
export const STEP = 1 / 120; // fixed simulation timestep (seconds)

export const TUNING = {
  speed: { base: 27, max: 52, perMetre: 0.0045, attract: 24 },
  laneChangeTime: 0.13, // seconds per lane
  jump: {
    velocity: 9.6,
    gravity: 27,
    // Mach — initial tuning values, to be balanced once the Chasm exists
    airVelocity: 8.8, // Air Jump: a second take-off while airborne
    airCost: 25, // Momentum spent per Air Jump (one per flight)
    surgeVelocity: 13, // Surge Jump: needs a full meter, spends all of it
    surgeGravityScale: 0.5, // floatier arc = the extended jump (R4.1.1: 0.6 -> 0.5 widened the Chasm launch window to ~0.8 s)
    surgeSpeedBoost: 1.3, // forward kick held for the length of the Surge flight
  },
  survival: { hp: 2, def: 2, invulnTime: 1.6 },
  // Brute — initial tuning values
  smash: {
    cost: 50, // Momentum spent per successful Smash
    window: 1.6, // seconds of riding ahead in which a Pillars encounter can be smashed
  },
  // Brute — Scrap: sacrifice one DEF for a spell of double chain
  scrap: {
    duration: 5, // seconds
    chainFactor: 2, // score multiplier = chain x this while Scrap is active
  },
  // Mach — Phantom Drive (E): a timed speed burst for Momentum (R7.2 approved values)
  phantom: {
    cost: 50, // Momentum, deducted on activation, never refunded
    duration: 4, // seconds of actual boosted riding (paused while a Chasm is in range)
    speedFactor: 1.25, // immediate; 52 m/s top speed becomes 65 m/s
    scoreFactor: 1.25, // applied to each score gain while boosted, then rounded
    cooldown: 8, // seconds, starting once the active duration has fully elapsed
  },
  // Mach — Blink passive: automatic one-lane teleport away from an imminent debris hit
  blink: {
    window: 0.25, // seconds before impact in which Blink may fire
    cooldown: 1.5, // seconds after a successful Blink
    arrivalClear: 0.5, // seconds of riding ahead that must be debris-free in the destination lane
  },
  // Brute — Near-Miss passive
  nearMiss: {
    reward: 1, // Momentum per qualifying object, once per object
    lateral: 1.5, // max sideways distance (lane widths) for a pass to count as close
  },
  // Lynn — HP regeneration passive
  regen: {
    delay: 5, // damage-free seconds before the interval starts
    interval: 12, // seconds per HP restored
  },
  // Lynn — Full Heal: restore HP to maximum (initial balance value)
  fullHeal: {
    cost: 50, // Momentum
  },
  // Lynn — initial tuning values
  repellent: {
    cost: 50, // Momentum spent per successful Mutagen Repellent
    window: 1.6, // seconds of riding ahead in which a Mutant Spill can be repelled
  },
  momentum: { small: 10, large: 25, max: 100 },
  /** Lethal-encounter pacing (metres of route). All draws come from the route seed. */
  pacing: {
    firstLethal: [330, 440] as [number, number], // target for the first hazard's near edge
    lethalGap: [280, 620] as [number, number], // target from one hazard's far edge to the next one's near edge, drawn per gap
    early: 60, // a hazard may start up to this much before its target, so section lengths don't push it late
    // hazard type order: a seeded shuffle bag, one of each kind per group of three (route.ts)
  },
  /** Momentum pickups: chance per gameplay beat (~39 m) per carriageway. */
  pickups: {
    main: { small: 0.18, large: 0.05 }, // R4.1.1: 0.26 -> 0.18, so Smash/Surge aren't automatic
    safe: { small: 0.24, large: 0.05 }, // the calm side of a fork still pays
    risky: { small: 1, large: 0.15 }, // a token every beat, plus a large one at the end of each shortcut run
    hazardApproach: { small: 2, large: 0 }, // on the clean road leading into every lethal encounter (R4.1.2: large 1 -> 0; 55 -> 30 per encounter incl. the exit token)
    hazardClearance: 60, // no pickup closer than this to a lethal hazard's near edge
  },
  score: { coin: 10, momentumSmall: 25, momentumLarge: 60, comboWindow: 2.4, comboPerChain: 6, maxChain: 10 },
};

export type CharacterId = 'mach' | 'brute' | 'lynn';

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (u: number) => u * u * (3 - 2 * u);
