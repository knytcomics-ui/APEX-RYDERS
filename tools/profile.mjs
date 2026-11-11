// Dev helper: CPU-profiles the running game for a few seconds (headless Edge, real GPU)
// and prints the hottest functions. Usage: node tools/profile.mjs [query]
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [query = 'seed=11&autostart=1&god=1&warp=5'] = process.argv.slice(2);
const exe = [
  `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
].find((p) => existsSync(p));
const port = 9334;
const PROFILE = mkdtempSync(path.join(tmpdir(), 'apex-prof-'));
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
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:5180/?${query}` });
await sleep(6000);
// Primitive counts per frame, split by renderer stage (everything else = scenery props).
if (process.env.COUNT) await send('Runtime.evaluate', { expression: `(() => {
  const g = window.apex.scene.getScene('game'), w = g.world, GP = Object.getPrototypeOf(w.gBack);
  const c = window.__c = { frames: 0, tris: 0, lines: 0, paths: 0, ground: 0, ribbon: 0, barrier: 0 };
  for (const [m, k] of [['fillTriangle', 'tris'], ['lineBetween', 'lines'], ['fillPath', 'paths'], ['strokePath', 'paths']]) {
    const o = GP[m]; GP[m] = function (...a) { c[k]++; return o.apply(this, a); };
  }
  for (const [m, k] of [['drawGround', 'ground'], ['drawRibbon', 'ribbon'], ['barrier', 'barrier']]) {
    const o = w[m].bind(w); w[m] = (...a) => { const t = c.tris + c.lines; o(...a); c[k] += c.tris + c.lines - t; };
  }
  const d = w.draw.bind(w); w.draw = (...a) => { c.frames++; d(...a); };
})()` });
await sleep(10);
const counts = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const c = window.__c, f = c.frames; const o = {}; for (const k in c) o[k] = Math.round(c[k] / f); o.frames = f; return JSON.stringify(o); })()` });
console.log('per frame:', counts.result.value);
await send('Profiler.enable');
await send('Profiler.setSamplingInterval', { interval: 200 });
await send('Profiler.start');
await sleep(4000);
const { profile } = await send('Profiler.stop');
const fps = await send('Runtime.evaluate', { returnByValue: true, expression: 'Math.round(window.apex.loop.actualFps)' });

const dt = profile.timeDeltas, self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
let total = 0;
profile.samples.forEach((sid, i) => {
  const n = byId.get(sid), d = dt[i] ?? 0;
  total += d;
  const key = `${n.callFrame.functionName || '(anon)'}  ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + d);
});
const gpu = await send('Runtime.evaluate', { returnByValue: true, expression: `(() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown'; })()` });
console.log('gpu:', gpu.result.value);
console.log(`fps ~${fps.result.value}, profiled ${(total / 1000).toFixed(0)} ms`);
[...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, v]) => console.log(`${((v / total) * 100).toFixed(1).padStart(5)}%  ${k}`));
ws.close(); killTree(); process.exit(0);


