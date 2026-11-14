// conformance: regenerate src/conformance/specSnapshot.json and docs/conformance.md.
//   npm run conformance
// Runs every row of the spec conformance suite against the live config and the real simulation
// (no rendering, no browser; about two seconds), then rewrites the two files deterministically.
// Exit code 1 when a row breaks a suite rule (a deviation with no written reason, a stale reason);
// the files are still written so the table can be read.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { module } = await runnerImport(resolve(root, 'src/conformance/generate.ts'), { configFile: false, logLevel: 'error', root });

const out = module.generate(readFileSync(resolve(root, module.SPEC_PATH), 'utf8'));
writeFileSync(resolve(root, module.SNAPSHOT_PATH), out.snapshot);
writeFileSync(resolve(root, module.TABLE_PATH), out.table);

const c = out.counts;
console.log(
  `conformance: ${c.total} rows: ${c.match + c.matchEstimate + c.matchPlaceholder} match ` +
    `(${c.match} sourced, ${c.matchEstimate} estimate, ${c.matchPlaceholder} placeholder), ${c.deviation} deviation, ${c.notImplemented} not implemented`,
);
for (const p of out.problems) console.error(`conformance: ${p}`);
process.exitCode = out.problems.length > 0 ? 1 : 0;
