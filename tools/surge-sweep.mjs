// Surge timing sweep: launches Surge at every distance before a Chasm edge (real Sim, in the
// dev page), at slow / mid / top speed, and reports the window that actually crosses vs the
// window the HUD offers. Also measures the best Jump + Air Jump and the ramp.
// Usage: node tools/surge-sweep.mjs ['{"gapSeconds":1.45,"surgeSpeedBoost":1.3,"surgeGravityScale":0.6}']
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const variant = process.argv[2] ?? '{}';
const exe = [`${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`].find((p) => existsSync(p));
const port = 9341;
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-sweep-'));
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
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
for (let i = 0; i < 40 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); } };
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:5180/?lab=rider' });
for (let i = 0; i < 40; i++) { await sleep(400); const ok = await send('Runtime.evaluate', { returnByValue: true, expression: '!!window.apexSim' }); if (ok.result?.value) break; }

const sweep = (variantJson) => {
  const { Sim, STEP, TUNING, CHASM } = window.apexSim;
  const v = JSON.parse(variantJson);
  if (v.gapSeconds) CHASM.gapSeconds = v.gapSeconds;
  if (v.surgeSpeedBoost) TUNING.jump.surgeSpeedBoost = v.surgeSpeedBoost;
  if (v.surgeGravityScale) TUNING.jump.surgeGravityScale = v.surgeGravityScale;
  if (v.surgeVelocity) TUNING.jump.surgeVelocity = v.surgeVelocity;
  const out = [`variant ${variantJson}  (gapSeconds ${CHASM.gapSeconds}, surge v0 ${TUNING.jump.surgeVelocity}, gravity x${TUNING.jump.surgeGravityScale}, speed x${TUNING.jump.surgeSpeedBoost})`];
  const seed = 7;
  // ride (god) to `d` metres before the near edge of the first Chasm past `minS`, in `lane`
  const approach = (minS, d, laneOf, momentum) => {
    const s = new Sim({ seed, god: true }); let g = 0;
    while ((!s.hazard || s.hazard.kind !== 'chasm' || s.hazard.z0 < minS || s.hazard.z0 - s.s > 260) && g++ < 2e6) s.step(STEP);
    const h = s.hazard, lane = laneOf(h);
    while (s.lane !== lane) { s.intent(lane < s.lane ? 'left' : 'right'); for (let i = 0; i < 36; i++) s.step(STEP); }
    while (h.z0 - s.s > d) s.step(STEP);
    s.god = false; s.momentum = momentum; s.events.length = 0;
    return { s, h };
  };
  const finish = (s, h) => { let t = 0; while (s.alive && s.s < h.z1 + 30 && t < 10) { s.step(STEP); t += STEP; } return s.alive && s.s >= h.z1; };
  for (const minS of [300, 2800, 5600]) {
    const probe = approach(minS, 120, (h) => (h.safeLane + 2) % 5, 0);
    const h0 = probe.h, gap = h0.z1 - h0.z0, speed = probe.s.speed;
    const ok = [], hud = [];
    for (let d = 0; d <= 110; d += 0.5) {
      const { s, h } = approach(minS, d, (x) => (x.safeLane + 2) % 5, 100);
      const offered = !!(s.hazardAhead() && s.hazardAhead().bypassReady);
      const actual = h.z0 - s.s;
      s.intent('down');
      if (s.jumpKind !== 'surge') continue;
      if (finish(s, h)) ok.push(actual);
      if (offered) hud.push(actual);
    }
    const span = (a) => (a.length ? [Math.min(...a), Math.max(...a)] : null);
    const o = span(ok), u = span(hud);
    const gaps = ok.length > 1 ? ok.sort((a, b) => a - b).some((x, i) => i && x - ok[i - 1] > 1.2) : false;
    // best Jump + Air Jump: launch near the edge, Air Jump at the last moment before touchdown
    let best = -1;
    for (const d of [0.5, 2, 4, 6, 8]) {
      const { s, h } = approach(minS, d, (x) => (x.safeLane + 2) % 5, 25);
      s.intent('jump'); let t = 0;
      while ((s.jumpY > 0.25 || s.jumpV > 0) && s.airborne && t < 3) { s.step(STEP); t += STEP; }
      s.intent('jump');
      while (s.airborne && t < 6) { s.step(STEP); t += STEP; }
      best = Math.max(best, s.s - h.z0);
    }
    const ramp = finish(...Object.values(approach(minS, 60, (x) => x.safeLane, 0)));
    out.push(`  speed ${speed.toFixed(0)} m/s, gap ${gap} m (${(gap / speed).toFixed(2)} s):`
      + `  Surge crosses from ${o ? `${o[0].toFixed(1)}-${o[1].toFixed(1)} m = ${((o[1] - o[0]) / speed).toFixed(2)} s` : 'NEVER'}${gaps ? ' (holes!)' : ''}`
      + `  | HUD offers ${u ? `${u[0].toFixed(1)}-${u[1].toFixed(1)} m = ${((u[1] - u[0]) / speed).toFixed(2)} s` : 'never'}${u && o && (u[0] < o[0] - 0.01 || u[1] > o[1] + 0.01) ? ' (OFFERS A FAILING PRESS!)' : ''}`
      + `  | Jump+Air best lands ${best.toFixed(1)} m in, falls ${(gap - best).toFixed(1)} m / ${((gap - best) / speed).toFixed(2)} s short`
      + `  | ramp ${ramp ? 'crosses' : 'FAILS'}`);
  }
  return out.join('\n');
};
const r = await send('Runtime.evaluate', { returnByValue: true, expression: `(${sweep.toString()})(${JSON.stringify(variant)})` });
console.log(r.result?.value ?? JSON.stringify(r).slice(0, 800));
ws.close(); killTree(); process.exit(0);
