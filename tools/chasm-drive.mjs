// Plays the Chasm encounter in the real game loop with real key presses (headless Edge),
// once per scenario, and saves a screenshot of each. Dev server must be running on :5180.
// Usage: node tools/chasm-drive.mjs
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(root, 'screenshots'), { recursive: true });
const exe = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
const port = 9336;
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-chasm-'));
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`,
  // GPU=1: real graphics card (reliable real-time timing, but headless screenshots come back blank)
  ...(process.env.GPU ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']),
  '--no-first-run', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
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
const errors = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
};
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { returnByValue: true, expression })).result?.value;
const key = async (code, k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: k }); await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: k }); };
const shot = async (name) => writeFileSync(path.join(root, 'screenshots', `r2-${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
const SIM = `window.apex.scene.getScene('game').sim`;
const state = () => evalJs(`(() => { const s = ${SIM}, h = s.hazard; return JSON.stringify({ mode: window.apex.scene.getScene('game').mode, alive: s.alive, falling: s.falling, lane: s.lane, kind: s.jumpKind, y: +s.jumpY.toFixed(1), momentum: s.momentum, toEdge: h ? +(h.z0 - s.s).toFixed(1) : null, pastFar: h ? +(s.s - h.z1).toFixed(1) : null, ramp: h ? h.safeLane : null, hazard: h ? h.kind : null, cleared: h ? !!h.cleared : null, character: s.character, grabbed: s.grabbed, repel: s.repelActive, hp: s.hp, def: s.def, scrapT: +s.scrapT.toFixed(2), chain: s.chain, scoreChain: s.scoreChain, s: +s.s.toFixed(1), z1: h ? h.z1 : null, fell: s.events ? undefined : undefined, deathAt: s.alive ? null : +s.s.toFixed(1), offer: !!(s.hazardAhead() && s.hazardAhead().bypassReady) }); })()`);

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });

/** Start 85 m before the first Chasm edge (seed 7), mortal, then run `play`. */
async function scenario(name, query, play, find = 'chasm&lead=0&ride=65') {
  await send('Page.navigate', { url: `http://127.0.0.1:5180/?autostart=1&god=1&mortal=1&seed=7&find=${find}&${query}` });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await evalJs(`!!(window.apex && window.apex.scene.getScene('game') && window.apex.scene.getScene('game').sim)`)) break; }
  const edge = async (metres) => { for (let i = 0; i < 4000; i++) { const s = JSON.parse(await state()); if (s.toEdge === null || s.toEdge <= metres || !s.alive) return s; await sleep(15); } };
  const until = async (pred, ms = 90000) => { const t0 = Date.now(); for (;;) { const s = JSON.parse(await state()); if (pred(s) || Date.now() - t0 > ms) return s; await sleep(40); } };
  const result = await play({ edge, until });
  console.log(name.padEnd(34), result);
}

const blockedLane = async () => { const s = JSON.parse(await state()); return (s.ramp + 2) % 5; };
const steerTo = async (lane) => { for (let i = 0; i < 6; i++) { const s = JSON.parse(await state()); if (s.lane === lane) return; await key(lane < s.lane ? 'KeyA' : 'KeyD', lane < s.lane ? 'a' : 'd'); await sleep(220); } };
const only = process.env.ONLY;
if (!only || only === 'chasm') {
await scenario('ride straight in (no input)', 'lane=2', async ({ until }) => {
  await steerTo(await blockedLane()); // any lane but the ramp
  const f = await until((s) => s.falling); await sleep(250); await shot('chasm-fall');
  const end = await until((s) => s.mode === 'over');
  return `falling=${f.falling} -> mode=${end.mode}, alive=${end.alive}`;
});
await scenario('take the ramp lane', 'lane=2', async ({ edge, until }) => {
  const s0 = JSON.parse(await state());
  for (let l = s0.lane; l !== s0.ramp; l += Math.sign(s0.ramp - l)) { await key(s0.ramp < l ? 'KeyA' : 'KeyD', s0.ramp < l ? 'a' : 'd'); await sleep(260); }
  await edge(6); await shot('chasm-ramp-climb');
  const z1 = s0.z1;
  const mid = await until((s) => s.kind === 'ramp' && s.toEdge < -18); await shot('chasm-ramp-flight');
  const end = await until((s) => s.s > z1 + 20 || !s.alive);
  return `ramp lane ${s0.ramp}, flight=${mid.kind} at ${mid.y} m -> alive=${end.alive}, crossed=${end.alive && end.s > z1}`;
});
await scenario('Surge Jump (S) with full Momentum', 'lane=2&momentum=100', async ({ edge, until }) => {
  const z1 = (await until((s) => s.offer || s.toEdge < 1, 90000)).z1; await key('KeyS', 's'); // press when the HUD offers S = SURGE
  const up = await until((s) => s.kind === 'surge' && s.toEdge < -20); await shot('chasm-surge');
  const end = await until((s) => s.s > z1 + 20 || !s.alive);
  return `flight=${up.kind} at ${up.y} m, momentum ${up.momentum} -> alive=${end.alive}, crossed=${end.alive && end.s > z1}`;
});
await scenario('Normal Jump + Air Jump (W, W)', 'lane=2&momentum=25', async ({ edge, until }) => {
  await edge(4); await key('KeyW', 'w');
  await until((s) => s.kind === 'normal' && s.y < 1.0 && s.toEdge < -10); await key('KeyW', 'w');
  const air = JSON.parse(await state());
  const end = await until((s) => s.mode === 'over' || s.toEdge === null);
  return `second jump=${air.kind}, momentum ${air.momentum} -> mode=${end.mode}, alive=${end.alive}`;
});
await scenario('Surge without a full meter', 'lane=2&momentum=90', async ({ edge, until }) => {
  await edge(14); await key('KeyS', 's'); await sleep(120);
  const s = JSON.parse(await state());
  const end = await until((x) => x.mode === 'over');
  await sleep(process.env.GPU ? 1300 : 6000); await key('Space', ' '); await sleep(process.env.GPU ? 1500 : 5000);
  const again = JSON.parse(await state());
  return `refused (kind=${s.kind}, momentum ${s.momentum}) -> mode=${end.mode}; restart -> mode=${again.mode}, alive=${again.alive}`;
});

}
// ---------------- Pillars (R3): starts 85 m before the pillar faces ----------------
const P = 'pillars&lead=0&ride=35';
if (!only || only === 'pillars') {
await scenario('Brute: Smash (S) in a blocked lane', 'rider=brute&momentum=60', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(45); await key('KeyS', 's'); await sleep(120);
  const s = JSON.parse(await state()); await shot('pillars-smash');
  const end = await until((x) => x.hazard !== 'pillars' || !x.alive);
  return `${s.character} lane ${s.lane} (gap ${s.ramp}): cleared=${s.cleared}, momentum 60 -> ${s.momentum} -> alive=${end.alive}`;
}, P);
await scenario('Brute: Smash with 20 Momentum', 'rider=brute&momentum=20', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(45); await key('KeyS', 's'); await sleep(120);
  const s = JSON.parse(await state());
  const end = await until((x) => x.mode === 'over' || x.hazard !== 'pillars');
  return `refused: cleared=${s.cleared}, momentum ${s.momentum} (20 + approach tokens can't reach 50) -> mode=${end.mode}, alive=${end.alive}`;
}, P);
await scenario('Mach: blocked lane + Surge (S)', 'momentum=100', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(30); await key('KeyS', 's'); await sleep(100);
  const s = JSON.parse(await state());
  const end = await until((x) => x.mode === 'over' || x.hazard !== 'pillars'); await sleep(400); await shot('pillars-crash');
  return `flight=${s.kind} -> mode=${end.mode}, alive=${end.alive}, cleared=${end.cleared}`;
}, P);
await scenario('Mach: through the gap', '', async ({ edge, until }) => {
  const s0 = JSON.parse(await state()); await steerTo(s0.ramp);
  await edge(25); await shot('pillars-approach');
  const end = await until((x) => x.s > s0.z1 + 20 || !x.alive);
  return `gap lane ${s0.ramp} -> alive=${end.alive}`;
}, P);
}
// ---------------- Mutant Spill (R4): starts 85 m before the organism ----------------
const MS = 'mutantSpill&lead=0&ride=35';
if (!only || only === 'spill') {
await scenario('Lynn: Repellent (S) in an occupied lane', 'rider=lynn&momentum=60', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(40); await key('KeyS', 's'); await sleep(150);
  const s = JSON.parse(await state());
  const mid = await until((x) => x.toEdge < -6 || !x.alive); await shot('spill-repel');
  const end = await until((x) => x.s > s.z1 + 20 || !x.alive);
  return `${s.character} lane ${s.lane} (passage ${s.ramp}): repel=${s.repel}, momentum 60 -> ${s.momentum}; inside: repel=${mid.repel} -> alive=${end.alive}`;
}, MS);
await scenario('Lynn: Repellent with 20 Momentum', 'rider=lynn&momentum=20', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(40); await key('KeyS', 's'); await sleep(120);
  const s = JSON.parse(await state());
  const g = await until((x) => x.grabbed || x.mode === 'over'); await sleep(250); await shot('spill-grab');
  const end = await until((x) => x.mode === 'over');
  return `refused: repel=${s.repel}, momentum ${s.momentum} -> grabbed=${g.grabbed} -> mode=${end.mode}`;
}, MS);
await scenario('Mach: occupied lane + Surge (S)', 'momentum=100', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(30); await key('KeyS', 's'); await sleep(100);
  const s = JSON.parse(await state());
  const g = await until((x) => x.grabbed || x.mode === 'over');
  const end = await until((x) => x.mode === 'over');
  return `flight=${s.kind} -> grabbed=${g.grabbed} at ${g.y} m -> mode=${end.mode}`;
}, MS);
await scenario('Brute: occupied lane + Smash (S)', 'rider=brute&momentum=100', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(40); await key('KeyS', 's'); await sleep(120);
  const s = JSON.parse(await state());
  const end = await until((x) => x.mode === 'over');
  return `smash refused (momentum ${s.momentum}) -> mode=${end.mode}`;
}, MS);
for (const [who, q] of [['Mach', ''], ['Brute', 'rider=brute']]) {
  await scenario(`${who}: through the passage`, q, async ({ edge, until }) => {
    const s0 = JSON.parse(await state()); await steerTo(s0.ramp);
    await edge(25); if (who === 'Mach') await shot('spill-approach');
    const end = await until((x) => x.s > s0.z1 + 20 || !x.alive);
    return `passage lane ${s0.ramp} -> alive=${end.alive}`;
  }, MS);
}
}
// ---------------- R5 secondary abilities: E (desktop) / tap (mobile) ----------------
const ROAD = 'road&lead=0'; // open road at the start of the run
const tap = async () => { // a real touch tap on the canvas (touchStart + touchEnd, no movement)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 640, y: 400 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
if (!only || only === 'abilities') {
await scenario('Brute: E = Scrap, timer, no stacking', 'rider=brute&momentum=40', async () => {
  await sleep(300); await key('KeyE', 'e'); await sleep(150);
  const a = JSON.parse(await state());
  await sleep(1000); await key('KeyE', 'e'); await sleep(150);
  const b = JSON.parse(await state()); await shot('scrap-active');
  await sleep(4600);
  const c = JSON.parse(await state());
  return `DEF 2 -> ${a.def}, Momentum ${a.momentum}, chain x${a.chain} scores x${a.scoreChain}, ${a.scrapT}s; 2nd press: DEF ${b.def}, ${b.scrapT}s left; after ~5.9s: active=${c.scrapT > 0}, scores x${c.scoreChain}`;
}, ROAD);
await scenario('Brute: tap = Scrap (touch)', 'rider=brute', async () => {
  await sleep(300); await tap(); await sleep(150);
  const a = JSON.parse(await state());
  return `DEF 2 -> ${a.def}, Scrap ${a.scrapT}s, mode ${a.mode}`;
}, ROAD);
await scenario('Brute: Scrap at 0 DEF', 'rider=brute&def=0', async () => {
  await sleep(300); await key('KeyE', 'e'); await sleep(150);
  const a = JSON.parse(await state());
  return `refused: DEF ${a.def}, HP ${a.hp}, Scrap ${a.scrapT}s`;
}, ROAD);
await scenario('Brute: Scrap, crash, restart', 'rider=brute', async ({ edge, until }) => {
  await steerTo(await blockedLane());
  await edge(30); await key('KeyE', 'e'); await sleep(120);
  const a = JSON.parse(await state());
  const end = await until((x) => x.mode === 'over');
  await sleep(1300); await key('KeyE', 'e'); await sleep(100);
  const dead = JSON.parse(await state());
  await key('Space', ' '); await sleep(800);
  const again = JSON.parse(await state());
  return `Scrap ${a.scrapT}s in a blocked lane -> ${end.mode}; E after game over: DEF ${dead.def}, Scrap ${dead.scrapT}s; restart: mode ${again.mode}, DEF ${again.def}, Scrap ${again.scrapT}s`;
}, P);
await scenario('Lynn: E = Full Heal', 'rider=lynn&hp=1&def=0&momentum=60', async () => {
  await sleep(300); await key('KeyE', 'e'); await sleep(150);
  const a = JSON.parse(await state()); await shot('full-heal');
  await key('KeyE', 'e'); await sleep(150);
  const b = JSON.parse(await state());
  return `HP 1 -> ${a.hp}, DEF ${a.def}, Momentum 60 -> ${a.momentum}; 2nd press (HP full): HP ${b.hp}, Momentum ${b.momentum}`;
}, ROAD);
await scenario('Lynn: tap = Full Heal (touch)', 'rider=lynn&hp=1&momentum=60', async () => {
  await sleep(300); await tap(); await sleep(150);
  const a = JSON.parse(await state());
  return `HP 1 -> ${a.hp}, Momentum 60 -> ${a.momentum}`;
}, ROAD);
await scenario('Lynn: Full Heal with 40 Momentum', 'rider=lynn&hp=1&momentum=40', async () => {
  await sleep(300); await key('KeyE', 'e'); await sleep(150);
  const a = JSON.parse(await state());
  return `refused: HP ${a.hp}, Momentum ${a.momentum}`;
}, ROAD);
await scenario('Mach: E does nothing', 'momentum=100', async () => {
  await sleep(300); await key('KeyE', 'e'); await sleep(150);
  const a = JSON.parse(await state());
  return `HP ${a.hp}, DEF ${a.def}, Momentum ${a.momentum}, Scrap ${a.scrapT}s, airborne kind ${a.kind}`;
}, ROAD);
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
ws.close(); killTree(); process.exit(0);


