import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Architecture guard: the pure layers must stay pure so the simulation can run headless and
 * deterministically. See the "Architecture and conventions" issue on GitHub.
 */
const root = join(import.meta.dirname);

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

function code(path: string): string {
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
}

const PURE_DIRS = ['core', 'sim', 'config', 'settings', 'feedback', 'adaptive', 'modes', 'progress', 'conformance'];
const FORBIDDEN: [RegExp, string][] = [
  [/from\s+['"]three/, 'three.js import'],
  [/\bdocument\./, 'DOM (document)'],
  [/\bwindow\./, 'DOM (window)'],
  [/\bMath\.random\b/, 'Math.random (use the seeded Rng)'],
  [/\bDate\.now\b/, 'Date.now (sim time is tick count)'],
  [/\bperformance\.now\b/, 'performance.now (sim time is tick count)'],
];

describe('pure layers stay pure', () => {
  for (const dir of PURE_DIRS) {
    it(`src/${dir} has no DOM, three.js, wall-clock or unseeded randomness`, () => {
      for (const f of files(join(root, dir))) {
        const src = code(f);
        for (const [re, what] of FORBIDDEN) expect(re.test(src), `${f}: ${what}`).toBe(false);
      }
    });
  }

  it('the viewmodel geometry and pose maths in render/ stay free of three.js, DOM and randomness', () => {
    // They are plain-array / plain-number code so their budgets and determinism are unit-testable.
    for (const name of ['viewmodelModel.ts', 'viewmodelPose.ts']) {
      const src = code(join(root, 'render', name));
      for (const [re, what] of FORBIDDEN) expect(re.test(src), `render/${name}: ${what}`).toBe(false);
    }
  });

  it('core, sim, config and modes do not import presentation, app or feature layers', () => {
    const bad = /from\s+['"]\.\.\/(render|input|audio|hud|ui|debug|app|features)\//;
    for (const dir of ['core', 'sim', 'config', 'modes', 'progress', 'conformance']) {
      for (const f of files(join(root, dir))) expect(bad.test(code(f)), f).toBe(false);
    }
  });
});
