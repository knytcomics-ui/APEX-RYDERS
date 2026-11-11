// Dev helper: drives the running game in headless Edge/Chrome over the DevTools protocol
// with REAL time and REAL key events, printing sim state and saving screenshots.
// Usage: node tools/drive.mjs [query] [width] [height]
import { execSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [query = 'seed=7', W = '1280', H = '720'] = process.argv.slice(2);
const exe = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
const port = 9333;
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-drive-'));
const proc = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`,
  ...(process.env.GPU ? ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']), '--no-first-run', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });
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
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const key = async (code, keyName = code) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: keyName });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: keyName });
};
const state = async (label) => {
  const r = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => { const g = window.apex?.scene.getScene('game'); if (!g?.sim) return 'no game'; const s = g.sim;
      return JSON.stringify({ mode: g.mode, s: +s.s.toFixed(1), lane: s.lane, jumpY: +s.jumpY.toFixed(2), speed: +s.speed.toFixed(1), coins: s.coins, score: s.score, hp: s.hp, def: s.def, momentum: s.momentum, section: s.sec.def.id, fps: Math.round(window.apex.loop.actualFps), ctxLost: window.apex.renderer.gl.isContextLost(), glErr: window.apex.renderer.gl.getError() }); })()`,
  });
  console.log(label.padEnd(14), r.result.value);
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path.join(here, `_debug_${name}.png`), Buffer.from(r.data, 'base64'));
};

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:5180/?${query}` });
await sleep(process.env.PERF ? 6500 : 3500);
if (process.env.PERF) {
  for (let i = 0; i < 40; i++) {
    const ok = await send('Runtime.evaluate', { returnByValue: true, expression: `!!(window.apex && window.apex.scene.getScene('game') && window.apex.scene.getScene('game').world)` });
    if (ok.result?.value) break;
    await sleep(500);
  }
  // CPU cost probe: time spent building the frame in JS vs. the whole frame.
  await send('Runtime.evaluate', { expression: `(() => { const g = window.apex.scene.getScene('game'); const w = g.world; const d = w.draw.bind(w); window.__p = { n: 0, t: 0 };
    w.draw = (...a) => { const t0 = performance.now(); d(...a); window.__p.t += performance.now() - t0; window.__p.n++; }; })()` });
  await sleep(4000);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({ frames: window.__p.n, drawMsAvg: +(window.__p.t / window.__p.n).toFixed(2), renderer: window.apex.renderer.type === 2 ? 'webgl' : 'canvas' })` });
  console.log('perf', r.result.value ?? JSON.stringify(r).slice(0, 400));
}
if (process.env.PIX) {
  // Read the framebuffer straight after a render: proves what the GPU actually drew.
  await send('Runtime.evaluate', { expression: `window.apex.events.on('postrender', () => { const gl = window.apex.renderer.gl; const p = new Uint8Array(4); const out = [];
    for (const [x, y] of [[640, 120], [640, 400], [100, 60], [640, 700]]) { gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); out.push([...p].join(',')); } window.__px = out.join(' | '); })` });
  await sleep(1500);
  const r = await send('Runtime.evaluate', { returnByValue: true, expression: 'window.__px' });
  console.log('pixels (road-bottom, mid, hud-corner, sky):', r.result.value);
}
await state('title');
await sleep(1000);
await state('title +1s');
await key('Space', ' ');
await sleep(1200);
await state('after Space');
await key('KeyD', 'd'); await sleep(400);
await state('after D');
await key('KeyD', 'd'); await sleep(400);
await state('after D D');
await key('KeyD', 'd'); await sleep(400);
await state('D at edge');
await key('KeyA', 'a'); await sleep(400);
await state('after A');
await key('KeyW', 'w'); await sleep(250);
await state('mid jump');
await shot('drive_jump');
await sleep(700);
await state('landed');
await sleep(6000);
await state('+6s');
await shot('drive_run');
if (process.env.OVER) {
  // Ride hands-off until the run ends, then restart.
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { returnByValue: true, expression: `window.apex.scene.getScene('game').mode` });
    if (r.result.value === 'over') break;
  }
  await state('hands-off');
  await sleep(1200);
  await shot('drive_over');
  await key('Space', ' ');
  await sleep(600);
  await state('restart');
}
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
ws.close();
killTree();
process.exit(0);




