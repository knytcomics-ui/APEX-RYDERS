/**
 * Road-section templates and their connectors.
 *
 * A CONNECTOR describes the road cross-section at a section boundary: one or more
 * "ribbons" (carriageways), each owning a contiguous set of the five global lanes,
 * with a lateral offset and elevation relative to the route centreline.
 *
 * A SECTION goes from one connector to another. Two sections can only be chained
 * when exit connector === entry connector, so the generator can never produce a
 * branch that looks connected but is not traversable.
 */
export type ConnId = 'full' | 'forkL' | 'forkR';
export type Role = 'main' | 'safe' | 'risky';
export type Ground = 'city' | 'water';
export type Level = 'ground' | 'bridge';
export type SectionKind = 'road' | 'split' | 'branch' | 'merge' | 'rampUp' | 'rampDown' | 'bridge' | 'chasm' | 'pillars' | 'mutantSpill';

export interface RibbonLayout {
  lanes: number[]; // global lane indices (contiguous)
  offset: number; // lateral shift from the centreline, metres
  elev: number; // elevation above the centreline, metres
  role: Role;
}

export const CONNECTORS: Record<ConnId, RibbonLayout[]> = {
  full: [{ lanes: [0, 1, 2, 3, 4], offset: 0, elev: 0, role: 'main' }],
  // Risky two-lane flyover peels off to the left; three safe lanes stay low on the right.
  forkL: [
    { lanes: [0, 1], offset: -8, elev: 5.5, role: 'risky' },
    { lanes: [2, 3, 4], offset: 4, elev: 0, role: 'safe' },
  ],
  forkR: [
    { lanes: [0, 1, 2], offset: -4, elev: 0, role: 'safe' },
    { lanes: [3, 4], offset: 8, elev: 5.5, role: 'risky' },
  ],
};

export interface SectionDef {
  id: string;
  kind: SectionKind;
  from: ConnId;
  to: ConnId;
  length: number; // metres, multiple of SLICE
  turn: number; // net heading change (dx/dz slope) across the section
  rise: number; // net centreline elevation change
  level: Level; // elevation level required at entry
  ground: Ground;
  difficulty: number; // 0..1 minimum difficulty at which it may appear
  weight: number;
}

const road = (id: string, length: number, turn: number, weight: number, extra: Partial<SectionDef> = {}): SectionDef => ({
  id, kind: 'road', from: 'full', to: 'full', length, turn, rise: 0, level: 'ground', ground: 'city', difficulty: 0, weight, ...extra,
});

const fork = (side: 'L' | 'R'): SectionDef[] => {
  const conn: ConnId = side === 'L' ? 'forkL' : 'forkR';
  const base = { rise: 0, level: 'ground' as Level, ground: 'city' as Ground, difficulty: 0 };
  return [
    { id: `split${side}`, kind: 'split', from: 'full', to: conn, length: 108, turn: 0, weight: 1, ...base },
    { id: `run${side}`, kind: 'branch', from: conn, to: conn, length: 240, turn: 0, weight: 2, ...base },
    { id: `run${side}-bendL`, kind: 'branch', from: conn, to: conn, length: 240, turn: -0.16, weight: 1, ...base },
    { id: `run${side}-bendR`, kind: 'branch', from: conn, to: conn, length: 240, turn: 0.16, weight: 1, ...base },
    { id: `merge${side}`, kind: 'merge', from: conn, to: 'full', length: 108, turn: 0, weight: 1, ...base },
  ];
};

export const SECTION_DEFS: SectionDef[] = [
  road('straight', 120, 0, 3),
  road('straight-long', 180, 0, 1.5),
  road('curveL', 150, -0.3, 2),
  road('curveR', 150, 0.3, 2),
  road('bendL', 96, -0.16, 1.5),
  road('bendR', 96, 0.16, 1.5),
  // Sharp turns: twice as tight as a curve — the corners that make the bike drift.
  road('sharpL', 126, -0.5, 1.3),
  road('sharpR', 126, 0.5, 1.3),
  // Lethal hazard section: a straight carrying a Chasm (see world/hazards.ts).
  road('chasm', 300, 0, 1.2, { kind: 'chasm' }),
  road('pillars', 240, 0, 1.2, { kind: 'pillars' }),
  road('mutantSpill', 240, 0, 1.2, { kind: 'mutantSpill' }),
  // Flyover onto a lagoon bridge and back down.
  road('rampUp', 150, 0, 1, { kind: 'rampUp', rise: 8 }),
  road('bridge', 180, 0, 3, { kind: 'bridge', level: 'bridge', ground: 'water' }),
  road('bridge-curveL', 180, -0.2, 1.5, { kind: 'bridge', level: 'bridge', ground: 'water' }),
  road('bridge-curveR', 180, 0.2, 1.5, { kind: 'bridge', level: 'bridge', ground: 'water' }),
  road('rampDown', 150, 0, 1, { kind: 'rampDown', rise: -8, level: 'bridge' }),
  ...fork('L'),
  ...fork('R'),
];

export const START_SECTION: SectionDef = road('start', 240, 0, 0);
