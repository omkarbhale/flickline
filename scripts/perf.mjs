// perf: run the scripted 20 s perf scene in a real browser and print the frame-time report.
//   npm run perf [-- --sec 20] [--quality low|medium|high] [--width 1280 --height 720] [--url <page>] [--json]
// Builds the game (to node_modules/.cache), serves it, opens it with chrome-devtools-axi at
// ?perf=1, polls until the scene is done, prints average / 1 % lows / worst frame / heap growth and
// exits 1 only if the smoke thresholds in src/debug/perfHarness.ts fail (generous: headless browsers
// render in software). With --url it measures a page you already serve instead of building one.
// Browser setup comes from the CHROME_DEVTOOLS_AXI_* environment (executable, session, ...).
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) { console.error(`unexpected argument '${a}'`); process.exit(2); }
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith('--')) args.set(a.slice(2), true);
  else { args.set(a.slice(2), next); i++; }
}
const seconds = Number(args.get('sec') ?? 20);
const quality = args.get('quality');
const json = args.has('json');
const width = Number(args.get('width') ?? 1280);
const height = Number(args.get('height') ?? 720);
const log = (...m) => { if (!json) console.log(...m); };

// A private browser session, so this never touches another one; exact heap numbers need the flag.
const env = {
  ...process.env,
  CHROME_DEVTOOLS_AXI_SESSION: process.env.CHROME_DEVTOOLS_AXI_SESSION ?? 'flickline-perf',
  CHROME_DEVTOOLS_AXI_CHROME_ARGS: `${process.env.CHROME_DEVTOOLS_AXI_CHROME_ARGS ?? ''} --enable-precise-memory-info`.trim(),
};
// Async on purpose: the page is served by this very process, which must stay free to answer it.
const axi = (...a) => new Promise((ok) => {
  execFile('chrome-devtools-axi', a, { env, encoding: 'utf8', timeout: 120_000 }, (error, stdout, stderr) => ok({ error, status: error ? (error.code ?? 1) : 0, stdout, stderr }));
});

if (spawnSync('chrome-devtools-axi', ['--version'], { env }).error) {
  console.error('perf: chrome-devtools-axi is not installed or not on PATH; the perf harness drives a real browser through it.');
  process.exit(2);
}

function freePort() {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
  });
}

let server = null;
let url = typeof args.get('url') === 'string' ? args.get('url') : null;
try {
  if (!url) {
    const outDir = resolve(root, 'node_modules/.cache/flickline-perf/dist');
    await build({ root, base: '/', logLevel: 'error', build: { outDir, emptyOutDir: true, sourcemap: false } });
    const port = Number(process.env.PERF_PORT) || await freePort();
    server = await preview({ root, base: '/', logLevel: 'error', build: { outDir }, preview: { port, host: '127.0.0.1', strictPort: true } });
    url = `http://127.0.0.1:${port}/`;
  }
  const page = new URL(url);
  page.searchParams.set('perf', '1');
  page.searchParams.set('perfSec', String(seconds));
  if (quality) page.searchParams.set('quality', String(quality));

  await axi('open', 'about:blank');
  await axi('resize', String(width), String(height));
  const opened = await axi('open', page.toString());
  if (opened.status !== 0) throw new Error(`could not open the page:\n${opened.stdout}${opened.stderr}`);
  log(`perf: ${seconds} s scene at ${width}x${height} on ${page.origin} ...`);

  // Each browser call times out near 30 s, so wait and poll in short steps.
  let report = null;
  const deadline = Date.now() + (seconds + 90) * 1000;
  while (Date.now() < deadline && !report) {
    await axi('wait', '2000');
    const r = await axi('eval', 'JSON.stringify(window.__flickline ? window.__flickline.perfStatus() : {state:"loading"})');
    const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('result:'));
    if (!line) continue;
    let v = JSON.parse(line.slice('result:'.length).trim());
    while (typeof v === 'string') v = JSON.parse(v);
    if (v.state === 'done') report = v.report;
  }
  if (!report) throw new Error('the perf scene did not finish (is the page serving a build with the harness feature?)');

  if (json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  process.exitCode = report.pass ? 0 : 1;
} catch (e) {
  console.error(`perf: ${e.message}`);
  process.exitCode = 2;
} finally {
  await axi('stop');
  if (server) await server.close();
}

function printReport(r) {
  const f = (n, d = 1) => Number(n).toFixed(d);
  const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
  const c = r.context;
  console.log(`quality ${c.quality}, ${c.width}x${c.height}@${c.pixelRatio}, ${r.frames} frames over ${f(r.seconds)} s, ${r.ticks} sim ticks`);
  console.log(`  frame time   avg ${f(r.avgMs, 2)} ms (${f(r.avgFps)} fps)   p50 ${f(r.p50Ms, 2)}   p99 ${f(r.p99Ms, 2)}   worst ${f(r.worstMs, 2)} ms`);
  console.log(`  1% low ${f(r.onePercentLowFps)} fps   0.1% low ${f(r.pointOnePercentLowFps)} fps   over the ${f(c.budgetMs, 2)} ms budget: ${f(r.overBudget * 100, 0)}% of frames   hitches ${r.hitches}`);
  console.log(`  cpu in frame callback   avg ${f(r.cpuAvgMs, 2)} ms   p99 ${f(r.cpuP99Ms, 2)}   worst ${f(r.cpuWorstMs, 2)} ms   draw calls ${r.drawCalls}   triangles ${r.triangles}`);
  if (r.heap.supported) {
    console.log(`  heap   ${mb(r.heap.startBytes)} -> ${mb(r.heap.endBytes)}   floor growth ${mb(r.heap.growthBytes)}   allocating ${f(r.heap.allocBytesPerSec / 1024, 0)} KiB/s (typical ${f(r.heap.typicalAllocBytesPerSec / 1024, 0)})   ${r.heap.collections} collections`);
    console.log(`  allocation   ${f(r.heap.allocBytesPerFrame / 1024, 1)} KiB per frame (sim share and sources: npm run bot -- --alloc)`);
  } else {
    console.log('  heap   not measurable here (performance.memory missing)');
  }
  const e = r.enemies;
  console.log(`  echoes on the shared body (#87)   ${e.enemies} Strafers add ${f(e.strafersMs * 1000, 1)} µs, ${e.enemies} running sprays ${f(e.sprayingMs * 1000, 1)} µs to a ${f(e.baseTickMs * 1000, 1)} µs sim tick (budget ${f(e.budgetMs * 1000, 0)} µs)`);
  console.log(r.pass ? 'smoke thresholds: PASS' : `smoke thresholds: FAIL\n  - ${r.failures.join('\n  - ')}`);
  console.log('(software-rendered headless browsers understate real frame rates: read this for correctness, relative cost and heap behaviour, not for absolute fps)');
}
