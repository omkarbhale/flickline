// gen-cold-pool: write the cold opener's calibrated pool (src/config/coldOpenerPool.ts).
//   npm run cold:pool            regenerate the file from coldOpener.generatorSeed
//   npm run cold:pool -- --check exit 1 if the file on disk differs from what the generator writes
// The pool is generated once and committed as data (design §8.5, #209); re-running with an unchanged
// seed, maps, placement rules and dial axes writes the same bytes. Any change of content is a new
// `coldOpener.version` (see src/modes/coldOpenerPool.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const opts = { configFile: false, logLevel: 'error', root };
const [{ module: gen }, { module: cfg }, { module: sweep }] = await Promise.all([
  runnerImport(join(root, 'src/modes/coldOpenerGen.ts'), opts),
  runnerImport(join(root, 'src/config/tunables.ts'), opts),
  runnerImport(join(root, 'src/modes/sweep.ts'), opts),
]);

const file = join(root, 'src/config/coldOpenerPool.ts');
const t = cfg.tunables;
const text = gen.coldPoolSource(gen.generateColdPool(t, sweep.sweepCatalog(t)), t);

if (process.argv.includes('--check')) {
  let onDisk = '';
  try {
    onDisk = readFileSync(file, 'utf8');
  } catch {
    // missing file: reported below
  }
  if (onDisk !== text) {
    console.error('cold:pool: src/config/coldOpenerPool.ts is not what the generator writes (run npm run cold:pool)');
    process.exit(1);
  }
  console.log('cold:pool: up to date');
} else {
  writeFileSync(file, text);
  console.log(`cold:pool: wrote ${file}`);
}
