// gen-baseline-items: write the Daily Baseline's stored item lists (src/config/baselineItems.ts).
//   npm run baseline:items            regenerate the file from baseline.generatorSeed
//   npm run baseline:items -- --check exit 1 if the file on disk differs from what the generator writes
// The lists are generated once and committed as data (design §8.5, docs/research/transfer.md §5.2);
// re-running with an unchanged seed, dial axes and mode tunables writes the same bytes. Any change
// of content is a new `baseline.version` (see src/modes/baselineItems.test.ts).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const opts = { configFile: false, logLevel: 'error', root };
const [{ module: gen }, { module: cfg }] = await Promise.all([
  runnerImport(join(root, 'src/modes/baselineGen.ts'), opts),
  runnerImport(join(root, 'src/config/tunables.ts'), opts),
]);

const file = join(root, 'src/config/baselineItems.ts');
const text = gen.baselineItemsSource(gen.generateBaselineItems(cfg.tunables), cfg.tunables);

if (process.argv.includes('--check')) {
  let onDisk = '';
  try {
    onDisk = readFileSync(file, 'utf8');
  } catch {
    // missing file: reported below
  }
  if (onDisk !== text) {
    console.error('baseline:items: src/config/baselineItems.ts is not what the generator writes (run npm run baseline:items)');
    process.exit(1);
  }
  console.log('baseline:items: up to date');
} else {
  writeFileSync(file, text);
  console.log(`baseline:items: wrote ${file}`);
}
