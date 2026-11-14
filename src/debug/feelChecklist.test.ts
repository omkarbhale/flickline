import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `docs/feel-checklist.md` (#65) is the sheet the playtests (#29, #56) fill in and #67 tunes against. This
 * keeps its parts from drifting apart: every item states what to look for, how to capture evidence and a
 * 0/1/2 definition; the scoring-sheet template lists exactly the items above it, with the same critical
 * flags and judge tags; every link label is defined; no reference media is named.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = readFileSync(join(root, 'docs', 'feel-checklist.md'), 'utf8');

interface Item {
  id: string;
  critical: boolean;
  tags: string[];
  body: string;
}

const items: Item[] = [];
const headerRe = /^#### ([A-Z]{2}\d+) · (.*)$/gm;
let m: RegExpExecArray | null;
const headers: { id: string; text: string; start: number; end: number }[] = [];
while ((m = headerRe.exec(doc))) headers.push({ id: m[1]!, text: m[2]!, start: m.index, end: m.index + m[0].length });
headers.forEach((h, i) => {
  const next = headers[i + 1]?.start ?? doc.length;
  const rest = doc.slice(h.end, next);
  const stop = rest.search(/^(---|## )/m);
  const parts = h.text.split('·').map((p) => p.trim());
  items.push({
    id: h.id,
    critical: parts.includes('critical'),
    tags: (parts[parts.length - 1] ?? '').split(/\s+/).filter((t) => /^[MHR]$/.test(t)),
    body: stop >= 0 ? rest.slice(0, stop) : rest,
  });
});

const AREAS = ['RC', 'MV', 'SS', 'HK', 'HR', 'TM', 'VW'];

describe('docs/feel-checklist.md', () => {
  it('covers every area the issue names, with unique item ids', () => {
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    for (const a of AREAS) expect(items.filter((i) => i.id.startsWith(a)).length, a).toBeGreaterThanOrEqual(5);
  });

  it('gives every item what to look for, how to capture it, 0/1/2 definitions and sources', () => {
    for (const i of items) {
      expect(i.body, `${i.id} look/listen`).toContain('**Look / listen for:**');
      expect(i.body, `${i.id} evidence`).toContain('**Evidence:**');
      expect(i.body, `${i.id} sources`).toContain('**Sources:**');
      const score = /\*\*0 \/ 1 \/ 2:\*\*.*/.exec(i.body)?.[0] ?? '';
      for (const s of ['**0**', '**1**', '**2**']) expect(score, `${i.id} ${s}`).toContain(s);
      expect(i.tags.length, `${i.id} judge tag`).toBeGreaterThan(0);
    }
  });

  it('has a scoring-sheet row for every item, with the same critical flag and tags', () => {
    const rows = [...doc.matchAll(/^\| ([A-Z]{2}\d+) \| (yes)? ?\| ([MHR ]+) \|/gm)];
    expect(rows.map((r) => r[1])).toEqual(items.map((i) => i.id));
    rows.forEach((r, k) => {
      const item = items[k]!;
      expect(Boolean(r[2]), `${item.id} critical`).toBe(item.critical);
      expect((r[3] ?? '').trim().split(/\s+/), `${item.id} tags`).toEqual(item.tags);
    });
  });

  it('lists every item that needs the reference game side by side', () => {
    const listed = /cannot be judged without the reference game side by side\*\*, collected: ([A-Z0-9, ]+) \(every/.exec(doc)?.[1] ?? '';
    const want = items.filter((i) => i.tags.includes('R')).map((i) => i.id);
    expect(listed.split(',').map((s) => s.trim()).sort()).toEqual([...want].sort());
  });

  it('defines every link label it uses', () => {
    const used = new Set([...doc.matchAll(/\]\[([^\]]+)\]/g)].map((x) => x[1]!));
    const defined = new Set([...doc.matchAll(/^\[([^\]]+)\]: \S+/gm)].map((x) => x[1]!));
    for (const u of used) expect(defined.has(u), `link label ${u}`).toBe(true);
  });

  it('stores and links no reference media', () => {
    expect(doc).not.toMatch(/\.(wav|mp3|ogg|flac|mp4|webm|mov|gif)\b/i);
    expect(doc).not.toMatch(/!\[[^\]]*\]\(/); // no embedded images at all
  });
});
