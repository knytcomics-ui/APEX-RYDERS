/**
 * Player profile for the front end, kept in localStorage. Everything here is
 * presentation-side meta state (wallet, coins, garage, settings, local bests);
 * the run itself is never influenced by it.
 */
import type { CharacterId } from '../core/config';
import { TUNE_MAX, tuneCost, type TuneId } from './data';

export interface RunRecord { cls: CharacterId; score: number; dist: number; coins: number; at: number }
export interface Settings { sound: number; music: number; haptics: boolean; reducedMotion: boolean; leftHanded: boolean; language: string }

export interface Profile {
  name: string;
  xp: number; // account XP, total
  coins: number;
  wallet: { kind: 'freighter' | 'albedo'; address: string; usdc: number } | null;
  selected: CharacterId;
  mastery: Record<CharacterId, number>; // class mastery XP, total
  tunes: Record<CharacterId, Record<TuneId, number>>;
  paint: Record<CharacterId, number>;
  owned: string[]; // shop item ids
  runs: RunRecord[]; // best ten, by score
  onboarded: boolean;
  settings: Settings;
}

const KEY = 'apex-ryders.profile.v1';
const zeroTunes = () => ({ handling: 0, accel: 0, turn: 0, speed: 0 });

const fresh = (): Profile => ({
  name: 'Rider',
  xp: 0,
  coins: 2500,
  wallet: null,
  selected: 'mach',
  mastery: { mach: 0, brute: 0, lynn: 0 },
  tunes: { mach: zeroTunes(), brute: zeroTunes(), lynn: zeroTunes() },
  paint: { mach: 0, brute: 0, lynn: 0 },
  owned: [],
  runs: [],
  onboarded: false,
  settings: { sound: 80, music: 60, haptics: true, reducedMotion: false, leftHanded: false, language: 'English' },
});

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Profile>;
      const f = fresh();
      return { ...f, ...p, settings: { ...f.settings, ...p.settings }, mastery: { ...f.mastery, ...p.mastery }, tunes: { ...f.tunes, ...p.tunes }, paint: { ...f.paint, ...p.paint } };
    }
  } catch { /* storage blocked: play on a session-only profile */ }
  return fresh();
}

export const profile: Profile = load();
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* session-only */ }
}

/** Account level curve: level n needs 1000 + 250·(n-1) XP. */
export function levelOf(xp: number) {
  let level = 1, need = 1000;
  while (xp >= need) { xp -= need; level++; need = 1000 + 250 * (level - 1); }
  return { level, into: xp, need };
}
/** Class mastery: a flat 5,000 XP per mastery level. */
export const masteryOf = (xp: number) => ({ level: 1 + Math.floor(xp / 5000), into: xp % 5000, need: 5000 });

export interface RunResult { cls: CharacterId; score: number; dist: number; coins: number }
export interface RunReward { xp: number; mastery: number; leveledUp: boolean; newBest: boolean; before: ReturnType<typeof levelOf>; after: ReturnType<typeof levelOf> }

/** Bank a finished run: coins, account XP, class mastery XP and the local best list. */
export function recordRun(r: RunResult): RunReward {
  const before = levelOf(profile.xp);
  const xp = Math.round(r.dist / 4 + r.score / 120);
  const mastery = Math.round(r.dist / 2);
  const newBest = r.score > 0 && r.score > Math.max(0, ...profile.runs.filter((x) => x.cls === r.cls).map((x) => x.score));
  profile.xp += xp;
  profile.mastery[r.cls] += mastery;
  profile.coins += r.coins;
  profile.runs = [...profile.runs, { ...r, at: Date.now() }].sort((a, b) => b.score - a.score).slice(0, 10);
  save();
  const after = levelOf(profile.xp);
  return { xp, mastery, leveledUp: after.level > before.level, newBest, before, after };
}

export const bestFor = (cls?: CharacterId) => {
  const rs = cls ? profile.runs.filter((r) => r.cls === cls) : profile.runs;
  return { score: Math.max(0, ...rs.map((r) => r.score)), dist: Math.max(0, ...rs.map((r) => r.dist)) };
};

export function buyTune(cls: CharacterId, id: TuneId): boolean {
  const lvl = profile.tunes[cls][id];
  if (lvl >= TUNE_MAX) return false;
  const cost = tuneCost(lvl);
  if (profile.coins < cost) return false;
  profile.coins -= cost;
  profile.tunes[cls][id] = lvl + 1;
  save();
  return true;
}
