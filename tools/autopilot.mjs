// Pacing playthrough: drives the real game (headless Edge, real GPU, real key presses) with a
// simple autopilot and logs the encounter timeline, Momentum flow and ability use.
// Usage: node tools/autopilot.mjs <seed> <mach|brute> [seconds]      (dev server on :5180)
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [seed = '3', rider = 'mach', secs = '90'] = process.argv.slice(2);
const exe = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
const port = 9337 + (rider === 'brute' ? 1 : 0);
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-auto-'));
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`,
  '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--no-first-run', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
// Windows: Edge's launcher hands off to new processes, so kill() and tree kills miss them.
const killTree = () => {
  // every Edge process started with this run's private profile folder, whatever its parent
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(PROFILE)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(ps, 'utf16le').toString('base64')}`, { stdio: 'ignore', timeout: 60000 }); } catch { /* best effort */ }
};
process.on('exit', killTree);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// watchdog: a hung browser (or a machine that slept) must never stall the run forever
const watchdog = setTimeout(() => { console.log(`\n${rider.toUpperCase()} seed ${seed} — ABORTED: no progress (browser hung)`); try { killTree(); } catch { /* */ } process.exit(2); }, (Number(secs) + 90) * 1000);
let target;
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description); };
const send = (method, params = {}) => new Promise((r, j) => { const n = ++id; const t = setTimeout(() => { pending.delete(n); j(new Error(`CDP ${method} timed out`)); }, 15000); pending.set(n, (v) => { clearTimeout(t); r(v); }); ws.send(JSON.stringify({ id: n, method, params })); });
const key = async (code, k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:5180/?autostart=1&seed=${seed}${rider === 'brute' ? '&rider=brute' : ''}` });
for (let i = 0; i < 60; i++) { await sleep(250); const r = await send('Runtime.evaluate', { returnByValue: true, expression: `!!(window.apex && window.apex.scene.getScene('game') && window.apex.scene.getScene('game').sim)` }); if (r.result?.value) break; }

const READ = `(() => { const s = window.apex.scene.getScene('game').sim, h = s.hazard, ents = [];
  for (const x of s.route.sections) { if (x.s1 < s.s || x.s0 > s.s + s.speed * 2.2) continue;
    for (const e of x.entities) if (!e.taken && e.s > s.s - 1 && e.s < s.s + s.speed * 2.2) ents.push([e.kind, e.lane, +(e.s - s.s).toFixed(1)]); }
  return JSON.stringify({ t: +s.time.toFixed(2), s: +s.s.toFixed(1), lane: s.lane, laneT: s.laneT, v: s.speed, m: s.momentum, alive: s.alive, air: s.airborne, kind: s.jumpKind, hp: s.hp, def: s.def, coins: s.coins,
    sec: s.sec.def.kind, canL: s.sec.canCross(s.lane, s.lane - 1, s.s), canR: s.sec.canCross(s.lane, s.lane + 1, s.s),
    h: h ? { k: h.kind, z0: h.z0, z1: h.z1, safe: h.safeLane, c: !!h.cleared } : null, offer: !!(s.hazardAhead() && s.hazardAhead().bypassReady), ents }); })()`;

const log = [], encounters = new Map(), trace = [];
let prev = null, gained = 0, hits = 0, smashes = 0, surges = 0, lastKey = 0;
const T0 = Date.now();
while (Date.now() - T0 < Number(secs) * 1000) {
  const st = JSON.parse((await send('Runtime.evaluate', { returnByValue: true, expression: READ })).result.value);
  if (prev) {
    if (st.m > prev.m) gained += st.m - prev.m;
    if (st.def + st.hp < prev.def + prev.hp && st.alive) hits++;
    if (st.kind === 'surge' && prev.kind !== 'surge') surges++;
    if (st.h && st.h.c && prev.h && !prev.h.c) smashes++;
  }
  // --- encounter bookkeeping ---
  if (st.h) {
    const e = encounters.get(st.h.z0) ?? { kind: st.h.k, z0: st.h.z0, seenAt: null, mAtWarn: null, action: '-', result: '?' };
    const dist = st.h.z0 - st.s;
    if (e.seenAt === null && dist < st.v * 3.2) { e.seenAt = st.t; e.mAtWarn = st.m; e.sAt = st.s; }
    const near = st.s > st.h.z0 - 60 && st.s < st.h.z1; // only flights at this encounter count
    if (st.h.c) e.action = 'SMASH'; else if (near && st.kind === 'surge') e.action = 'SURGE'; else if (near && st.kind === 'ramp') e.action = 'ramp'; else if (near && e.action === '-' && st.s > st.h.z0) e.action = st.h.k === 'pillars' ? 'gap' : '-';
    if (st.s > st.h.z1 && st.alive) e.result = 'crossed';
    encounters.set(st.h.z0, e);
  }
  for (const e of encounters.values()) if (e.result === '?' && st.s > e.z0 + 80 && st.alive) e.result = 'crossed';
  trace.push(`t=${st.t.toFixed(2)} s=${st.s.toFixed(1)} lane=${st.lane} laneT=${st.laneT.toFixed(2)} v=${st.v.toFixed(0)} h=${st.h ? st.h.k + '@' + (st.h.z0 - st.s).toFixed(1) + 'm safe ' + st.h.safe : '-'} canL=${st.canL} canR=${st.canR}`); if (trace.length > 14) trace.shift();
  if (!st.alive) { if (process.env.TRACE) log.push('last states:\n    ' + trace.join('\n    '));
    for (const e of encounters.values()) if (e.result === '?' && e.seenAt !== null) e.result = 'DIED'; log.push(`died at ${st.s.toFixed(0)} m, t=${st.t}s (${st.sec})`); break; }

  // --- autopilot ---
  const now = Date.now(), ready = st.laneT >= 1 && now - lastKey > 90;
  const h = st.h && !st.h.c && st.s < st.h.z1 + 2 && st.h.z0 - st.s < st.v * 3.2 ? st.h : null; // hold the passage until past the far edge
  let targetLane = st.lane;
  if (h) {
    const dist = h.z0 - st.s;
    if (rider === 'brute' && h.k === 'pillars' && st.m >= 50 && dist <= st.v * 1.4 && dist > 2) { await key('KeyS', 's'); lastKey = now; }
    if (rider === 'mach' && h.k === 'chasm' && st.offer) { await key('KeyS', 's'); lastKey = now; }
    targetLane = h.safe;
  } else {
    // score lanes: Momentum > coins; avoid debris; prefer staying put
    const score = [0, 1, 2, 3, 4].map((l) => -Math.abs(l - st.lane) * 0.4);
    for (const [k, l, dz] of st.ents) {
      if (dz < 3) continue;
      if (k === 'momentumLarge') score[l] += 4; else if (k === 'momentumSmall') score[l] += 2.2; else if (k === 'coin') score[l] += 0.15;
      else if (dz < st.v * 1.1) score[l] -= 12;
    }
    targetLane = score.indexOf(Math.max(...score));
    // last-moment hop over a barricade we can't steer around
    const ahead = st.ents.find(([k, l, dz]) => l === st.lane && (k === 'crate' || k === 'barricade') && dz > 0 && dz < st.v * 0.3);
    if (ahead && ahead[0] === 'barricade' && !st.air && targetLane === st.lane) { await key('KeyW', 'w'); lastKey = now; }
  }
  if (ready && targetLane !== st.lane) {
    const left = targetLane < st.lane;
    if (left ? st.canL : st.canR) { await key(left ? 'KeyA' : 'KeyD', left ? 'a' : 'd'); lastKey = now; }
  }
  prev = st;
  await sleep(35);
}
const fin = prev;
const encs = [...encounters.values()].filter((e) => e.seenAt !== null);
console.log(`\n${rider.toUpperCase()}  seed ${seed}  — ${fin.t.toFixed(0)} s of play, ${fin.s.toFixed(0)} m, ${fin.alive ? 'still alive' : 'run ended'}`);
console.log(`Momentum collected ${gained} (${(gained / (fin.s / 1000)).toFixed(0)}/km, ${(gained / (fin.t / 60)).toFixed(0)}/min); now ${fin.m}; coins ${fin.coins}; debris hits ${hits}; smashes ${smashes}; surges ${surges}`);
let lastT = 0;
for (const e of encs) {
  console.log(`  t=${String(e.seenAt.toFixed(1)).padStart(5)}s  ${String(e.z0.toFixed(0)).padStart(5)} m  ${e.kind.padEnd(8)} (+${(e.seenAt - lastT).toFixed(1)}s)  momentum ${String(e.mAtWarn).padStart(3)} at warning  -> ${e.action.padEnd(5)} ${e.result}`);
  lastT = e.seenAt;
}
for (const l of log) console.log('  ' + l);
if (errors.length) console.log('PAGE ERRORS:', errors.join('\n'));
ws.close(); killTree(); process.exit(0);
