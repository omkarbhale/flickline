/**
 * Extracts the numbers of `docs/mechanics-spec.md` into a plain-data snapshot.
 *
 * Pure string work (no file access, no DOM): `scripts/conformance.mjs` feeds it the spec text and
 * writes the result to `specSnapshot.json`; `specParse.test.ts` feeds it again and fails when the
 * checked-in snapshot no longer matches the spec, so a spec edit is always noticed.
 *
 * What is read: the §7 tunables (7.1 global, 7.2 handling, 7.3 spread / recovery / movement error,
 * 7.4 damage bands and penetration class), plus three tables the conformance rows need that are not
 * in §7: the reserve ammo and fire mode (§3.1), the hFOV per aspect ratio (§1.1) and the
 * bullets-to-kill table (§6).
 */

/** The spec's §7.1 confidence letter: H >= 85 %, M 50-85 %, L < 50 %, P = placeholder design choice. */
export type Confidence = 'H' | 'M' | 'L' | 'P';

/** A parsed spec value: a number, a word, a flag, or a pair/range of numbers. */
export type SpecValue = number | string | boolean | number[];

export interface GlobalEntry {
  key: string;
  value: SpecValue;
  /** The unit cell, verbatim (it may carry a note such as "deg (hFOV 103 at 16:9)"). */
  unit: string;
  conf: Confidence;
  /** The section that gives the source and the measurement method (e.g. "2.3"). */
  sec: string;
  /** Text after the leading number in the value cell, e.g. "(scaled by max/5.4)". Empty when none. */
  note: string;
}

/** One archetype's row of a per-archetype table: column name -> number, word, or null for `n/a`. */
export type ArchetypeRow = Record<string, number | string | null>;

export interface DamageBandRow {
  upToM: number;
  head: number;
  body: number;
  leg: number;
}

export type Zone = 'head' | 'body' | 'leg';

export interface TtkRow {
  archetype: string;
  fromM: number;
  toM: number;
  zone: Zone;
  /** Bullets to kill at shield 0 / 25 / 50. */
  bullets: [number, number, number];
}

export interface SpecSnapshot {
  schema: 1;
  spec: { researchDate: string; build: string };
  global: GlobalEntry[];
  /** §7.2, plus `reserve` and `mode` from §3.1. */
  handling: Record<string, ArchetypeRow>;
  /** §7.3. `sniper` appears as `sniper_unscoped` and `sniper_scoped`. */
  spread: Record<string, ArchetypeRow>;
  /** §7.4, bands in ascending range. */
  damage: Record<string, DamageBandRow[]>;
  /** §7.4: penetration class letter (L / M / H). */
  penetration: Record<string, string>;
  /** §1.1: horizontal FOV at each aspect ratio, vertical FOV fixed. */
  fovByAspect: { aspect: string; ratio: number; hfovDeg: number }[];
  /** §6. */
  ttk: TtkRow[];
}

/** Strip markdown emphasis and code ticks from a table cell. */
export function cleanCell(cell: string): string {
  return cell.replace(/`/g, '').replace(/\*\*/g, '').trim();
}

/** Split one markdown table line into its cells (outer pipes dropped). */
function splitRow(line: string): string[] {
  const t = line.trim();
  const body = t.startsWith('|') ? t.slice(1) : t;
  const inner = body.endsWith('|') ? body.slice(0, -1) : body;
  return inner.split('|').map((c) => c.trim());
}

/**
 * The first markdown table after the line that starts with `heading` (e.g. "### 7.1"), as rows of
 * cells: header row first, the `---` separator row dropped. Throws when the heading or the table is
 * missing so a restructured spec fails loudly instead of yielding an empty snapshot.
 */
export function tableAfter(lines: readonly string[], heading: string, skipTables = 0): string[][] {
  let i = lines.findIndex((l) => l.startsWith(heading));
  if (i < 0) throw new Error(`spec heading not found: "${heading}"`);
  let skip = skipTables;
  for (i++; i < lines.length; i++) {
    if (!lines[i]!.trim().startsWith('|')) continue;
    const rows: string[][] = [];
    for (; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(splitRow(lines[i]!));
    if (skip-- > 0) continue;
    return rows.filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c)));
  }
  throw new Error(`no table after spec heading "${heading}"`);
}

/** A cell as a number (`n/a` and empty give null); throws on anything else. */
export function numberCell(cell: string): number | null {
  const c = cleanCell(cell);
  if (c === '' || c.toLowerCase() === 'n/a') return null;
  const n = Number(c);
  if (!Number.isFinite(n)) throw new Error(`not a number: "${cell}"`);
  return n;
}

/** The leading number of a cell such as "4 (0.308)" or "39 (scaled by max/5.4)". */
function leadingNumber(cell: string): { n: number; rest: string } | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec(cleanCell(cell));
  return m ? { n: Number(m[1]), rest: m[2]! } : null;
}

/** Parse a §7.1 value cell: a number (+ note), "a / b", "a to b", a flag, or a word. */
export function parseValue(cell: string): { value: SpecValue; note: string } {
  const c = cleanCell(cell);
  if (c === 'true' || c === 'false') return { value: c === 'true', note: '' };
  const pair = /^(-?\d+(?:\.\d+)?)\s*(?:\/|to)\s*(-?\d+(?:\.\d+)?)$/.exec(c);
  if (pair) return { value: [Number(pair[1]), Number(pair[2])], note: '' };
  const lead = leadingNumber(c);
  if (lead) return { value: lead.n, note: lead.rest };
  return { value: c, note: '' };
}

/**
 * Expand a §7.1 key cell. "a.b_x / _y / _z" means a.b_x, a.b_y, a.b_z (the trailing `_word` of the
 * first key is replaced); "armor.light / armor.heavy" lists full keys.
 */
export function expandKeys(cell: string): string[] {
  const parts = cleanCell(cell).split('/').map((p) => p.trim());
  const first = parts[0]!;
  return parts.map((p, i) => {
    if (i === 0 || !p.startsWith('_')) return p;
    const cut = first.lastIndexOf('_');
    return (cut < 0 ? first : first.slice(0, cut)) + p;
  });
}

function parseGlobal(lines: readonly string[]): GlobalEntry[] {
  const out: GlobalEntry[] = [];
  for (const row of tableAfter(lines, '### 7.1').slice(1)) {
    const keys = expandKeys(row[0]!);
    const valueCell = cleanCell(row[1]!);
    const parts = keys.length > 1 ? valueCell.split('/').map((p) => p.trim()) : [valueCell];
    if (parts.length !== keys.length) throw new Error(`§7.1 row "${row[0]}": ${keys.length} keys but ${parts.length} values`);
    keys.forEach((key, i) => {
      const { value, note } = parseValue(parts[i]!);
      out.push({ key, value, unit: cleanCell(row[2]!), conf: cleanCell(row[3]!) as Confidence, sec: cleanCell(row[4]!), note });
    });
  }
  return out;
}

/** "rifle_precise" or "sniper (unscoped)" -> a stable key. */
function archetypeKey(cell: string): string {
  return cleanCell(cell).replace(/\s*\((\w+)\)/, '_$1');
}

/** A per-archetype table: header cells become the column names (the first column is the key). */
function parseArchetypeTable(lines: readonly string[], heading: string): Record<string, ArchetypeRow> {
  const [head, ...body] = tableAfter(lines, heading);
  const cols = head!.map(cleanCell);
  const out: Record<string, ArchetypeRow> = {};
  for (const row of body) {
    const r: ArchetypeRow = {};
    for (let c = 1; c < cols.length; c++) r[cols[c]!] = numberCell(row[c]!);
    out[archetypeKey(row[0]!)] = r;
  }
  return out;
}

function parseHandling(lines: readonly string[]): Record<string, ArchetypeRow> {
  const out = parseArchetypeTable(lines, '### 7.2');
  // §3.1 carries what §7.2 leaves out: reserve ammo and the fire mode.
  const [head, ...body] = tableAfter(lines, '### 3.1');
  const cols = head!.map(cleanCell);
  const reserveCol = cols.indexOf('Reserve');
  const modeCol = cols.indexOf('Mode');
  if (reserveCol < 0 || modeCol < 0) throw new Error('§3.1 table lost its Reserve or Mode column');
  for (const row of body) {
    const key = archetypeKey(row[0]!);
    const entry = out[key];
    if (!entry) throw new Error(`§3.1 lists ${key} but §7.2 does not`);
    entry['reserve'] = numberCell(row[reserveCol]!);
    entry['mode'] = cleanCell(row[modeCol]!);
  }
  return out;
}

function parseDamage(lines: readonly string[]): Record<string, DamageBandRow[]> {
  const out: Record<string, DamageBandRow[]> = {};
  for (const row of tableAfter(lines, '### 7.4').slice(1)) {
    const bands: DamageBandRow[] = [];
    for (let c = 1; c + 1 < row.length; c += 2) {
      if (cleanCell(row[c]!) === '') continue;
      const hbl = cleanCell(row[c + 1]!).split('/').map((p) => Number(p.trim()));
      if (hbl.length !== 3 || hbl.some((n) => !Number.isFinite(n))) throw new Error(`§7.4 bad band cell "${row[c + 1]}"`);
      bands.push({ upToM: Number(cleanCell(row[c]!)), head: hbl[0]!, body: hbl[1]!, leg: hbl[2]! });
    }
    out[archetypeKey(row[0]!)] = bands;
  }
  return out;
}

function parsePenetration(lines: readonly string[]): Record<string, string> {
  const line = lines.find((l) => l.startsWith('Beyond the last band use the last band.'));
  if (!line) throw new Error('§7.4 penetration line not found');
  const m = /Penetration class:(.*?)\.?$/.exec(line);
  if (!m) throw new Error('§7.4 penetration class list not found');
  const out: Record<string, string> = {};
  for (const pair of m[1]!.split(',')) {
    const p = /`(\w+)`\s+([LMH])/.exec(pair);
    if (p) out[p[1]!] = p[2]!;
  }
  return out;
}

function parseFov(lines: readonly string[]): SpecSnapshot['fovByAspect'] {
  const rows = tableAfter(lines, '**Behaviour at other aspect ratios', 0);
  return rows.slice(1).map((r) => {
    const hfov = /^(\d+(?:\.\d+)?)/.exec(cleanCell(r[1]!));
    if (!hfov) throw new Error(`§1.1 bad hFOV cell "${r[1]}"`);
    // "21:9 (64:27)": the parenthesised ratio is the exact one the angle was computed from.
    const label = cleanCell(r[0]!);
    const ratio = /(\d+):(\d+)\)?$/.exec(label);
    if (!ratio) throw new Error(`§1.1 bad aspect cell "${r[0]}"`);
    return { aspect: label, ratio: Number(ratio[1]) / Number(ratio[2]), hfovDeg: Number(hfov[1]) };
  });
}

function parseTtk(lines: readonly string[]): TtkRow[] {
  const out: TtkRow[] = [];
  let archetype = '';
  let fromM = 0;
  let toM = 0;
  for (const row of tableAfter(lines, '## 6. Time-to-kill tables').slice(1)) {
    const first = cleanCell(row[0]!);
    if (first !== '') {
      const m = /^(\w+)\s*\((\d+) to (\d+)\)$/.exec(first);
      if (!m) throw new Error(`§6 bad archetype cell "${row[0]}"`);
      archetype = m[1]!;
      fromM = Number(m[2]);
      toM = Number(m[3]);
    }
    const zone = cleanCell(row[1]!) as Zone;
    const bullets = [2, 3, 4].map((c) => {
      const lead = leadingNumber(row[c]!);
      if (!lead) throw new Error(`§6 bad bullet cell "${row[c]}"`);
      return lead.n;
    });
    out.push({ archetype, fromM, toM, zone, bullets: bullets as [number, number, number] });
  }
  return out;
}

/** Read the numbers out of the spec markdown. */
export function extractSnapshot(markdown: string): SpecSnapshot {
  const lines = markdown.split(/\r?\n/);
  const date = /^- Research date: (\d{4}-\d{2}-\d{2})\. Reference game build when researched: \*\*([\d.]+)\*\*/m.exec(markdown);
  if (!date) throw new Error('spec header (research date, build) not found');
  return {
    schema: 1,
    spec: { researchDate: date[1]!, build: date[2]! },
    global: parseGlobal(lines),
    handling: parseHandling(lines),
    spread: parseArchetypeTable(lines, '### 7.3'),
    damage: parseDamage(lines),
    penetration: parsePenetration(lines),
    fovByAspect: parseFov(lines),
    ttk: parseTtk(lines),
  };
}

/** The checked-in snapshot file's exact text (stable key order, trailing newline). */
export function snapshotText(s: SpecSnapshot): string {
  return JSON.stringify(s, null, 2) + '\n';
}
