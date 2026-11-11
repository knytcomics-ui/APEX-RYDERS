/**
 * Screen templates (Changes & UI v2.4, section 5). Pure functions: state in, HTML out.
 * Interactive elements carry data-a="<action>" (+ data-v) and are handled in menu.ts.
 */
import type { CharacterId } from '../core/config';
import { A, CLASSES, DEF, HP, PAINTS, PERKS, RIVALS, SHOP, TUNES, TUNE_MAX, cls, tuneCost, type ClassDef, type ShopItem } from './data';
import { I, coin, usdc } from './icons';
import { bestFor, levelOf, masteryOf, profile, type RunReward } from './store';

export type ScreenId = 'splash' | 'home' | 'modes' | 'classes' | 'garage' | 'onboarding' | 'run' | 'over' | 'profile' | 'board' | 'shop' | 'settings';
export type ShopTab = keyof typeof SHOP;

export interface UIState {
  garageIdx: number;
  classIdx: number;
  profileCls: CharacterId;
  shopTab: ShopTab;
  boardTab: 'open' | 'class';
  boardCls: CharacterId;
  onbStep: number;
  last?: { cls: CharacterId; score: number; dist: number; coins: number; reward: RunReward; rankBefore: number; rankAfter: number; verified: boolean };
  online: boolean;
}

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pips = (kind: 'hp' | 'def', on: number, max: number, extra = '') => `<span class="pips ${kind} ${extra}">${Array.from({ length: max }, (_, i) => `<i class="${i < on ? 'on' : ''}"></i>`).join('')}</span>`;
const bar = (frac: number, kind = '') => `<div class="bar ${kind}"><i style="width:calc(${Math.max(0, Math.min(1, frac)) * 100}% - .36em)"></i></div>`;
const lvBadge = (lv: number, big = false) => `<div class="lv ${big ? 'big' : ''}"><span><small>LV</small>${lv}</span></div>`;
const usdcFmt = (v: number) => v.toFixed(2);

// ---------- shared chrome ----------

export function topbar(title: string, sub = '', opts: { back?: boolean } = {}) {
  const lvl = levelOf(profile.xp).level;
  const left = opts.back === false
    ? `<button class="chip-user" data-a="go" data-v="profile" aria-label="Profile"><img src="${A(`${profile.selected}_avatar.png`)}" alt=""><span class="nm">${esc(profile.name)}<small>LEVEL ${lvl}</small></span></button>`
    : `<button class="sq back" data-a="back" aria-label="Back">${I.back}</button><img class="logo hide-sm" src="assets/logo.png" alt="Apex Ryders"><div class="title-tag"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  return `<header class="topbar">${left}<div class="spacer"></div>
    <div class="pill" title="Coins">${coin()}<span>${n(profile.coins)}</span><button class="add" data-a="shop-tab" data-v="coins" aria-label="Get coins">${I.plus}</button></div>
    <div class="pill hide-sm" title="USDC">${usdc()}<span>${profile.wallet ? usdcFmt(profile.wallet.usdc) : '—'}</span><button class="add" data-a="wallet" aria-label="Wallet">${I.plus}</button></div>
    <button class="sq" data-a="wallet" aria-label="Wallet">${I.wallet}${profile.wallet ? '' : '<span class="dot"></span>'}</button>
    <button class="sq" data-a="go" data-v="settings" aria-label="Settings">${I.gear}</button></header>`;
}

// ---------- 5.1 boot and entry ----------

export function splash(progress: number) {
  const lines = Array.from({ length: 9 }, (_, i) => `<i style="top:${8 + i * 10.5}%;width:${18 + ((i * 37) % 30)}vw;animation-delay:${-(i * 0.37) % 1.2}s;opacity:${0.25 + ((i * 13) % 5) / 10}"></i>`).join('');
  const tips = ['TIP: THE CHAIN MULTIPLIER IS YOUR SCORE — DON\'T GET TOUCHED', 'TIP: EVERY LETHAL HAS EXACTLY ONE SAFE LANE', 'TIP: EACH CLASS IGNORES ONE LETHAL ENTIRELY'];
  return `<section class="screen splash"><div class="speedlines">${lines}</div>
    <img class="logo-hero" src="assets/logo.png" alt="Apex Ryders">
    <div class="load">${bar(progress, 'gold')}<div class="tip"><span class="pct">LOADING ${Math.round(progress * 100)}%</span> · ${tips[Math.floor(Math.random() * tips.length)]}</div></div></section>`;
}

export function home() {
  const sel = cls(profile.selected);
  const rider = (c: ClassDef, style: string, h: string, flip = false) =>
    `<button class="rider ${flip ? 'flip' : ''}" style="${style};--h:${h}" data-a="pick-class" data-v="${c.id}" aria-label="${c.name}">
      <img class="bk" src="${A(`${c.id}_bike.png`)}" alt=""><img class="bd" src="${A(`${c.id}_body.png`)}" alt=""></button>`;
  const best = bestFor();
  const tile = (a: string, v: string, icon: string, label: string, small: string) =>
    `<button class="tile-btn" data-a="${a}" data-v="${v}"><span class="ib">${icon}</span><span>${label}<small>${small}</small></span></button>`;
  return `<section class="screen home see-through">${topbar('', '', { back: false })}
    <div class="stage">
      ${best.score ? `<div class="best panel dark plain row hide-sm"><span class="cyan">BEST CHAIN</span><b>${n(best.score)}</b><span class="cyan">· FURTHEST</span><b>${n(best.dist)} m</b></div>` : ''}
      <div class="hero"><div class="glow"></div>
        ${rider(cls('brute'), 'left:3%', 'min(24vh,19vw)', false)}
        ${rider(cls('lynn'), 'right:3%', 'min(24vh,19vw)', true)}
        ${rider(cls('mach'), 'left:50%;translate:-50% 0;bottom:4%', 'min(31vh,25vw)')}
      </div>
    </div>
    <div class="dock">
      <div class="side">
        ${tile('go', 'garage', I.wrench, 'GARAGE', 'TUNE YOUR BIKE')}
        ${tile('go', 'shop', I.cart, 'SHOP', 'SKINS · COINS')}
        ${tile('go', 'board', I.trophy, 'LEADERBOARD', 'OPEN · CLASS')}
      </div>
      <div class="start-col">
        <img class="logo" style="height:6.5em" src="assets/logo.png" alt="Apex Ryders">
        <button class="btn big" data-a="go" data-v="modes">${I.play}START</button>
        <button class="run-mode" data-a="go" data-v="classes"><span style="color:${sel.color}">●</span> RIDING AS ${sel.name} <span class="cyan">· CHANGE</span></button>
      </div>
      <div class="side">
        ${tile('go', 'classes', I.user, 'CLASSES', 'MACH · BRUTE · LYNN')}
        ${tile('go', 'profile', I.star, 'PROFILE', `LEVEL ${levelOf(profile.xp).level}`)}
        ${tile('go', 'settings', I.gear, 'SETTINGS', 'SOUND · CONTROLS')}
      </div>
    </div></section>`;
}

export function walletModal(stage: 'pick' | 'connecting' | 'connected', kind?: string) {
  const note = `<p class="foot-note">We never hold your keys. Coins are earned in-game and never cash out — USDC is only used for eligible purchases.<br>Demo build: wallet connection is simulated until the Stellar SDK is wired in.</p>`;
  if (stage === 'connecting') {
    return `<div class="modal panel"><h2>CONNECTING…</h2><div class="row" style="justify-content:center;margin:1.4em 0"><div class="spinner" style="width:3em;height:3em"></div></div>
      <p class="muted">Approve the request in ${kind === 'albedo' ? 'Albedo' : 'Freighter'}.</p></div>`;
  }
  if (stage === 'connected' && profile.wallet) {
    const a = profile.wallet.address;
    return `<div class="modal panel"><button class="sq x" data-a="modal-close" aria-label="Close">${I.close}</button>
      <span class="tag green">${I.check} WALLET CONNECTED</span>
      <h2>${profile.wallet.kind === 'albedo' ? 'ALBEDO' : 'FREIGHTER'}</h2>
      <div class="addr"><span>${a.slice(0, 6)}…${a.slice(-6)}</span><button class="add" data-a="copy-addr" aria-label="Copy address" style="color:var(--cyan)">${I.copy}</button></div>
      <div class="balance">${usdc()}<span>${usdcFmt(profile.wallet.usdc)}</span><small class="cyan" style="font-size:.4em">USDC</small></div>
      <div class="actions"><button class="btn red sm" data-a="wallet-disconnect">DISCONNECT</button><button class="btn" data-a="modal-close">DONE</button></div>${note}</div>`;
  }
  return `<div class="modal panel"><button class="sq x" data-a="modal-close" aria-label="Close">${I.close}</button>
    <h2>CONNECT WALLET</h2><p class="muted">Link a Stellar wallet for USDC purchases and settlements.</p>
    <button class="wallet-opt" data-a="wallet-connect" data-v="freighter"><span class="wl" style="background:linear-gradient(160deg,#7c4dff,#3b1e9a)">F</span><span class="grow">FREIGHTER<small>Browser extension</small></span>${I.chevR}</button>
    <button class="wallet-opt" data-a="wallet-connect" data-v="albedo"><span class="wl" style="background:linear-gradient(160deg,#ffe36b,#ffb300);color:#2a1a00">A</span><span class="grow">ALBEDO<small>Web wallet · no install</small></span>${I.chevR}</button>
    <div class="actions"><button class="btn ghost sm" data-a="modal-close">SKIP FOR NOW</button></div>
    <p class="muted" style="font-size:.85em">Play never needs a wallet.</p>${note}</div>`;
}

// ---------- 5.2 choosing a run ----------

export function modes() {
  return `<section class="screen">${topbar('MODE SELECT', 'CHOOSE YOUR RIDE')}
    <div class="body"><div class="modes">
      <button class="mode-card headline" data-a="go" data-v="classes"><span class="big-ic">${I.flag}</span><img class="art" src="${A('mach_bike.png')}" alt="">
        <span class="tag">HEADLINE MODE</span><h3>ENDLESS</h3>
        <p>Five lanes, no finish line. Ride as far as you can and keep the chain alive — distance and chain both count.</p>
        <span class="row" style="margin-top:.6em"><span class="btn sm">${I.play}RIDE</span></span></button>
      <button class="mode-card locked" data-a="toast" data-v="Time Attack unlocks at account level 5"><span class="big-ic">${I.timer}</span><img class="art" src="${A('lynn_bike.png')}" alt="">
        <span class="tag dark">${I.lock} LEVEL 5</span><h3>TIME ATTACK</h3>
        <p>Set tracks against the clock. Tracks unlock as you level.</p>
        <span class="tag cyan">0 / 6 TRACKS</span></button>
      <button class="mode-card locked" data-a="toast" data-v="Versus is coming soon"><span class="big-ic">${I.vs}</span><img class="art" src="${A('brute_bike.png')}" alt="">
        <span class="tag violet">UPCOMING</span><h3>VERSUS</h3>
        <p>Head-to-head runs. The Sweeper closes in from behind — last rider standing wins.</p>
        <span class="tag dark">COMING SOON</span></button>
    </div></div></section>`;
}

const breezeGlyph: Record<CharacterId, string> = { mach: '⛰', brute: '▮▮', lynn: '☣' };

export function classes(st: UIState) {
  const card = (c: ClassDef, i: number) => `<button class="class-card ${i === st.classIdx ? 'sel' : ''}" style="--cc:${c.color}" data-a="class-idx" data-v="${i}">
      <span class="tag sel-mark">${I.check} SELECTED</span>
      <img class="banner" src="${A(`${c.id}_banner.png`)}" alt="${c.name}">
      <span class="info">
        <span class="stat-line"><b class="red">HP</b>${pips('hp', HP, HP)}<span></span></span>
        <span class="stat-line"><b class="cyan">DEF</b>${pips('def', DEF, DEF)}<span></span></span>
        <span class="muted" style="font-size:.85em">Breezes the <b style="color:${c.color}">${c.breezes}</b></span>
      </span></button>`;
  const c = CLASSES[st.classIdx];
  const ab = (a: ClassDef['signature'], label: string) => `<div class="ability"><img src="${A(a.icon)}" alt="">
      <div><span class="tag ${label === 'SIGNATURE' ? '' : 'cyan'}">${label}</span><h4>${a.name}</h4>
      <span class="inp muted">${a.input} <span class="key">${a.key}</span></span><div class="muted" style="font-size:.9em">${a.text}</div></div></div>`;
  return `<section class="screen">${topbar('CLASS SELECT', 'ENDLESS')}
    <div class="body"><div class="classes">${CLASSES.map(card).join('')}</div>
      <div class="panel" style="margin-top:1.1em;--cc:${c.color}">
        <div class="row" style="flex-wrap:wrap"><span class="hdr" style="background:linear-gradient(90deg,${c.color},${c.dark} 80%,transparent)">${c.name} · ${c.role} KIT</span>
          <span class="muted">${c.tagline}</span></div>
        <div class="kit">${ab(c.signature, 'SIGNATURE')}${ab(c.utility, c.id === 'mach' ? 'PASSIVE' : 'UTILITY')}</div>
        <div class="breeze" style="margin-top:1em"><span style="font-size:1.8em;color:${c.color}">${breezeGlyph[c.id]}</span>
          <span><b>IGNORES THE ${c.breezes}</b><br><span class="muted">${c.breezesText}. The other two lethals still need the safe lane.</span></span></div>
      </div></div>
    <div class="footer-cta"><button class="btn navy" data-a="go" data-v="garage">${I.wrench}GARAGE</button><button class="btn big" data-a="ride">${I.play}RIDE AS ${c.name}</button></div></section>`;
}

export function garage(st: UIState) {
  const c = CLASSES[st.garageIdx], t = profile.tunes[c.id];
  const tunes = TUNES.map((u) => {
    const lvl = t[u.id], maxed = lvl >= TUNE_MAX, cost = tuneCost(lvl), afford = profile.coins >= cost;
    return `<div class="tune"><img src="${A(u.icon)}" alt=""><div><b>${u.name}</b><span class="muted" style="font-size:.8em"> · LV ${lvl}/${TUNE_MAX}</span>
      <div class="segs">${Array.from({ length: TUNE_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div></div>
      ${maxed ? '<span class="tag green">MAX</span>' : `<button class="btn sm ${afford ? '' : 'off'}" data-a="tune" data-v="${u.id}">${coin()}${n(cost)}</button>`}</div>`;
  }).join('');
  const paints = PAINTS[c.id].map((p, i) => `<button class="swatch ${profile.paint[c.id] === i ? 'on' : ''}" data-a="paint" data-v="${i}"><i style="background:${p.css}"></i>${p.name}</button>`).join('');
  return `<section class="screen" style="--cc:${c.color}">${topbar('GARAGE', `${c.name}'S MOTORCYCLE`)}
    <div class="body"><div class="garage">
      <div class="panel"><span class="hdr" style="background:linear-gradient(90deg,${c.color},${c.dark} 80%,transparent)">${c.name} · ${c.role}</span>
        <div class="carousel">
          <button class="sq nav l" data-a="garage-step" data-v="-1" aria-label="Previous bike">${I.chevL}</button>
          <img class="bike" src="${A(`${c.id}_bike.png`)}" alt="${c.name}'s bike">
          <div class="plat"></div>
          <button class="sq nav r" data-a="garage-step" data-v="1" aria-label="Next bike">${I.chevR}</button>
          <div class="dots">${CLASSES.map((_, i) => `<i class="${i === st.garageIdx ? 'on' : ''}"></i>`).join('')}</div>
        </div>
        <span class="hdr yellow" style="margin-top:.8em">PAINT FINISH</span><div class="swatches">${paints}</div>
        <span class="hdr yellow" style="margin-top:1.1em">BIKE PERKS</span><div class="perks">${PERKS.map((p) => `<div class="perk" title="${p.text}"><img src="${A(p.icon)}" alt="">${p.name}</div>`).join('')}</div>
      </div>
      <div class="grid" style="align-content:start">
        <div class="panel"><span class="hdr">SURVIVAL</span>
          <div class="locked-stats">
            <div class="lockline"><b class="red" style="width:2.6em">HP</b>${pips('hp', HP, HP, 'locked')}<span class="spacer" style="flex:1"></span>${I.lock}<span class="muted" style="font-size:.8em">LOCKED</span></div>
            <div class="lockline"><b class="cyan" style="width:2.6em">DEF</b>${pips('def', DEF, DEF, 'locked')}<span class="spacer" style="flex:1"></span>${I.lock}<span class="muted" style="font-size:.8em">LOCKED</span></div>
            <span class="muted" style="font-size:.8em">HP and DEF are identical for every rider and can never be bought. No pay-to-win.</span>
          </div></div>
        <div class="panel"><span class="hdr">TUNE</span><span class="muted" style="font-size:.8em;display:block;margin:-.2em 0 .3em">Handling and speed feel — the only thing coins buy on a bike.</span>${tunes}</div>
      </div></div></div></section>`;
}

const ONB = [
  { title: 'STEER', cards: [{ ic: I.swipeSide, b: 'SWIPE / TAP SIDEWAYS', s: 'Change lane · A / D' }, { ic: I.swipeUp, b: 'SWIPE UP', s: 'Jump · W / Space' }] },
  { title: 'YOUR ABILITIES', cards: [{ ic: I.swipeDown, b: 'SWIPE DOWN', s: 'Signature ability · S' }, { ic: I.tap, b: 'TAP', s: 'Utility ability · E' }] },
  { title: 'STAY ALIVE', cards: [{ ic: I.heart, b: 'HP & DEF PIPS', s: 'Hits cost DEF first, then HP' }, { ic: I.star, b: 'KEEP THE CHAIN', s: 'Never get touched — the chain is your score' }] },
];
export function onboarding(st: UIState) {
  const step = ONB[st.onbStep], last = st.onbStep === ONB.length - 1;
  return `<section class="screen onb"><div class="onb-card panel"><button class="skip" data-a="onb-skip">SKIP ${I.chevR}</button>
    <span class="tag cyan">HOW TO RIDE · ${st.onbStep + 1}/${ONB.length}</span><h2 style="font-size:2.4em;margin:.3em 0 0">${step.title}</h2>
    <div class="gest">${step.cards.map((c) => `<div class="gesture">${c.ic}<b>${c.b}</b><span class="muted">${c.s}</span></div>`).join('')}</div>
    <div class="steps">${ONB.map((_, i) => `<i class="${i <= st.onbStep ? 'on' : ''}"></i>`).join('')}</div>
    <button class="btn" data-a="onb-next">${last ? `${I.play}LET'S RIDE` : `NEXT ${I.chevR}`}</button></div></section>`;
}
export const ONB_STEPS = ONB.length;

// ---------- 5.3 in-run ----------

export function runLayer() {
  return `<div class="pause-btn"><button class="sq" data-a="pause" aria-label="Pause">${I.pause}</button></div>`;
}

export function pauseModal(s: { score: number; dist: number; coins: number }) {
  return `<div class="modal panel pause-card"><span class="tag cyan">RUN FROZEN</span><h2>PAUSED</h2>
    <div class="kv"><div class="panel dark plain"><span class="cyan">SCORE</span><b class="num" style="font-size:1.4em">${n(s.score)}</b></div>
      <div class="panel dark plain"><span class="cyan">DIST</span><b class="num" style="font-size:1.4em">${n(s.dist)} m</b></div>
      <div class="panel dark plain" style="grid-column:span 2;justify-content:center">${coin()}<b class="num" style="font-size:1.4em">${n(s.coins)}</b><span class="muted">coins this run</span></div></div>
    <div class="stack"><button class="btn" data-a="resume">${I.play}RESUME</button>
      <button class="btn blue" data-a="restart">${I.retry}RESTART</button>
      <button class="btn navy" data-a="go" data-v="settings">${I.gear}SETTINGS</button>
      <button class="btn red" data-a="quit">${I.exit}QUIT</button></div></div>`;
}

// ---------- 5.4 after the run ----------

export function over(st: UIState) {
  const L = st.last!;
  const c = cls(L.cls), r = L.reward, m = masteryOf(profile.mastery[L.cls]);
  const moved = L.rankAfter < L.rankBefore;
  return `<section class="screen">${topbar('RUN OVER', 'ENDLESS · ' + c.name)}
    <div class="body"><div class="over-wrap">
      <div class="grid">
        <div class="panel hl hero-figure"><h2 class="wrecked">WRECKED!</h2>
          <div class="lbl">BEST CHAIN SCORE</div><div class="num">${n(L.score)}</div>
          ${r.newBest ? '<span class="tag new-best">★ NEW PERSONAL BEST</span>' : ''}</div>
        <div class="kv">
          <div class="panel"><span class="ib cyan">${I.flag}</span><div><div class="cyan" style="font-size:.8em">DISTANCE</div><b class="num">${n(L.dist)} m</b></div></div>
          <div class="panel">${coin()}<div><div class="gold" style="font-size:.8em">COINS EARNED</div><b class="num">+${n(L.coins)}</b></div></div>
        </div>
      </div>
      <div class="grid">
        <div class="panel"><span class="hdr">LEADERBOARD</span>
          <div class="verify">${L.verified ? `<span class="green">${I.check}</span><span>${st.online ? 'RUN SAVED TO YOUR PROFILE' : 'OFFLINE — UPLOADS ON RECONNECT'}</span>` : '<span class="spinner"></span><span>VERIFYING RUN…</span>'}</div>
          <div class="row" style="margin-top:.7em"><span class="tag ${moved ? 'green' : 'dark'}">${moved ? '▲' : '■'} OPEN #${L.rankAfter}</span>
          <span class="muted">${moved ? `up ${L.rankBefore - L.rankAfter} place${L.rankBefore - L.rankAfter > 1 ? 's' : ''}` : 'position held'}</span></div></div>
        <div class="panel"><span class="hdr">PROGRESS</span>
          <div class="bar-label"><span>ACCOUNT LV ${r.after.level}${r.leveledUp ? ' <span class="tag" style="font-size:.75em">LEVEL UP!</span>' : ''}</span><span class="cyan">+${n(r.xp)} XP</span></div>
          ${bar(r.after.into / r.after.need)}
          <div class="bar-label" style="margin-top:.8em"><span style="color:${c.color}">${c.name} MASTERY LV ${m.level}</span><span class="cyan">+${n(r.mastery)}</span></div>
          ${bar(m.into / m.need, c.id === 'lynn' ? 'green' : c.id === 'mach' ? 'gold' : '')}</div>
      </div></div></div>
    <div class="footer-cta"><button class="btn navy" data-a="home">${I.home}HOME</button><button class="btn blue" data-a="go" data-v="classes">${I.user}CLASS</button><button class="btn big" data-a="ride-again">${I.retry}RIDE AGAIN</button></div></section>`;
}

export function profileScreen(st: UIState) {
  const c = cls(st.profileCls), lv = levelOf(profile.xp), m = masteryOf(profile.mastery[c.id]);
  const runs = profile.runs.filter((r) => r.cls === c.id).slice(0, 5);
  const strip = CLASSES.map((k) => `<button class="${k.id === c.id ? 'sel' : ''}" style="--cc:${k.color}" data-a="profile-cls" data-v="${k.id}">
      <img src="${A(`${k.id}_avatar.png`)}" alt="${k.name}"><span class="lvl">${masteryOf(profile.mastery[k.id]).level}</span></button>`).join('');
  return `<section class="screen" style="--cc:${c.color}">${topbar('PROFILE', esc(profile.name))}
    <div class="body"><div class="profile">
      <div class="owned-strip">${strip}<div class="lock">${I.lock}</div></div>
      <div class="panel" style="display:flex;flex-direction:column">
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div><span class="name-tag">${c.name}</span><div class="cyan" style="margin-top:.3em">▚ ${c.role}</div></div>
          <div class="row">${lvBadge(lv.level, true)}</div></div>
        <div class="render-zone"><div class="plat"></div><img class="bk" src="${A(`${c.id}_bike.png`)}" alt=""><img class="bd" src="${A(`${c.id}_body.png`)}" alt=""></div>
        <div class="bar-label"><span>${c.name} MASTERY LV ${m.level}</span><span class="muted">${n(m.into)} / ${n(m.need)}</span></div>${bar(m.into / m.need, 'violet')}
      </div>
      <div class="grid" style="align-content:start">
        <div class="panel"><span class="hdr">RIDER</span>
          <div class="row" style="justify-content:space-between"><b style="font-size:1.4em">${esc(profile.name)}</b><button class="btn sm navy" data-a="rename">RENAME</button></div>
          <div class="bar-label" style="margin-top:.8em"><span>ACCOUNT LV ${lv.level}</span><span class="muted">${n(lv.into)} / ${n(lv.need)} XP</span></div>${bar(lv.into / lv.need)}
          <div class="select" style="margin-top:1em"><select data-a="profile-select" aria-label="Class">${CLASSES.map((k) => `<option value="${k.id}" ${k.id === c.id ? 'selected' : ''}>${k.name} — ${k.role}</option>`).join('')}</select>${I.chevD}</div></div>
        <div class="panel"><span class="hdr">TOP SCORES · ${c.name}</span>
          <div class="list">${runs.length ? runs.map((r, i) => `<div class="li"><span class="rk">#${i + 1}</span><span class="who"><span>${n(r.score)}</span></span><span class="muted">${n(r.dist)} m</span></div>`).join('') : '<span class="muted">No runs yet as ' + c.name + '. Go ride!</span>'}</div></div>
        <div class="panel"><span class="hdr">EQUIPMENT</span><div class="gear-row">${c.gear.map((g) => `<img src="${A(g.icon)}" alt="${g.name}" title="${g.name}">`).join('')}</div></div>
      </div></div></div></section>`;
}

// ---------- 5.5 meta and economy ----------

interface Entry { name: string; cls: CharacterId; chain: number; dist: number; me?: boolean }
export function boardEntries(tab: 'open' | 'class', bc: CharacterId): Entry[] {
  const me: Entry[] = [];
  const b = bestFor(tab === 'class' ? bc : undefined);
  const myCls = tab === 'class' ? bc : profile.runs[0]?.cls ?? profile.selected;
  if (b.score || b.dist) me.push({ name: profile.name, cls: myCls, chain: b.score, dist: b.dist, me: true });
  const pool = [...RIVALS.filter((r) => tab === 'open' || r.cls === bc), ...me];
  return pool.sort((a, b2) => (tab === 'open' ? b2.chain - a.chain : b2.dist - a.dist));
}
export const openRank = (score: number) => 1 + RIVALS.filter((r) => r.chain > score).length;

export function board(st: UIState) {
  const list = boardEntries(st.boardTab, st.boardCls);
  const val = (e: Entry) => st.boardTab === 'open'
    ? `${n(e.chain)}<span class="mult">x${Math.max(1, Math.min(10, Math.round(e.chain / 18000)))}</span>`
    : `${n(e.dist)} m`;
  const pod = (e: Entry | undefined, p: number, color: string) => e ? `<div class="pod p${p}" style="--pc:${color}">
      <img src="${A(`${e.cls}_avatar.png`)}" alt=""><b class="nm">${esc(e.name)}</b><span class="cyan">${val(e)}</span>
      <div class="base"><span class="place">${p}</span></div></div>` : '<div></div>';
  return `<section class="screen">${topbar('LEADERBOARD', st.boardTab === 'open' ? 'OPEN BOARD · CHAIN SCORE · ALL CLASSES' : `${cls(st.boardCls).name} BOARD · DISTANCE`)}
    <div class="body"><div class="board-head">
      <div class="tabs"><button class="${st.boardTab === 'open' ? 'on' : ''}" data-a="board-tab" data-v="open">OPEN</button><button class="${st.boardTab === 'class' ? 'on' : ''}" data-a="board-tab" data-v="class">CLASS</button></div>
      ${st.boardTab === 'class' ? `<div class="seg-ctl">${CLASSES.map((c) => `<button class="${c.id === st.boardCls ? 'on' : ''}" data-a="board-cls" data-v="${c.id}">${c.name}</button>`).join('')}</div>` : '<span class="muted">Skill board: the longest untouched chain wins</span>'}
    </div>
    <div class="podium">${pod(list[1], 2, '#c0c8d8')}${pod(list[0], 1, '#ffc300')}${pod(list[2], 3, '#d08a4c')}</div>
    <div class="panel"><div class="list">${list.slice(3).map((e, i) => `<div class="li ${e.me ? 'me' : ''}"><span class="rk">#${i + 4}</span>
      <span class="who"><img src="${A(`${e.cls}_avatar.png`)}" alt=""><span>${esc(e.name)}${e.me ? ' <span class="tag" style="font-size:.7em">YOU</span>' : ''}</span></span><b>${val(e)}</b></div>`).join('')}</div>
      <p class="muted" style="font-size:.8em;margin:.8em 0 0">Season rivals shown are placeholders until the score service goes live. Your best runs are real.</p></div></div></section>`;
}

const rarity = (tag: string) => tag.includes('LEGENDARY') ? '#ffb020' : tag.includes('EPIC') ? '#9b5cff' : tag.includes('RARE') ? '#1E90FF' : '#5b6b8c';
function priceHtml(it: ShopItem) {
  if (profile.owned.includes(it.id)) return `<span class="owned-tag">${I.check} OWNED</span>`;
  if (it.coins) return `<span class="price">${coin()}${n(it.coins)}</span>`;
  return `<span class="price">${usdc()}${usdcFmt(it.usdc ?? 0)}</span>`;
}
function itemArt(it: ShopItem) {
  if (!it.img) {
    const k = it.amount! >= 30000 ? 9 : it.amount! >= 12000 ? 7 : it.amount! >= 5500 ? 5 : 3;
    return `<div class="coins-art">${Array.from({ length: k }, () => coin('')).join('')}</div>`;
  }
  return `<img src="${A(it.img)}" alt="" style="${it.filter ? `filter:${it.filter}` : ''}">`;
}
export function shop(st: UIState) {
  const items = SHOP[st.shopTab], feat = items[0];
  const tab = (id: ShopTab, label: string) => `<button class="${st.shopTab === id ? 'on' : ''}" data-a="shop-tab" data-v="${id}">${label}</button>`;
  return `<section class="screen">${topbar('SHOP', 'TWO CURRENCIES · ONE RIDE')}
    <div class="body">
      <div class="board-head"><div class="tabs">${tab('characters', 'CHARACTERS')}${tab('cosmetic', 'COSMETIC')}${tab('coins', 'COINS')}</div>
        <span class="muted">${st.shopTab === 'characters' ? 'Character skins are NFTs on Stellar — cosmetic only' : st.shopTab === 'coins' ? 'Coins are soft currency: spent in-game, never cashed out' : 'Rider gear — looks, not stats'}</span></div>
      <div class="panel featured" style="--rc:${rarity(feat.tag)}"><div class="item plain" style="padding:0;background:none;box-shadow:none"><div class="art" style="width:9em">${itemArt(feat)}</div></div>
        <div style="text-align:left"><span class="tag">★ FEATURED</span><h3>${feat.name}</h3><div class="cyan">${feat.tag}</div></div>
        ${profile.owned.includes(feat.id) ? priceHtml(feat) : `<button class="btn" data-a="buy" data-v="${feat.id}">${priceHtml(feat)}</button>`}</div>
      <div class="shop-grid">${items.slice(1).map((it) => `<button class="item" style="--rc:${rarity(it.tag)}" data-a="buy" data-v="${it.id}">
        <div class="art">${itemArt(it)}</div><b class="nm">${it.name}</b><span class="tg">${it.tag}</span>${priceHtml(it)}</button>`).join('')}</div>
    </div></section>`;
}
export function buyModal(it: ShopItem) {
  const coinsShort = !!it.coins && profile.coins < it.coins;
  const usdcShort = !!it.usdc && !!profile.wallet && profile.wallet.usdc < it.usdc;
  const needWallet = !!it.usdc && !profile.wallet;
  return `<div class="modal panel"><button class="sq x" data-a="modal-close" aria-label="Close">${I.close}</button>
    <span class="tag">CONFIRM PURCHASE</span><h2>${it.name}</h2>
    <div class="item plain" style="width:10em;margin:0 auto;--rc:${rarity(it.tag)}"><div class="art">${itemArt(it)}</div></div>
    <p class="cyan">${it.tag}</p>
    ${coinsShort ? '<p class="red">Not enough coins.</p>' : ''}${usdcShort ? '<p class="red">Insufficient USDC balance.</p>' : ''}${needWallet ? '<p class="gold">Connect a wallet to pay in USDC.</p>' : ''}
    <div class="actions"><button class="btn ghost sm" data-a="modal-close">CANCEL</button>
      ${needWallet ? `<button class="btn blue" data-a="wallet">${I.wallet}CONNECT WALLET</button>`
        : `<button class="btn ${coinsShort || usdcShort ? 'off' : it.usdc ? 'blue' : ''}" data-a="buy-confirm" data-v="${it.id}">${it.usdc ? `${usdc()} PAY ${usdcFmt(it.usdc)}` : `${coin()} BUY ${n(it.coins!)}`}</button>`}</div></div>`;
}

export function settings() {
  const s = profile.settings;
  const tog = (k: 'haptics' | 'reducedMotion', on: boolean) => `<button class="toggle ${on ? 'on' : ''}" data-a="set-toggle" data-v="${k}" role="switch" aria-checked="${on}"><i></i></button>`;
  const rng = (k: 'sound' | 'music', v: number) => `<input class="range" type="range" min="0" max="100" value="${v}" style="--v:${v}%" data-a="set-range" data-v="${k}" aria-label="${k}">`;
  const row = (ic: string, label: string, sub: string, ctl: string) => `<div class="set"><span class="ib">${ic}</span><span>${label}<br><span class="muted" style="font-size:.8em">${sub}</span></span>${ctl}</div>`;
  return `<section class="screen">${topbar('SETTINGS', 'SOUND · CONTROLS · ACCOUNT')}
    <div class="body"><div class="settings">
      <div class="grid" style="align-content:start">
        <div class="panel"><span class="hdr">AUDIO & FEEL</span>
          ${row(I.sound, 'SOUND', `${s.sound}%`, rng('sound', s.sound))}
          ${row(I.music, 'MUSIC', `${s.music}%`, rng('music', s.music))}
          ${row(I.vibrate, 'HAPTICS', 'Vibrate on hits and pickups', tog('haptics', s.haptics))}
          ${row(I.motion, 'REDUCED MOTION', 'Calmer menus and transitions', tog('reducedMotion', s.reducedMotion))}
          ${row(I.hand, 'HANDEDNESS', 'Pause button and thumb zones', `<div class="seg-ctl"><button class="${!s.leftHanded ? 'on' : ''}" data-a="set-hand" data-v="right">RIGHT</button><button class="${s.leftHanded ? 'on' : ''}" data-a="set-hand" data-v="left">LEFT</button></div>`)}
        </div>
        <div class="panel"><span class="hdr">ACCOUNT</span>
          ${row(I.globe, 'LANGUAGE', 'More languages coming', `<div class="select"><select data-a="set-lang" aria-label="Language">${['English', 'Français', 'Yorùbá', 'Hausa', 'Igbo', 'Kiswahili'].map((l) => `<option ${l === s.language ? 'selected' : ''}>${l}</option>`).join('')}</select>${I.chevD}</div>`)}
          ${row(I.wallet, 'WALLET', profile.wallet ? `${profile.wallet.address.slice(0, 6)}…${profile.wallet.address.slice(-4)}` : 'Not connected', `<button class="btn sm blue" data-a="wallet">${profile.wallet ? 'MANAGE' : 'CONNECT'}</button>`)}
          ${row(I.retry, 'REPLAY TUTORIAL', 'Show the gesture cards before the next run', `<button class="btn sm navy" data-a="reset-onb">RESET</button>`)}
        </div>
      </div>
      <div class="panel" style="align-self:start"><span class="hdr">CONTROLS</span>
        <div class="keys">
          <span class="key">A / D</span><span>Change lane <span class="muted">· tap or swipe sideways</span></span>
          <span class="key">W / SPACE</span><span>Jump <span class="muted">· swipe up</span></span>
          <span class="key">S</span><span>Signature ability <span class="muted">· swipe down</span></span>
          <span class="key">E</span><span>Utility ability <span class="muted">· tap</span></span>
          <span class="key">ESC / P</span><span>Pause</span>
        </div>
        <div class="legal"><span>APEX RYDERS v0.1.0</span><a href="#" data-a="toast" data-v="Terms of Service — coming soon">TERMS</a><a href="#" data-a="toast" data-v="Privacy Policy — coming soon">PRIVACY</a><a href="#" data-a="toast" data-v="Licences — coming soon">LICENCES</a></div>
      </div></div></div></section>`;
}

export function errorModal(title: string, msg: string) {
  return `<div class="modal panel"><span class="tag red">${I.wifiOff} CONNECTION</span><h2>${title}</h2><p class="muted">${msg}</p>
    <div class="actions"><button class="btn ghost sm" data-a="modal-close">PLAY OFFLINE</button><button class="btn" data-a="net-retry">${I.retry}RETRY</button></div></div>`;
}
export function netBanner() {
  return `<div class="net">${I.wifiOff}<span>OFFLINE — PLAY CONTINUES · SCORES UPLOAD ON RECONNECT</span><button class="btn sm navy" style="font-size:.8em" data-a="net-retry">RETRY</button></div>`;
}
