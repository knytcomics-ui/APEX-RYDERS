import type { Rng } from '../core/rng';
import type { Section } from './route';
import { cityEnvironment } from './cityEnv';

/** The five intended maps. Only those present in ENVIRONMENTS are playable. */
export type EnvId = 'city' | 'desert' | 'beach' | 'sky' | 'future';

export type PropKind =
  | 'building' | 'tower' | 'mast' | 'tree' | 'palm' | 'bush' | 'lamp' | 'pole' | 'banner' | 'billboard'
  | 'stall' | 'kiosk' | 'danfo' | 'keke' | 'canoe' | 'stiltHut' | 'gantry' | 'goreSign' | 'chevron';

/** A scenery object in world space. x = centre, y = base, z = near face. */
export interface Prop {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  c: number; // primary colour
  c2: number; // secondary colour
  v: number; // variant / random detail seed
  side: -1 | 1; // which side of the road it sits on
}

export interface Palette {
  skyTop: number;
  skyBottom: number;
  haze: number;
  asphalt: [number, number];
  asphaltRisky: [number, number]; // the shortcut ribbon reads warmer and darker
  shoulder: number;
  service: [number, number]; // paved frontage strip between pavement and buildings
  edgeLine: number;
  laneDash: number;
  sidewalk: [number, number];
  ground: [number, number];
  water: [number, number];
  median: number;
  barrierA: number;
  barrierB: number;
  concrete: number;
  outline: number;
}

/**
 * An environment owns everything that makes a map distinct: palette, backdrop,
 * and the "dresser" that places scenery along each road section.
 * Adding a map = implementing this interface and registering it below.
 */
export interface Environment {
  id: EnvId;
  name: string;
  palette: Palette;
  backdropKey: string;
  dress(sec: Section, rng: Rng): Prop[];
}

export const ENVIRONMENTS: Partial<Record<EnvId, Environment>> & { city: Environment } = {
  city: cityEnvironment,
};
