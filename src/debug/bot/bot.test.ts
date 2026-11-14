import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditAllocations } from './allocAudit';
import { main } from './cli';
import { HeadlessGame } from './headless';
import { FREEPLAY, listModes, mapForMode, playMode, resolveMode } from './play';
import { BOT_PARAM_KEYS, paramsForSkill, resolveParams } from './skill';
import { runSuite } from './suite';

describe('bot skill model', () => {
  it('is monotonic: more skill, less error, faster reaction, better spray control', () => {
    const lo = paramsForSkill(0);
    const mid = paramsForSkill(50);
    const hi = paramsForSkill(100);
    expect(lo.aimSigmaDeg).toBeGreaterThan(mid.aimSigmaDeg);
    expect(mid.aimSigmaDeg).toBeGreaterThan(hi.aimSigmaDeg);
    expect(lo.reactionMeanSec).toBeGreaterThan(hi.reactionMeanSec);
    expect(lo.throughputBitsPerSec).toBeLessThan(hi.throughputBitsPerSec);
    expect(lo.sprayControl).toBeLessThan(hi.sprayControl);
    expect(Math.abs(lo.overshootBias)).toBeGreaterThan(Math.abs(hi.overshootBias));
  });

  it('keeps the research anchors: 0.2 s fastest reaction, 4.5-7 bits/s throughput', () => {
    expect(paramsForSkill(100).reactionMeanSec).toBeCloseTo(0.2, 6);
    expect(paramsForSkill(0).throughputBitsPerSec).toBeCloseTo(4.5, 6);
    expect(paramsForSkill(100).throughputBitsPerSec).toBeCloseTo(7, 6);
  });

  it('clamps skill and lets explicit parameters win', () => {
    expect(paramsForSkill(-40)).toEqual(paramsForSkill(0));
    expect(paramsForSkill(900)).toEqual(paramsForSkill(100));
    expect(paramsForSkill(NaN)).toEqual(paramsForSkill(50));
    const p = resolveParams(10, { aimSigmaDeg: 0.123, sprayControl: undefined });
    expect(p.aimSigmaDeg).toBe(0.123);
    expect(p.sprayControl).toBe(paramsForSkill(10).sprayControl);
    expect(Object.keys(p).sort()).toEqual([...BOT_PARAM_KEYS].sort());
  });
});

describe('bot runs', () => {
  it('finishes a run of every mode quickly and reports plain data', () => {
    for (const mode of listModes()) {
      const r = playMode(new HeadlessGame({ seed: 3, map: mapForMode(mode) }), { mode, skill: 60, seed: 3 });
      expect(r.finished, mode).toBe(true);
      expect(r.wallMs, mode).toBeLessThan(5000);
      expect(r.stats.shots, mode).toBeGreaterThan(0);
      expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    }
  });

  it('is deterministic for a seed and different for another', () => {
    const a = playMode(new HeadlessGame({ seed: 5 }), { mode: FREEPLAY, skill: 55, seed: 5 });
    const b = playMode(new HeadlessGame({ seed: 5 }), { mode: FREEPLAY, skill: 55, seed: 5 });
    const c = playMode(new HeadlessGame({ seed: 6 }), { mode: FREEPLAY, skill: 55, seed: 6 });
    expect({ ...a, wallMs: 0 }).toEqual({ ...b, wallMs: 0 });
    expect(c.hash).not.toBe(a.hash);
  });

  it('plays one game object through several runs, each the same as a fresh game', () => {
    const game = new HeadlessGame({ seed: 2 });
    const first = playMode(game, { mode: 'test', skill: 50, seed: 2, pinDial: 40 });
    const again = playMode(game, { mode: 'test', skill: 50, seed: 2, pinDial: 40 });
    expect(again.hash).toBe(first.hash);
    expect(again.stats).toEqual(first.stats);
  });

  it('resolves mode ids ignoring case and dashes and rejects unknown ones', () => {
    expect(resolveMode('TEST')).toBe('test');
    expect(resolveMode('free-play')).toBe(FREEPLAY);
    expect(resolveMode('nope')).toBeNull();
    expect(() => playMode(new HeadlessGame(), { mode: 'nope' })).toThrow(/unknown mode/);
  });
});

describe('bot suite (runs in CI through npm test)', () => {
  it('passes, inside the 20 s CI budget', () => {
    const r = runSuite();
    const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`);
    expect(failed).toEqual([]);
    expect(r.wallMs).toBeLessThan(20_000);
  }, 60_000);
});

describe('allocation audit', () => {
  it('keeps the sim tick under its allocation ceiling and names the sources', () => {
    const a = auditAllocations({ ticks: 25_000, warmupTicks: 12_000 });
    expect(a.sites.length).toBeGreaterThan(0);
    expect(a.bytesPerTick, JSON.stringify(a.sites.slice(0, 4))).toBeLessThanOrEqual(a.ceilingBytesPerTick);
    // Profiling slows the sim a lot and the suite runs beside other test files: give it room.
  }, 60_000);
});

describe('command line', () => {
  const run = (argv: string[]): { code: number; out: string } => {
    const lines: string[] = [];
    return { code: main(argv, (s) => lines.push(s)), out: lines.join('\n') };
  };

  it('lists modes, prints a report, emits JSON, and rejects bad input', () => {
    expect(run(['--list']).out).toContain(FREEPLAY);
    const text = run(['--mode', 'test', '--skill', '40', '--seed', '1']);
    expect(text.code).toBe(0);
    expect(text.out).toContain('accuracy');
    const json = run(['--mode', 'test', '--skill', '40', '--json']);
    expect((JSON.parse(json.out) as { mode: string }).mode).toBe('test');
    expect(run(['--mode', 'nope']).code).toBe(2);
    expect(run(['--bogus']).code).toBe(2);
    expect(run(['--param', 'aimSigmaDeg']).code).toBe(2);
  });
});

describe('bot harness stays out of the DOM and the wall clock inside the run', () => {
  const dir = import.meta.dirname;
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
    it(`${f} has no DOM, three.js or unseeded randomness`, () => {
      const src = strip(readFileSync(join(dir, f), 'utf8'));
      expect(/from\s+['"]three/.test(src)).toBe(false);
      expect(/\b(document|window)\./.test(src)).toBe(false);
      expect(/\bMath\.random\b/.test(src)).toBe(false);
    });
  }
});
