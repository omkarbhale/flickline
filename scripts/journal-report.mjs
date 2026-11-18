// journal-report: the repeat-enjoyment table of the playtest report (#214) from testers' play journals.
//   npm run journal -- alice.json bob.json     (a journal pasted from Settings > Data > Copy play journal,
//                                                or a whole save export; each file is one tester)
// Prints markdown to stdout. Exit code 1 when a file cannot be read (the others are still reported).
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: npm run journal -- <journal-or-save.json>...');
  process.exit(2);
}
const opts = { configFile: false, logLevel: 'error', root };
const { module: exp } = await runnerImport(resolve(root, 'src/progress/journalExport.ts'), opts);
const { module: rep } = await runnerImport(resolve(root, 'src/progress/journalReport.ts'), opts);

const entries = [];
let bad = 0;
for (const f of files) {
  const r = exp.readJournalExport(readFileSync(f, 'utf8'));
  if (!r.ok) {
    console.error(`journal: ${f}: ${r.error}`);
    bad++;
    continue;
  }
  entries.push({ name: basename(f).replace(/\.json$/, ''), journal: r.journal, asOfDay: r.asOfDay });
}
if (entries.length > 0) console.log(rep.reportMarkdown(entries));
process.exitCode = bad > 0 ? 1 : 0;
