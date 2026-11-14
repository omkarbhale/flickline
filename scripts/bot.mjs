// bot: play a mode headlessly with a synthetic player and print stats.
//   npm run bot -- --mode test --skill 40 [--seed 1] [--runs 5] [--json]
//   npm run bot -- --suite     regression suite (every mode, skill ordering, determinism, parameters)
//   npm run bot -- --alloc     allocation audit of the sim tick
//   npm run bot -- --help
// No rendering, no browser: the sim runs as fast as the CPU allows (a 60 s run takes well under a second).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { module } = await runnerImport(resolve(root, 'src/debug/bot/cli.ts'), { configFile: false, logLevel: 'error', root });
process.exitCode = module.main(process.argv.slice(2));
