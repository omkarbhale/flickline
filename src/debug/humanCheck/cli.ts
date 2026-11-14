import { measureAlignment, measureMovement, measureReset, measureRestartFlow, measureRestartSim, measureSounds, measureSpray, measureTagging } from './measure';

/**
 * `npm run human-check [-- --json]`: print the offline measurements behind
 * `docs/reviews/human-check-1.md` (#180). Takes a few seconds; no browser.
 */
export function main(argv: string[]): number {
  const json = argv.includes('--json');
  const t0 = performance.now();
  const report = {
    spray: (['kestrel', 'vane', 'rill', 'pace'] as const).map((w) => measureSpray(w, 200)),
    reset: {
      kestrel: measureReset('kestrel', [1, 3, 10, 30], [100, 200, 350, 400, 500, 750, 1000, 1500]),
      vane: measureReset('vane', [1, 3, 10], [100, 200, 375, 400, 500, 750, 1000, 1500]),
    },
    movement: (['kestrel', 'pace'] as const).map((w) => measureMovement(w)),
    tagging: (['body', 'head', 'leg'] as const).map((z) => measureTagging(z)),
    alignment: [60, 144, 165, 240, 360].map((hz) => measureAlignment(hz)),
    sounds: measureSounds(),
    restartSimMs: measureRestartSim(),
    restartFlow: ['sweep'].map((m) => measureRestartFlow(m)),
  };
  const ms = performance.now() - t0;
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }
  const f = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : String(n));
  console.log(`human-check measurements (${f(ms / 1000, 1)} s)\n`);
  for (const s of report.spray) {
    console.log(`spray ${s.weapon}: ${s.sprays} seeded sprays x ${s.bullets} bullets, ${f(s.intervalMs, 1)} ms apart`);
    console.log(`  first sideways bullet ${s.firstSidewaysBullet}; mean climb b5 ${f(s.climbAt.b5!)} b10 ${f(s.climbAt.b10!)} b20 ${f(s.climbAt.b20!)} last ${f(s.climbAt.last!)} deg`);
    console.log(`  yaw switches per spray ${f(s.switchesPerSpray)}; sprays with a switch ${f(s.spraysWithSwitch * 100, 0)} %`);
    console.log('  bullet  pitch  |yaw|  right%  spread');
    for (const r of s.rows) console.log(`  ${String(r.bullet).padStart(6)} ${f(r.pitch).padStart(6)} ${f(r.yawAbs).padStart(6)} ${f(r.rightShare * 100, 0).padStart(6)} ${f(r.spreadDeg).padStart(7)}`);
  }
  for (const [w, rows] of Object.entries(report.reset)) {
    console.log(`\nreset ${w}: burst, pause ms -> next shot offset pitch / yaw, spread (deg)`);
    for (const r of rows) console.log(`  ${String(r.burst).padStart(3)} ${String(r.pauseMs).padStart(5)}  ${f(r.pitchOffsetDeg)} / ${f(r.yawOffsetDeg)}  ${f(r.spreadDeg)}`);
  }
  console.log('\nmovement (ms)');
  for (const m of report.movement) console.log(`  ${m.weapon}: run ${f(m.runSpeed)} m/s; rest->90% ${f(m.accelTo90Ms, 1)}, ->100% ${f(m.accelTo100Ms, 1)}; release->deadzone ${f(m.releaseToDeadzoneMs, 1)}, ->stop ${f(m.releaseToStopMs, 1)}; counter->deadzone ${f(m.counterToDeadzoneMs, 1)}, ->stop ${f(m.counterToStopMs, 1)}; reverse->full ${f(m.reverseToFullMs, 1)}`);
  console.log('\ntagging and flinch (one 20 HP hit while running)');
  for (const t of report.tagging) console.log(`  ${t.zone}: min speed ${f(t.minSpeedFraction * 100, 1)} % at ${f(t.toMinMs, 1)} ms, back to 95 % at ${f(t.recoverTo95Ms, 1)} ms; flinch peak ${f(t.flinchPeakDeg)} deg, under 0.05 deg at ${f(t.flinchRecoverMs, 1)} ms`);
  console.log('\nloop alignment (ideal display, ms): click -> firing frame p50/p90/max; move -> frame p50/max; frames with no tick');
  for (const a of report.alignment) console.log(`  ${a.hz} Hz: click ${f(a.clickToFiringFrame.p50)}/${f(a.clickToFiringFrame.p90)}/${f(a.clickToFiringFrame.max)}  move ${f(a.moveToFrame.p50)}/${f(a.moveToFrame.max)}  zero-tick ${f(a.zeroTickFrames * 100, 1)} %`);
  console.log('\nsounds: cue onset peakAt duration peakDb rms50Db centroidHz dominantHz');
  for (const c of report.sounds.cues) console.log(`  ${c.cue.padEnd(12)} ${f(c.onsetMs, 1)} ${f(c.peakAtMs, 1)} ${f(c.durationMs, 0)} ${f(c.peakDb, 1)} ${f(c.rms50Db, 1)} ${f(c.centroidHz, 0)} ${f(c.dominantHz, 0)}`);
  console.log('  spectral distance (dB RMS, third-octave, peak-normalised):');
  for (const d of report.sounds.distance) console.log(`    ${d.a} vs ${d.b}: ${f(d.db, 1)}`);
  console.log(`\nrestart (sim side, mode start from a seed): p50 ${f(report.restartSimMs.p50)} ms, max ${f(report.restartSimMs.max)} ms`);
  for (const r of report.restartFlow) console.log(`  ${r.mode}: Enter -> live ${f(r.toLiveMs, 0)} ms, -> first target ${f(r.toFirstTargetMs, 0)} ms (sim time)`);
  return 0;
}
