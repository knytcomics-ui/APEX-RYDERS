/**
 * Static front-end content: classes, kits, garage, shop and placeholder boards.
 * Ability names and inputs mirror the shipped kit in src/world/hazards.ts (CHARACTER_KIT),
 * so the menus never promise something the run does not do.
 */
import type { CharacterId } from '../core/config';
import { TUNING } from '../core/config';

export const A = (f: string) => `assets/ui/${f}`;

export interface Ability { name: string; input: string; key: string; icon: string; text: string }
export interface ClassDef {
  id: CharacterId; name: string; role: string; tagline: string; color: string; dark: string;
  traits: string[]; signature: Ability; utility: Ability; passive: { name: string; text: string }; breezes: string; breezesText: string;
  gear: { name: string; icon: string }[];
}

export const HP = TUNING.survival.hp;
export const DEF = TUNING.survival.def;

export const CLASSES: ClassDef[] = [
  {
    id: 'mach', name: 'MACH', role: 'PRO RACER', tagline: 'Agile · Fast · Precise', color: '#E53935', dark: '#7a1218',
    traits: ['AGILE', 'FAST', 'PRECISE'],
    signature: { name: 'SURGE JUMP', input: 'Swipe down', key: 'S', icon: 'ab_surge.png', text: 'A high, forward leap on a full Momentum meter. Clears a Chasm from any lane.' },
    utility: { name: 'PHANTOM DRIVE', input: 'Tap', key: 'E', icon: 'ab_blink.png', text: `A ${TUNING.phantom.duration}s speed burst for ${TUNING.phantom.cost} Momentum: faster riding and ×${TUNING.phantom.scoreFactor} score. ${TUNING.phantom.cooldown}s cooldown.` },
    passive: { name: 'BLINK', text: 'Automatically teleports one lane clear of an imminent debris hit.' },
    breezes: 'CHASM', breezesText: 'Surge Jump clears it anywhere',
    gear: [{ name: 'Helmet', icon: 'gear_mach_helmet.png' }, { name: 'Racing Suit', icon: 'gear_mach_suit.png' }, { name: 'Gloves', icon: 'gear_mach_gloves.png' }, { name: 'Boots', icon: 'gear_mach_boots.png' }],
  },
  {
    id: 'brute', name: 'BRUTE', role: 'BRAWLER', tagline: 'Powerful · Durable · Aggressive', color: '#1E90FF', dark: '#0d3a78',
    traits: ['POWERFUL', 'DURABLE', 'AGGRESSIVE'],
    signature: { name: 'SMASH', input: 'Swipe down', key: 'S', icon: 'ab_smash.png', text: `A heavy strike for ${TUNING.smash.cost} Momentum that destroys a Pillar blockade in any lane.` },
    utility: { name: 'SCRAP', input: 'Tap', key: 'E', icon: 'ab_scrap.png', text: `Sacrifice 1 DEF for ${TUNING.scrap.duration}s of double chain score.` },
    passive: { name: 'NEAR-MISS', text: `+${TUNING.nearMiss.reward} Momentum for every obstacle passed close by.` },
    breezes: 'PILLARS', breezesText: 'Smash destroys them in any lane',
    gear: [{ name: 'Durag', icon: 'gear_brute_durag.png' }, { name: 'Biker Vest', icon: 'gear_brute_vest.png' }, { name: 'Racing Top', icon: 'gear_brute_top.png' }, { name: 'Gloves', icon: 'gear_brute_gloves.png' }, { name: 'Boots', icon: 'gear_brute_boots.png' }],
  },
  {
    id: 'lynn', name: 'LYNN', role: 'MEDIC', tagline: 'Supportive · Recovery · Resilient', color: '#8CE63F', dark: '#2f6a12',
    traits: ['SUPPORTIVE', 'RECOVERY', 'RESILIENT'],
    signature: { name: 'REPELLENT', input: 'Swipe down', key: 'S', icon: 'ab_shield.png', text: `Mutagen Repellent for ${TUNING.repellent.cost} Momentum: ride clean through a Corrosive Spill.` },
    utility: { name: 'FULL HEAL', input: 'Tap', key: 'E', icon: 'ab_heal.png', text: `Restore HP to full for ${TUNING.fullHeal.cost} Momentum.` },
    passive: { name: 'REGEN', text: `Recovers 1 HP every ${TUNING.regen.interval}s after ${TUNING.regen.delay}s without damage.` },
    breezes: 'CORROSIVE SPILL', breezesText: 'Repellent rides through it in any lane',
    gear: [{ name: 'Headband', icon: 'gear_lynn_headband.png' }, { name: 'Earrings', icon: 'gear_lynn_earrings.png' }, { name: 'Medic Vest', icon: 'gear_lynn_vest.png' }, { name: 'Gloves', icon: 'gear_lynn_gloves.png' }, { name: 'Boots', icon: 'gear_lynn_boots.png' }, { name: 'Knee Pads', icon: 'gear_lynn_kneepads.png' }, { name: 'Goggles', icon: 'gear_lynn_goggles.png' }],
  },
];
export const cls = (id: CharacterId) => CLASSES.find((c) => c.id === id)!;

/** Garage tuning — the only thing coins buy on a bike. HP / DEF are never for sale. */
export const TUNES = [
  { id: 'handling', name: 'HANDLING', icon: 'up_handling.png' },
  { id: 'accel', name: 'ACCELERATION', icon: 'up_accel.png' },
  { id: 'turn', name: 'TURN RADIUS', icon: 'up_turn.png' },
  { id: 'speed', name: 'TOP SPEED', icon: 'up_speed.png' },
] as const;
export type TuneId = (typeof TUNES)[number]['id'];
export const TUNE_MAX = 5;
export const tuneCost = (level: number) => 250 * (level + 1) * (level + 1);

export const PERKS = [
  { name: 'CLEAN BONUS', icon: 'perk_clean.png', text: '+ coins for a run without a hit' },
  { name: 'MAGNET RUSH', icon: 'perk_magnet.png', text: 'Longer coin magnet at run start' },
  { name: 'SALVAGE', icon: 'perk_salvage.png', text: 'Keep 10% coins when wrecked' },
  { name: 'HEADSTART', icon: 'perk_headstart.png', text: 'Begin the run 200 m in' },
  { name: 'LUCKY STREAK', icon: 'perk_lucky.png', text: 'Small chance of double coins' },
];

export const PAINTS: Record<CharacterId, { name: string; css: string }[]> = {
  mach: [
    { name: 'MATTE', css: 'linear-gradient(115deg,#7a1a1a 0 50%,#b22222 50%)' },
    { name: 'GLOSS', css: 'linear-gradient(115deg,#e53935 0 45%,#ff8a80 50%,#e53935 56%)' },
    { name: 'METALLIC', css: 'linear-gradient(115deg,#9aa3ad 0 40%,#eef2f6 50%,#9aa3ad 60%)' },
    { name: 'CARBON', css: 'repeating-linear-gradient(45deg,#1b1b1f 0 4px,#2b2b33 4px 8px)' },
  ],
  brute: [
    { name: 'MATTE', css: 'linear-gradient(115deg,#22262e 0 50%,#3a404c 50%)' },
    { name: 'GLOSS', css: 'linear-gradient(115deg,#1e90ff 0 45%,#8fd0ff 50%,#1e90ff 56%)' },
    { name: 'METALLIC', css: 'linear-gradient(115deg,#9aa3ad 0 40%,#eef2f6 50%,#9aa3ad 60%)' },
    { name: 'GOLD TRIM', css: 'linear-gradient(115deg,#11161f 0 55%,#ffc300 55% 70%,#11161f 70%)' },
  ],
  lynn: [
    { name: 'MATTE', css: 'linear-gradient(115deg,#2a2f2a 0 50%,#454b45 50%)' },
    { name: 'GLOSS', css: 'linear-gradient(115deg,#8ce63f 0 45%,#d8ffb0 50%,#8ce63f 56%)' },
    { name: 'METALLIC', css: 'linear-gradient(115deg,#9aa3ad 0 40%,#eef2f6 50%,#9aa3ad 60%)' },
    { name: 'ICE', css: 'linear-gradient(115deg,#e8f7ff 0 50%,#4fd8ff 50%)' },
  ],
};

export interface ShopItem { id: string; name: string; tag: string; img: string; coins?: number; usdc?: number; tint: string; cls?: CharacterId; amount?: number; filter?: string }
export const SHOP: Record<'characters' | 'cosmetic' | 'coins', ShopItem[]> = {
  characters: [
    { id: 'skin-mach-inferno', name: 'MACH · INFERNO', tag: 'LEGENDARY SKIN', img: 'mach_avatar.png', usdc: 9.99, tint: '#ffb020', cls: 'mach', filter: 'hue-rotate(28deg) saturate(1.4)' },
    { id: 'skin-brute-midnight', name: 'BRUTE · MIDNIGHT', tag: 'EPIC SKIN', img: 'brute_avatar.png', usdc: 4.99, tint: '#9b5cff', cls: 'brute', filter: 'hue-rotate(50deg) brightness(.9)' },
    { id: 'skin-lynn-frost', name: 'LYNN · FROST', tag: 'EPIC SKIN', img: 'lynn_avatar.png', usdc: 4.99, tint: '#9b5cff', cls: 'lynn', filter: 'hue-rotate(95deg)' },
    { id: 'skin-mach-ghost', name: 'MACH · GHOST', tag: 'RARE SKIN', img: 'mach_avatar.png', coins: 12000, tint: '#1E90FF', cls: 'mach', filter: 'grayscale(1) brightness(1.15)' },
    { id: 'skin-lynn-solar', name: 'LYNN · SOLAR', tag: 'RARE SKIN', img: 'lynn_avatar.png', coins: 12000, tint: '#1E90FF', cls: 'lynn', filter: 'hue-rotate(-45deg) saturate(1.3)' },
  ],
  cosmetic: [
    { id: 'cos-mach-helmet', name: 'APEX HELMET', tag: 'MACH · EPIC', img: 'gear_mach_helmet.png', coins: 4500, tint: '#9b5cff' },
    { id: 'cos-mach-suit', name: 'RACE SUIT', tag: 'MACH · RARE', img: 'gear_mach_suit.png', coins: 2800, tint: '#1E90FF' },
    { id: 'cos-brute-vest', name: 'BIKER VEST', tag: 'BRUTE · EPIC', img: 'gear_brute_vest.png', coins: 4500, tint: '#9b5cff' },
    { id: 'cos-brute-durag', name: 'BLUE DURAG', tag: 'BRUTE · COMMON', img: 'gear_brute_durag.png', coins: 900, tint: '#5b6b8c' },
    { id: 'cos-lynn-goggles', name: 'NEON GOGGLES', tag: 'LYNN · LEGENDARY', img: 'gear_lynn_goggles.png', usdc: 1.99, tint: '#ffb020' },
    { id: 'cos-lynn-vest', name: 'MEDIC VEST', tag: 'LYNN · RARE', img: 'gear_lynn_vest.png', coins: 2800, tint: '#1E90FF' },
    { id: 'cos-mach-gloves', name: 'GRIP GLOVES', tag: 'MACH · COMMON', img: 'gear_mach_gloves.png', coins: 900, tint: '#5b6b8c' },
    { id: 'cos-lynn-boots', name: 'TRAIL BOOTS', tag: 'LYNN · COMMON', img: 'gear_lynn_boots.png', coins: 900, tint: '#5b6b8c' },
  ],
  coins: [
    { id: 'coins-s', name: 'POUCH', tag: '1,000 COINS', img: '', usdc: 0.99, tint: '#ffb020', amount: 1000 },
    { id: 'coins-m', name: 'STACK', tag: '5,500 COINS', img: '', usdc: 4.99, tint: '#ffb020', amount: 5500 },
    { id: 'coins-l', name: 'CHEST', tag: '12,000 COINS', img: '', usdc: 9.99, tint: '#ffb020', amount: 12000 },
    { id: 'coins-xl', name: 'VAULT', tag: '30,000 COINS', img: '', usdc: 19.99, tint: '#ffb020', amount: 30000 },
  ],
};

/** Placeholder rivals for the boards until the score service exists. */
export const RIVALS: { name: string; cls: CharacterId; chain: number; dist: number }[] = [
  { name: 'NeonVandal', cls: 'mach', chain: 186420, dist: 9120 },
  { name: 'Kofi.Ryde', cls: 'brute', chain: 171300, dist: 11840 },
  { name: 'AdaZoom', cls: 'lynn', chain: 158760, dist: 10310 },
  { name: 'LagosLight', cls: 'mach', chain: 142010, dist: 8740 },
  { name: 'IronTemi', cls: 'brute', chain: 129880, dist: 12650 },
  { name: 'MedicMira', cls: 'lynn', chain: 117450, dist: 9980 },
  { name: 'SkywayZed', cls: 'mach', chain: 98330, dist: 7020 },
  { name: 'Bolt_Ife', cls: 'lynn', chain: 86210, dist: 8460 },
  { name: 'GrindKing', cls: 'brute', chain: 74300, dist: 9310 },
  { name: 'Chidi.R', cls: 'mach', chain: 61090, dist: 5880 },
];
