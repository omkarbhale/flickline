/**
 * The Flickline wordmark: original, drawn from the project's own geometry (a horizontal line that
 * ends in a dot), no font involved, so it renders identically everywhere and costs no request.
 * Each letter is a monoline path (36 units tall) in a cell of its own width; the line and dot sit
 * underneath. Colour comes from `currentColor` for the letters and `--trim` for the line and the dot.
 */
const GAP = 9;
const LETTERS: Record<string, { w: number; d: string }> = {
  F: { w: 20, d: 'M3 38V3h16M3 20h12' },
  L: { w: 20, d: 'M3 3v35h16' },
  I: { w: 6, d: 'M3 3v35' },
  C: { w: 22, d: 'M20 11c0-5-4-8-9-8S2 6 2 12v14c0 6 4 9 9 9s9-3 9-8' },
  K: { w: 22, d: 'M3 3v35M20 3 3 23M9 17l11 21' },
  N: { w: 22, d: 'M3 38V3l16 35V3' },
  E: { w: 20, d: 'M19 3H3v35h16M3 20.5h12' },
};

const WORD = 'FLICKLINE';

/** Wordmark SVG markup at the given pixel height of the letters (the viewBox keeps the proportions). */
export function wordmark(heightPx = 28): string {
  let x = 0;
  let paths = '';
  for (const ch of WORD) {
    const l = LETTERS[ch]!;
    paths += `<path transform="translate(${x} 2)" d="${l.d}"/>`;
    x += l.w + GAP;
  }
  const width = x - GAP + 6; // paths start 3 units into their cell, so the last one ends 3 short of the cell edge: close the line there
  const total = width + 14; // room for the dot
  const h = 58;
  const w = Math.round((heightPx * total) / h);
  return (
    `<svg class="fl-wordmark" role="img" aria-label="Flickline" width="${w}" height="${heightPx}" viewBox="0 0 ${total} ${h}">` +
    `<g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<g fill="none" stroke="var(--trim, currentColor)" stroke-width="3" stroke-linecap="round"><path d="M3 52H${width - 4}"/></g>` +
    `<circle cx="${width + 4}" cy="52" r="4.2" fill="var(--trim, currentColor)"/>` +
    `</svg>`
  );
}
