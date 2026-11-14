// map-lint: validate and lint every map under src/sim/levels/*.json (or the files given as args).
//   npm run map-lint [-- path/to/map.json ...]
// Exits 1 on any schema error or lint error; warnings are printed but do not fail. Typically ~0.5 s.
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const levelsDir = join(root, 'src', 'sim', 'levels');
const files = process.argv.length > 2
  ? process.argv.slice(2).map((f) => resolve(f))
  : readdirSync(levelsDir).filter((f) => f.endsWith('.json')).sort().map((f) => join(levelsDir, f));

if (files.length === 0) {
  console.error(`map-lint: no map files found in ${levelsDir}`);
  process.exit(1);
}

const start = performance.now();
const opts = { configFile: false, logLevel: 'error' };
const [{ module: schema }, { module: lint }] = await Promise.all([
  runnerImport(join(root, 'src/sim/mapSchema.ts'), opts),
  runnerImport(join(root, 'src/sim/mapLint.ts'), opts),
]);

let failed = false;
for (const file of files) {
  const name = basename(file);
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`${name}: not valid JSON (${e.message})`);
    failed = true;
    continue;
  }
  const parsed = schema.parseMap(raw);
  if (!parsed.ok) {
    console.error(`${name}: ${parsed.errors.length} schema error(s)`);
    for (const e of parsed.errors) console.error(`  ${e.path}: ${e.message}`);
    failed = true;
    continue;
  }
  const report = lint.lintMap(parsed.map);
  for (const line of lint.formatLintReport(report)) console.log(line);
  if (lint.lintErrors(report).length > 0) failed = true;
}
console.log(`map-lint: ${files.length} map(s) in ${Math.round(performance.now() - start)} ms${failed ? ' - FAILED' : ' - ok'}`);
process.exit(failed ? 1 : 0);
