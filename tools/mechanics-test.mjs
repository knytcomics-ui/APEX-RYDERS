// Focused mechanics checks: runs the real simulation headlessly inside the dev page
// (no rendering involved) and prints PASS/FAIL per rule.
// Usage: node tools/mechanics-test.mjs      (dev server must be running on :5180)
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exe = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
const port = 9335;
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-mech-'));
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
// Windows: Edge's launcher hands off to new processes, so kill() and tree kills miss them.
const killTree = () => {
  // every Edge process started with this run's private profile folder, whatever its parent
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(PROFILE)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`, { stdio: 'ignore', timeout: 60000 }); } catch { /* best effort */ }
};
process.on('exit', killTree);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5180/?lab=rider' });
for (let i = 0; i < 40; i++) {
  await sleep(500);
  const ok = await send('Runtime.evaluate', { returnByValue: true, expression: '!!window.apexSim' });
  if (ok.result?.value) break;
}

// Everything below runs in the page against the real Sim class.
const suite = () => {
  const { Sim, STEP, TUNING, CHASM } = window.apexSim;
  const out = [];
  const check = (name, pass, detail = '') => out.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  const run = (sim, seconds) => { for (let t = 0; t < seconds; t += STEP) sim.step(STEP); };
  const fresh = (momentum = 0, seed = 7) => { const s = new Sim({ seed, god: true }); run(s, 1); s.momentum = momentum; s.events.length = 0; return s; };
  const airtime = (sim) => { let t = 0; while (sim.airborne && t < 10) { sim.step(STEP); t += STEP; } return t; };
  const M = TUNING.momentum, J = TUNING.jump;

  // --- Momentum ---
  { const s = fresh(95); s.collect('momentumLarge'); check('Momentum is capped at the maximum', s.momentum === M.max, `95 + ${M.large} -> ${s.momentum}`); }
  { const s = fresh(40); for (const x of s.route.sections) x.entities = x.entities.filter((e) => e.kind !== 'momentumSmall' && e.kind !== 'momentumLarge'); run(s, 6);
    check('Momentum never regenerates on its own', s.momentum === 40, `after 6 s on pickup-free road: ${s.momentum}`); }
  { const s = fresh(0); s.collect('momentumSmall'); s.collect('momentumLarge'); check('Momentum comes from pickups', s.momentum === M.small + M.large, `${s.momentum}`); }

  // --- Normal Jump ---
  let plain;
  { const s = fresh(0); s.intent('jump'); const k = s.jumpKind; plain = airtime(s); check('Normal Jump: free, grounded', k === 'normal' && s.momentum === 0, `airtime ${plain.toFixed(2)} s`); }

  // --- Air Jump ---
  { const s = fresh(0); s.intent('jump'); run(s, 0.25); const v = s.jumpV; s.intent('jump');
    const denied = s.events.some((e) => e.type === 'denied'); const same = s.jumpV === v && s.jumpKind === 'normal';
    const t = 0.25 + airtime(s); check('Air Jump refused without Momentum, jump uninterrupted', denied && same && Math.abs(t - plain) < 0.02, `airtime ${t.toFixed(2)} s vs ${plain.toFixed(2)} s`); }
  { const s = fresh(J.airCost); s.intent('jump'); run(s, 0.25); s.intent('jump'); const k = s.jumpKind, m = s.momentum; run(s, 0.1); s.momentum = 100; s.intent('jump');
    const again = s.events.filter((e) => e.type === 'jump').length; const t = 0.35 + airtime(s);
    check('Air Jump: spends Momentum, second impulse, once per flight', k === 'air' && m === 0 && again === 2 && t > plain + 0.2, `cost ${J.airCost}, airtime ${t.toFixed(2)} s, jump events ${again}`); }
  { const s = fresh(100); run(s, 0.2); s.intent('jump'); check('Air Jump is not available from the ground', s.jumpKind === 'normal' && s.momentum === 100); }

  // --- Surge Jump ---
  let surgeT;
  { const s = fresh(M.max - 1); s.intent('down'); check('Surge Jump refused below a full meter', !s.airborne && s.momentum === M.max - 1 && s.events.some((e) => e.type === 'denied')); }
  { const s = fresh(M.max); s.intent('down'); const k = s.jumpKind, m = s.momentum; let peak = 0, t = 0; while (s.airborne && t < 10) { s.step(STEP); t += STEP; peak = Math.max(peak, s.jumpY); } surgeT = t;
    check('Surge Jump: full meter only, spends all of it, far stronger', k === 'surge' && m === 0 && t > plain * 1.8, `airtime ${t.toFixed(2)} s, apex ${peak.toFixed(1)} m`); }
  { const s = fresh(M.max); s.intent('jump'); run(s, 0.2); s.intent('down'); check('Surge Jump cannot start in mid-air', s.jumpKind === 'normal' && s.momentum === M.max); }

  // --- lethal hazards ---
  // Ride (god mode) until the first hazard of `kind` is `lead` metres ahead in the given lane, then make the rider mortal.
  const toHazard = (kind, lead, laneOf, momentum = 0, seed = 7, character = 'mach') => {
    const s = new Sim({ seed, god: true, character });
    let guard = 0;
    while ((!s.hazard || s.hazard.kind !== kind || s.hazard.z0 - s.s > 260) && guard++ < 800000) s.step(STEP);
    const h = s.hazard, lane = laneOf(h);
    while (s.lane !== lane) { s.intent(lane < s.lane ? 'left' : 'right'); run(s, 0.3); }
    while (h.z0 - s.s > lead) s.step(STEP);
    s.god = false; s.momentum = momentum; s.events.length = 0;
    return { s, h };
  };
  const toChasm = (lead, laneOf, momentum = 0, seed = 7, character = 'mach') => toHazard('chasm', lead, laneOf, momentum, seed, character);
  const toPillars = (lead, laneOf, momentum = 0, seed = 7, character = 'mach') => toHazard('pillars', lead, laneOf, momentum, seed, character);
  const toSpill = (lead, laneOf, momentum = 0, seed = 7, character = 'mach') => toHazard('mutantSpill', lead, laneOf, momentum, seed, character);
  const outcome = (s, h, seconds = 8) => { let t = 0; while (s.alive && s.s < h.z1 + 40 && t < seconds) { s.step(STEP); t += STEP; } return s.alive && s.s >= h.z1 ? 'crossed' : s.alive ? 'pending' : 'dead'; };
  const other = (h) => (h.safeLane + 2) % 5;
  const ramp = (h) => h.safeLane;

  { const { s, h } = toChasm(60, other); const gapS = (h.z1 - h.z0) / s.speed;
    check('Chasm spans every lane; gap is beyond Jump + Air Jump, within Surge', gapS > plain + 0.66 && gapS < surgeT * TUNING.jump.surgeSpeedBoost, `gap ${(h.z1 - h.z0)} m = ${gapS.toFixed(2)} s at ${s.speed.toFixed(0)} m/s; ramp lane ${h.safeLane}`); }
  { const { s, h } = toChasm(60, other); const r = outcome(s, h); const fell = s.events.some((e) => e.type === 'fall'); const fallFirst = s.events.findIndex((e) => e.type === 'fall') < s.events.findIndex((e) => e.type === 'dead');
    check('Riding into the gap: falls, then the run ends', r === 'dead' && fell && fallFirst && s.jumpY < -2, `fell to ${s.jumpY.toFixed(1)} m over ${s.fallT.toFixed(2)} s`); }
  { const { s, h } = toChasm(60, ramp); const r = outcome(s, h); const viaRamp = s.events.some((e) => e.type === 'jump' && e.jump === 'ramp');
    const land = s.events.find((e) => e.type === 'land');
    check('Ramp lane carries the rider across', r === 'crossed' && viaRamp && !!land && land.z > h.z1 && s.hp === TUNING.survival.hp, `touched down ${land ? (land.z - h.z1).toFixed(0) : '?'} m past the far edge`); }
  { const { s, h } = toChasm(60, ramp); s.character; // (ramp works for any character: no ability involved)
    check('Ramp crossing needs no Momentum', s.momentum === 0 && outcome(s, h) === 'crossed'); }
  { const { s, h } = toChasm(8, other, M.max); s.intent('down'); const r = outcome(s, h); const ev = s.events.find((e) => e.type === 'cross');
    check('Mach Surge Jump clears the Chasm from any lane', r === 'crossed' && ev && ev.jump === 'surge', `launched 8 m before the edge`); }
  { const { s, h } = toChasm(3, other); s.intent('jump'); const r = outcome(s, h); const overEdgeAlive = true;
    check('Normal Jump cannot clear it (falls where it comes down, not at the edge)', r === 'dead' && overEdgeAlive, `came down ${(s.events.find((e) => e.type === 'fall').z - h.z0).toFixed(0)} m into a ${(h.z1 - h.z0)} m gap`); }
  { const { s, h } = toChasm(3, other, J.airCost); s.intent('jump'); let t = 0; while (s.jumpY > 0.3 || s.jumpV > 0) { s.step(STEP); if ((t += STEP) > 3) break; } s.intent('jump'); const used = s.jumpKind === 'air'; const r = outcome(s, h);
    check('Jump + best-timed Air Jump still cannot clear it', used && r === 'dead', `came down ${(s.events.find((e) => e.type === 'fall').z - h.z0).toFixed(0)} m into a ${(h.z1 - h.z0)} m gap`); }
  { const { s, h } = toChasm(3, other); s.intent('jump'); run(s, 0.3); check('Still alive while airborne past the near edge', s.alive && !s.falling && s.s > h.z0, `${(s.s - h.z0).toFixed(1)} m past the edge, ${s.jumpY.toFixed(1)} m up`); }
  { const { s, h } = toChasm(150, other, M.max); s.intent('down'); check('Surge launched far too early comes down short', outcome(s, h) === 'dead'); }

  // --- Pillars & Smash ---
  const SM = TUNING.smash;
  const died = (s) => s.events.some((e) => e.type === 'crash' && e.hazard === 'pillars');
  { // every lane: exactly one passage
    const res = [0, 1, 2, 3, 4].map((l) => { const { s, h } = toPillars(60, () => l); return { l, safe: h.safeLane, r: outcome(s, h) }; });
    const passes = res.filter((x) => x.r === 'crossed');
    check('Pillars: exactly one of five lanes is passable', passes.length === 1 && passes[0].l === res[0].safe, res.map((x) => `lane ${x.l}: ${x.r}`).join(', ')); }
  { // generation: varied safe lanes, deterministic per seed
    const collect = (seed) => { const s = new Sim({ seed, god: true }); const m = new Map(); let t = 0;
      while (s.s < 20000 && t++ < 3000000) { s.step(STEP); for (const sec of s.route.sections) for (const h of sec.hazards) if (h.kind === 'pillars') m.set(h.z0, h.safeLane); }
      return [...m.entries()]; };
    const a = collect(7), b = collect(7), lanes = new Set(a.map((x) => x[1]));
    check('Pillars safe lane varies per encounter, deterministic for a seed', a.length >= 3 && lanes.size > 1 && JSON.stringify(a) === JSON.stringify(b), `${a.length} encounters in 20 km, safe lanes ${a.map((x) => x[1]).join(',')}`); }
  { const { s, h } = toPillars(30, other, 60, 7, 'brute'); s.intent('down'); const sm = s.events.find((e) => e.type === 'smash'); const m = s.momentum; const r = outcome(s, h);
    check(`Brute Smash: costs ${SM.cost}, destroys the pillars, passes a blocked lane`, !!sm && sm.lanes.length === 4 && m === 60 - SM.cost && h.cleared && r === 'crossed' && s.invuln === 0, `momentum 60 -> ${m}, lane ${s.lane} (safe ${h.safeLane})`); }
  { const { s, h } = toPillars(30, other, SM.cost - 1, 7, 'brute'); s.intent('down'); const d = s.events.find((e) => e.type === 'denied'); const m = s.momentum; const r = outcome(s, h);
    check('Smash refused without enough Momentum; state preserved', d && d.reason === 'momentum' && m === SM.cost - 1 && !h.cleared && r === 'dead', `refused at ${m}, then ${r}`); }
  { const { s, h } = toPillars(200, other, 100, 7, 'brute'); s.intent('down'); const d = s.events.find((e) => e.type === 'denied');
    const open = fresh(100); const b = new Sim({ seed: 7, god: true, character: 'brute' }); run(b, 1); b.momentum = 100; b.events.length = 0; b.intent('down'); const d2 = b.events.find((e) => e.type === 'denied');
    check('Smash outside the activation window does nothing', d && d.reason === 'noTarget' && s.momentum === 100 && !h.cleared && d2 && d2.reason === 'noTarget' && b.momentum === 100, `window ${SM.window} s ≈ ${(SM.window * s.speed).toFixed(0)} m; tried at 200 m and on open road`); void open; }
  { const { s, h } = toPillars(30, other, 100, 7, 'brute'); s.intent('down'); s.intent('down'); s.intent('down'); const n = s.events.filter((e) => e.type === 'smash').length; const m = s.momentum;
    let cleared = 0; for (const sec of s.route.sections) for (const x of sec.hazards) if (x.cleared) cleared++;
    check('One Smash = one encounter; repeat presses do nothing', n === 1 && m === 100 - SM.cost && cleared === 1, `smash events ${n}, momentum ${m}, cleared encounters ${cleared}`); }
  { const { s, h } = toPillars(30, other, 60, 7, 'mach'); s.intent('down'); const r = outcome(s, h);
    check('Mach cannot Smash (S is Surge for him)', !s.events.some((e) => e.type === 'smash') && !h.cleared && r === 'dead'); }
  { const rs = ['mach', 'lynn'].map((ch) => { const { s, h } = toPillars(60, (x) => x.safeLane, 0, 7, ch); return outcome(s, h); });
    check('Mach and Lynn ride through the safe passage', rs.every((r) => r === 'crossed'), `mach: ${rs[0]}, lynn (sim only): ${rs[1]}`); }
  { // each launched so the bike is high in the air as it reaches the pillar face
    const hit = (s) => s.events.find((e) => e.type === 'crash');
    const v0 = toPillars(60, other).s.speed; // launch distances scale with speed so each flight peaks at the face
    const a = toPillars(v0 * 0.36, other); a.s.intent('jump'); const ra = outcome(a.s, a.h);
    const b = toPillars(v0 * 0.6, other, J.airCost); b.s.intent('jump'); run(b.s, 0.25); b.s.intent('jump'); const usedAir = b.s.jumpKind === 'air'; const rb = outcome(b.s, b.h);
    const c2 = toPillars(40, other, M.max); c2.s.intent('down'); const usedSurge = c2.s.jumpKind === 'surge'; const rc = outcome(c2.s, c2.h);
    const ha = hit(a.s), hb = hit(b.s), hc = hit(c2.s);
    check('Jump, Air Jump and Surge Jump never clear Pillars', ra === 'dead' && usedAir && rb === 'dead' && usedSurge && rc === 'dead' && !!ha && !!hb && !!hc,
      `hit the pillar mid-flight at ${ha ? (ha.y - a.h.z0 * 0).toFixed(1) : '?'} / ${hb ? hb.y.toFixed(1) : '?'} / ${hc ? hc.y.toFixed(1) : '?'} m (jump / air / surge)`); }
  { const { s, h } = toPillars(20, other); s.invuln = 5; const hp = s.hp, def = s.def; let t = 0; while (s.alive && t < 3) { s.step(STEP); t += STEP; }
    const crash = s.events.find((e) => e.type === 'crash');
    check('Pillars kill outright: full HP, DEF and invulnerability do not help', hp === 2 && def === 2 && !s.alive && s.hp === 0 && !!crash && Math.abs(s.s - (h.z0 - 0.6)) < 0.01, `stopped ${(h.z0 - s.s).toFixed(1)} m before the face`); }
  { const { s, h } = toPillars(30, (x) => x.safeLane); while (s.s < h.z0 - 1) s.step(STEP); s.intent(h.safeLane > 0 ? 'left' : 'right'); run(s, 0.3);
    check('Steering out of the passage into the pillars is lethal', !s.alive && died(s), 'lane change started 1 m before the face'); }

  // --- counters stay with their own hazard ---
  { const { s, h } = toChasm(30, other, 100, 7, 'brute'); s.intent('down'); const d = s.events.find((e) => e.type === 'denied'); const r = outcome(s, h);
    check('Brute cannot Smash the Chasm', d && d.reason === 'noTarget' && s.momentum === 100 && r === 'dead'); }
  { const { s, h } = toChasm(60, ramp, 0, 7, 'brute'); check('Brute crosses the Chasm by the ramp', outcome(s, h) === 'crossed'); }
  { const s = new Sim({ seed: 7, god: true, character: 'brute' }); run(s, 1); s.momentum = 100; s.intent('jump'); run(s, 0.25); s.intent('jump');
    check('Brute has no Air Jump', s.jumpKind === 'normal' && s.momentum === 100); }

  // --- Mutant Spill & Mutagen Repellent (R4) ---
  const RP = TUNING.repellent;
  const grabbedBy = (s) => s.events.some((e) => e.type === 'crash' && e.hazard === 'mutantSpill');
  { const res = [0, 1, 2, 3, 4].map((l) => { const { s, h } = toSpill(60, () => l); return { l, safe: h.safeLane, r: outcome(s, h) }; });
    const passes = res.filter((x) => x.r === 'crossed');
    check('Mutant Spill: four lanes occupied, exactly one passage', passes.length === 1 && passes[0].l === res[0].safe, res.map((x) => `lane ${x.l}: ${x.r}`).join(', ')); }
  { const collect = (seed) => { const s = new Sim({ seed, god: true }); const m = new Map(); let t = 0;
      while (s.s < 20000 && t++ < 3000000) { s.step(STEP); for (const sec of s.route.sections) for (const h of sec.hazards) if (h.kind === 'mutantSpill') m.set(h.z0, h.safeLane); }
      return [...m.entries()]; };
    const a = collect(7), b = collect(7), lanes = new Set(a.map((x) => x[1]));
    check('Spill passage varies per encounter, deterministic for a seed', a.length >= 3 && lanes.size > 1 && JSON.stringify(a) === JSON.stringify(b), `${a.length} encounters in 20 km, passages ${a.map((x) => x[1]).join(',')}`); }
  { const { s, h } = toSpill(30, other, 60, 7, 'lynn'); s.intent('down'); const ev = s.events.find((e) => e.type === 'repel'); const m = s.momentum; const r = outcome(s, h);
    const stillThere = s.route.sections.some((x) => x.hazards.includes(h));
    check(`Lynn Repellent: costs ${RP.cost}, crosses an occupied lane, organism stays`, !!ev && m === 60 - RP.cost && h.repelled && !h.cleared && stillThere && r === 'crossed' && s.invuln === 0, `momentum 60 -> ${m}, lane ${s.lane} (passage ${h.safeLane})`); }
  { const { s, h } = toSpill(30, other, RP.cost - 1, 7, 'lynn'); s.intent('down'); const d = s.events.find((e) => e.type === 'denied'); const m = s.momentum; const lane = s.lane; const r = outcome(s, h);
    check('Repellent refused without enough Momentum; ride unchanged', d && d.reason === 'momentum' && m === RP.cost - 1 && !h.repelled && lane === other(h) && r === 'dead' && grabbedBy(s), `refused at ${m}, then ${r}`); }
  { const early = toSpill(200, other, 100, 7, 'lynn'); early.s.intent('down'); const d1 = early.s.events.find((e) => e.type === 'denied');
    const late = toSpill(30, (h) => h.safeLane, 100, 7, 'lynn'); while (late.s.s < late.h.z0 + 3) late.s.step(STEP); late.s.intent('down'); const d2 = late.s.events.find((e) => e.type === 'denied');
    const open = new Sim({ seed: 7, god: true, character: 'lynn' }); run(open, 1); open.momentum = 100; open.events.length = 0; open.intent('down'); const d3 = open.events.find((e) => e.type === 'denied');
    check('Repellent on open road, too early or too late does nothing', [d1, d2, d3].every((d) => d && d.reason === 'noTarget') && early.s.momentum === 100 && late.s.momentum === 100 && open.momentum === 100 && !early.h.repelled && !late.h.repelled,
      'tried 200 m out, 3 m inside the organism, and on open road'); }
  { const { s, h } = toSpill(30, other, 100, 7, 'lynn'); s.intent('down'); s.intent('down'); const n = s.events.filter((e) => e.type === 'repel').length; const m = s.momentum;
    outcome(s, h);
    // carry on (god) to the next Mutant Spill and meet it unprotected in an occupied lane
    s.god = true; let g = 0; while ((!s.hazard || s.hazard === h || s.hazard.kind !== 'mutantSpill' || s.hazard.z0 - s.s > 200) && g++ < 2e6) s.step(STEP);
    const h2 = s.hazard; const lane = other(h2); while (s.lane !== lane) { s.intent(lane < s.lane ? 'left' : 'right'); run(s, 0.3); }
    while (h2.z0 - s.s > 30) s.step(STEP); s.god = false; s.momentum = 0; s.events.length = 0; const r2 = outcome(s, h2);
    check('One Repellent = one encounter; it does not carry to the next Spill', n === 1 && m === 100 - RP.cost && !h2.repelled && r2 === 'dead', `repel events ${n}, momentum ${m}; next Spill ${(h2.z0 - h.z0).toFixed(0)} m on: ${r2}`); }
  { const { s, h } = toSpill(30, other, 60, 7, 'lynn'); s.intent('down'); // Repellent active, then ordinary debris in her lane
    for (const sec of s.route.sections) if (sec.s0 <= h.z1 + 20 && sec.s1 > h.z1 + 20) sec.entities.push({ kind: 'crate', lane: s.lane, s: h.z1 + 20, h: 0, taken: false });
    const def = s.def; outcome(s, h, 3); run(s, 1.2);
    check('Repellent gives no protection from ordinary debris', s.def === def - 1, `DEF ${def} -> ${s.def}`); }
  { const rs = ['mach', 'brute'].map((ch) => { const { s, h } = toSpill(60, (x) => x.safeLane, 0, 7, ch); return outcome(s, h); });
    check('Mach and Brute survive through the passage', rs.every((r) => r === 'crossed'), `mach: ${rs[0]}, brute: ${rs[1]}`); }
  { const m = toSpill(30, other, 60, 7, 'mach'); m.s.intent('down'); const rm = outcome(m.s, m.h);
    const b = toSpill(30, other, 60, 7, 'brute'); b.s.intent('down'); const db = b.s.events.find((e) => e.type === 'denied'); const rb = outcome(b.s, b.h);
    check('Mach and Brute cannot use Repellent (S is Surge / Smash for them)', !m.s.events.some((e) => e.type === 'repel') && !m.h.repelled && rm === 'dead'
      && db && db.ability === 'smash' && db.reason === 'noTarget' && b.s.momentum === 60 && !b.h.cleared && rb === 'dead', `mach: ${rm}, brute smash refused: ${rb}`); }
  { const hit = (s) => s.events.find((e) => e.type === 'crash' && e.hazard === 'mutantSpill');
    const v0 = toSpill(60, other).s.speed;
    const a = toSpill(v0 * 0.36, other); a.s.intent('jump'); const ra = outcome(a.s, a.h);
    const b = toSpill(v0 * 0.6, other, J.airCost); b.s.intent('jump'); run(b.s, 0.25); b.s.intent('jump'); const usedAir = b.s.jumpKind === 'air'; const rb = outcome(b.s, b.h);
    const c2 = toSpill(40, other, M.max); c2.s.intent('down'); const usedSurge = c2.s.jumpKind === 'surge'; const rc = outcome(c2.s, c2.h);
    const ha = hit(a.s), hb = hit(b.s), hc = hit(c2.s);
    check('Jump, Air Jump and Surge Jump never clear the Spill (seized mid-air)', ra === 'dead' && usedAir && rb === 'dead' && usedSurge && rc === 'dead' && !!ha && !!hb && !!hc,
      `seized at ${ha ? ha.y.toFixed(1) : '?'} / ${hb ? hb.y.toFixed(1) : '?'} / ${hc ? hc.y.toFixed(1) : '?'} m (jump / air / surge)`); }
  { const { s, h } = toSpill(20, other); s.invuln = 5; const hp = s.hp, def = s.def; let t = 0, wasGrabbed = false; while (s.alive && t < 3) { s.step(STEP); t += STEP; wasGrabbed ||= s.grabbed; }
    const dead = s.events.findIndex((e) => e.type === 'dead'), crash = s.events.findIndex((e) => e.type === 'crash');
    check('Spill kills outright: full HP, DEF and invulnerability do not help', hp === 2 && def === 2 && !s.alive && s.hp === 0 && wasGrabbed && crash >= 0 && dead > crash && s.jumpY < -1,
      `grabbed, pulled ${(-s.jumpY).toFixed(1)} m under over ${s.grabT.toFixed(2)} s`); }
  { const { s, h } = toSpill(30, (x) => x.safeLane); while (s.s < h.z0 + 2) s.step(STEP); s.intent(h.safeLane > 0 ? 'left' : 'right'); run(s, 1.2); // seized, then 0.75 s to be pulled under
    check('Steering out of the passage inside the Spill is lethal', !s.alive && grabbedBy(s)); }
  { const c1 = toChasm(30, other, 100, 7, 'lynn'); c1.s.intent('down'); const d1 = c1.s.events.find((e) => e.type === 'denied'); const r1 = outcome(c1.s, c1.h);
    const p1 = toPillars(30, other, 100, 7, 'lynn'); p1.s.intent('down'); const d2 = p1.s.events.find((e) => e.type === 'denied'); const r2 = outcome(p1.s, p1.h);
    check('Repellent does not counter the Chasm or Pillars', d1 && d1.reason === 'noTarget' && r1 === 'dead' && d2 && d2.reason === 'noTarget' && r2 === 'dead' && c1.s.momentum === 100 && p1.s.momentum === 100); }
  { const s = new Sim({ seed: 7, god: true, character: 'lynn' }); run(s, 1); s.momentum = 100; s.intent('jump'); run(s, 0.25); s.intent('jump');
    const { s: c, h } = toChasm(60, ramp, 0, 7, 'lynn');
    check('Lynn: no Air Jump; crosses the Chasm by the ramp', s.jumpKind === 'normal' && s.momentum === 100 && outcome(c, h) === 'crossed'); }

  // --- R5: Scrap (Brute) & Full Heal (Lynn), on the secondary input ---
  {
    const SC = TUNING.scrap, FH = TUNING.fullHeal;
    const rider = (character, momentum = 0) => { const s = new Sim({ seed: 7, god: true, character }); run(s, 1); s.god = false; s.momentum = momentum; s.events.length = 0; return s; };
    const denied = (s) => s.events.find((e) => e.type === 'denied');
    { const s = rider('brute', 40); const def = s.def, hp = s.hp, sc0 = s.score;
      s.intent('ability'); const on = s.scrapT, chainNow = s.scoreChain; s.collect('coin'); const gained = s.score - sc0;
      check('Scrap: exactly one DEF, no Momentum, chain doubled', s.events.some((e) => e.type === 'scrap') && s.def === def - 1 && s.hp === hp && s.momentum === 40 && on === SC.duration && chainNow === s.chain * SC.chainFactor && gained === TUNING.score.coin * SC.chainFactor * s.chain && s.invuln === 0,
        `DEF ${def} -> ${s.def}, Momentum 40 -> ${s.momentum}, chain x${s.chain} scores x${chainNow} (coin +${gained})`); }
    { const s = rider('brute'); s.intent('ability'); let t = 0; while (s.scrapT > 0 && t < 10) { s.step(STEP); t += STEP; }
      check('Scrap ends on its own after the configured duration', Math.abs(t - SC.duration) < 0.02 && s.scoreChain === s.chain, `lasted ${t.toFixed(2)} s (config ${SC.duration} s)`); }
    { const s = rider('brute'); s.intent('ability'); run(s, 2); const left = s.scrapT, def = s.def; s.events.length = 0; s.intent('ability'); s.intent('ability'); const d = denied(s);
      check('Scrap while active: refused, no extra DEF, no stacking or extension', d && d.reason === 'active' && s.def === def && s.scrapT === left && s.scoreChain === s.chain * SC.chainFactor, `${left.toFixed(2)} s left, unchanged; DEF ${s.def}`); }
    { const s = rider('brute'); s.def = 0; const hp = s.hp; s.intent('ability'); const d = denied(s);
      check('Scrap at zero DEF is refused; restores nothing', d && d.reason === 'noDef' && s.def === 0 && s.hp === hp && s.scrapT === 0); }
    { const { s, h } = toPillars(30, other, 0, 7, 'brute'); s.intent('ability'); const active = s.scrapT > 0; const r = outcome(s, h);
      check('Scrap gives no hazard protection (blocked Pillars lane)', active && r === 'dead' && !h.cleared, `Scrap active, then ${r}`); }
    { const { s, h } = toPillars(30, other, 60, 7, 'brute'); s.intent('ability'); s.intent('down'); const m = s.momentum, def = s.def; const r = outcome(s, h);
      check('Smash still works alongside Scrap', h.cleared && m === 60 - TUNING.smash.cost && r === 'crossed' && def === TUNING.survival.def - 1, `Momentum 60 -> ${m}, DEF ${def}, ${r}`); }
    { const s = rider('mach', 100); const before = JSON.stringify([s.hp, s.def, s.momentum, s.scrapT]); s.intent('ability');
      check('Mach has no secondary ability: E / tap changes nothing', s.events.length === 0 && JSON.stringify([s.hp, s.def, s.momentum, s.scrapT]) === before); }
    { const s = rider('lynn', 60); s.def = 0; s.hp = 1; s.intent('ability');
      check(`Full Heal: HP back to max for ${FH.cost} Momentum, DEF untouched`, s.events.some((e) => e.type === 'heal') && s.hp === TUNING.survival.hp && s.momentum === 60 - FH.cost && s.def === 0, `HP 1 -> ${s.hp}, Momentum 60 -> ${s.momentum}, DEF 0 -> ${s.def}`); }
    { const s = rider('lynn', 100); s.def = 1; s.intent('ability'); const d = denied(s);
      check('Full Heal at full HP: refused, costs nothing', d && d.reason === 'hpFull' && s.momentum === 100 && s.hp === TUNING.survival.hp && s.def === 1); }
    { const s = rider('lynn', FH.cost - 1); s.hp = 1; s.intent('ability'); const d = denied(s);
      check('Full Heal without enough Momentum: refused, nothing changes', d && d.reason === 'momentum' && s.momentum === FH.cost - 1 && s.hp === 1); }
    { const s = rider('lynn', 100); s.hp = 1; s.intent('ability'); s.intent('ability'); const heals = s.events.filter((e) => e.type === 'heal').length;
      check('Full Heal never exceeds max HP (second press refused)', heals === 1 && s.hp === TUNING.survival.hp && s.momentum === 100 - FH.cost); }
    { const { s, h } = toSpill(30, other, 100, 7, 'lynn'); s.hp = 1; s.intent('ability'); s.intent('down'); const r = outcome(s, h);
      check('Repellent still works after a Full Heal', s.hp === TUNING.survival.hp && h.repelled && r === 'crossed' && s.momentum === 0, `Momentum 100 -> heal -> repel -> ${s.momentum}`); }
    { const s = rider('brute'); s.def = 0; s.hp = 1; s.events.length = 0;
      for (const sec of s.route.sections) if (sec.s0 <= s.s + 30 && sec.s1 > s.s + 30) sec.entities.push({ kind: 'crate', lane: s.lane, s: s.s + 30, h: 0, taken: false });
      run(s, 2); const dead = !s.alive; const def = s.def; s.intent('ability'); s.intent('down'); s.intent('jump');
      const l = new Sim({ seed: 7, god: true, character: 'lynn' }); run(l, 1); l.god = false; l.momentum = 100; l.def = 0; l.hp = 1;
      for (const sec of l.route.sections) if (sec.s0 <= l.s + 30 && sec.s1 > l.s + 30) sec.entities.push({ kind: 'crate', lane: l.lane, s: l.s + 30, h: 0, taken: false });
      run(l, 2); const deadL = !l.alive; l.events.length = 0; l.intent('ability');
      check('No ability after game over (ordinary damage unchanged: DEF then HP)', dead && def === 0 && s.scrapT === 0 && !s.events.some((e) => e.type === 'scrap' || e.type === 'denied')
        && deadL && l.hp === 0 && l.momentum === 100 && l.events.length === 0); }
  }

  // --- R4.1 pacing & Momentum economy (12 seeds x 8 km) ---
  {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], KM = 8;
    const P = TUNING.pickups, MV = { momentumSmall: M.small, momentumLarge: M.large };
    const walk = (seed) => {
      const s = new Sim({ seed, god: true }); const secs = new Map(); let t = 0;
      while (s.s < KM * 1000 && t++ < 4000000) { s.step(STEP); for (const x of s.route.sections) if (!secs.has(x.index)) secs.set(x.index, x); }
      return [...secs.values()].filter((x) => x.s1 <= KM * 1000).sort((a, b) => a.index - b.index);
    };
    const firsts = [], gaps = [], kinds = { chasm: 0, pillars: 0, mutantSpill: 0 }, repeats = [], detours = [];
    let minFromDetour = Infinity, badPickups = 0, forks = 0, bridges = 0;
    const role = { main: { m: 0, len: 0 }, safe: { m: 0, len: 0 }, risky: { m: 0, len: 0 } };
    const bruteGaps = []; let sig1 = '', sig2 = '';
    seeds.forEach((seed, si) => {
      const secs = walk(seed);
      const hz = secs.flatMap((x) => x.hazards.map((h) => ({ ...h, idx: x.index })));
      if (si === 0) { sig1 = JSON.stringify(hz.map((h) => [h.kind, h.z0, h.safeLane])); sig2 = JSON.stringify(walk(seed).flatMap((x) => x.hazards.map((h) => [h.kind, h.z0, h.safeLane]))); }
      if (hz.length) firsts.push(hz[0].z0);
      hz.forEach((h, i) => { kinds[h.kind]++; if (i) { gaps.push(h.z0 - hz[i - 1].z1); repeats.push(h.kind === hz[i - 1].kind); } });
      // a gap stretched by a fork or the bridge
      hz.forEach((h, i) => { if (i && secs.some((x) => x.s0 > hz[i - 1].z1 && x.s1 < h.z0 && (x.def.kind === 'split' || x.def.kind === 'rampUp'))) detours.push(h.z0 - hz[i - 1].z1); });
      for (const x of secs) {
        if (x.def.kind === 'split') forks++;
        if (x.def.kind === 'rampUp') bridges++;
        if (['split', 'branch', 'merge', 'rampUp', 'bridge', 'rampDown'].includes(x.def.kind)) for (const h of hz) if (h.z0 > x.s1) { minFromDetour = Math.min(minFromDetour, h.z0 - x.s1); break; }
        // Momentum supply by carriageway role
        if (!x.hazards.length) for (const rb of x.ribbons) role[rb.role].len += x.length;
        for (const e of x.entities) {
          if (!(e.kind in MV)) continue;
          for (const h of hz) if (e.s > h.z0 - P.hazardClearance && e.s < h.z1) badPickups++;
          if (!x.hazards.length) role[x.ribbons[x.laneRibbon[e.lane]].role].m += MV[e.kind];
        }
      }
      // Momentum on offer between consecutive Pillars encounters (Brute)
      const pil = hz.filter((h) => h.kind === 'pillars');
      for (let i = 1; i < pil.length; i++) {
        let m = 0; for (const x of secs) for (const e of x.entities) if (e.kind in MV && e.s > pil[i - 1].z1 && e.s < pil[i].z0 - P.hazardClearance) m += MV[e.kind];
        bruteGaps.push(m);
      }
    });
    const sorted = (a) => [...a].sort((x, y) => x - y), med = (a) => sorted(a)[a.length >> 1], pct = (a, p) => sorted(a)[Math.floor((a.length - 1) * p)];
    const perKm = (r) => (role[r].len ? (role[r].m / role[r].len) * 1000 : 0).toFixed(0);
    check('First lethal encounter within 300-600 m on every seed', firsts.length === seeds.length && Math.min(...firsts) >= 300 && Math.max(...firsts) <= 600, `first near edge: ${sorted(firsts).map((v) => v.toFixed(0)).join(', ')} m`);
    check('Encounter spacing short and variable, never clustered', Math.min(...gaps) >= 250 && med(gaps) <= 700 && pct(gaps, 0.9) - pct(gaps, 0.1) > 150,
      `far edge -> next near edge: min ${Math.min(...gaps).toFixed(0)}, p10 ${pct(gaps, 0.1).toFixed(0)}, median ${med(gaps).toFixed(0)}, p90 ${pct(gaps, 0.9).toFixed(0)}, max ${Math.max(...gaps).toFixed(0)} m (${gaps.length} gaps)`);
    check('All three hazards in the mix, order not a fixed pattern', kinds.chasm > 5 && kinds.pillars > 5 && kinds.mutantSpill > 5 && repeats.some(Boolean) && !repeats.every(Boolean),
      `chasm ${kinds.chasm}, pillars ${kinds.pillars}, mutant spill ${kinds.mutantSpill}; same-as-previous ${repeats.filter(Boolean).length}/${repeats.length}`);
    check('Hazard sequence reproducible for a seed', sig1 === sig2 && sig1.length > 10);
    let sharpN = 0; for (const seed of seeds.slice(0, 4)) for (const x of walk(seed)) if (Math.abs(x.def.turn) >= 0.45) sharpN++;
    check('Forks, the bridge and sharp turns still appear; hazards keep clear of them', forks > 0 && bridges > 0 && sharpN > 0 && minFromDetour >= 100,
      `${forks} forks, ${bridges} bridges over ${seeds.length * KM} km, ${sharpN} sharp turns over ${4 * KM} km; ${detours.length}/${gaps.length} gaps stretched by one (median ${detours.length ? med(detours).toFixed(0) : '-'} m); nearest hazard edge after a fork/bridge section: ${minFromDetour.toFixed(0)} m`);
    check('No Momentum inside or right before a lethal hazard', badPickups === 0, `clearance ${P.hazardClearance} m`);
    check('Momentum on offer on every kind of road', +perKm('main') >= 45 && +perKm('safe') >= 60 && +perKm('risky') > +perKm('safe'),
      `per km: main road ${perKm('main')}, safe fork ${perKm('safe')}, risky shortcut ${perKm('risky')} (+ ${P.hazardApproach.large * M.large + (P.hazardApproach.small + 1) * M.small} around each hazard)`);
    check('Brute: Smash usually possible between Pillars, not guaranteed', bruteGaps.length > 5 && med(bruteGaps) >= TUNING.smash.cost,
      `between consecutive Pillars: p10 ${pct(bruteGaps, 0.1)}, median ${med(bruteGaps)}, mean ${(bruteGaps.reduce((a, b) => a + b, 0) / bruteGaps.length).toFixed(0)}, under ${TUNING.smash.cost}: ${bruteGaps.filter((g) => g < TUNING.smash.cost).length}/${bruteGaps.length} intervals (on offer across all lanes)`);
  }

  // --- existing systems ---
  { const s = fresh(0); const l = s.lane; s.intent('left'); run(s, 0.3); const a = s.lane; s.intent('right'); run(s, 0.3); s.intent('right'); run(s, 0.3);
    check('Lane movement unchanged', a === l - 1 && s.lane === l + 1); }
  { const kinds = new Set(); let sharp = 0;
    for (const seed of [7, 11, 23]) { const s = new Sim({ seed, god: true }); let t = 0; while (s.s < 6000 && t++ < 2000000) { s.step(STEP); kinds.add(s.sec.def.kind); if (Math.abs(s.sec.def.turn) >= 0.45) sharp++; } }
    const need = ['split', 'branch', 'merge', 'chasm', 'pillars', 'mutantSpill', 'bridge'];
    check('Route still branches and bridges; Chasms, Pillars and sharp turns appear', need.every((k) => kinds.has(k)) && sharp > 0, [...kinds].join(', ') + (sharp ? ', sharp turns' : '')); }
  { const s = new Sim({ seed: 3, attract: true }); let t = 0; while (s.s < 4000 && t++ < 2000000) s.step(STEP); check('Title-screen cruise never meets a lethal hazard', s.alive && !s.route.sections.some((x) => x.hazards.length)); }
  return out.join('\n');
};

const res = await send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(${suite.toString()})()` });
console.log(res.result?.value ?? JSON.stringify(res).slice(0, 1500));
ws.close(); killTree(); process.exit(0);
