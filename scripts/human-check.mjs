// human-check: offline measurements for docs/reviews/human-check-1.md (#180).
//   npm run human-check            tables
//   npm run human-check -- --json  everything as JSON
// No browser; the real sim and sound renderer run as fast as the CPU allows (a few seconds).
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { module } = await runnerImport(resolve(root, 'src/debug/humanCheck/cli.ts'), { configFile: false, logLevel: 'error', root });
process.exitCode = module.main(process.argv.slice(2));
