/**
 * The Flickline wordmark: original, drawn from the project's own geometry (a horizontal line that
 * ends in a dot), no font involved, so it renders identically everywhere and costs no request.
 * Each letter is a monoline path on a 24 x 40 cell; the line and dot sit underneath. Colour comes
 * from `currentColor` for the letters and `--trim` for the line and the dot.
 */
const CELL = 30;
const LETTERS: Record<string, string> = {
  F: 'M3 38V3h18M3 20h14',
  L: 'M3 3v35h18',
  I: 'M12 3v35',
  C: 'M21 11c0-5-4-8-9-8S3 6 3 12v14c0 6 4 9 9 9s9-3 9-8',
  K: 'M3 3v35M21 3 3 23M9 17l12 21',
  N: 'M3 38V3l18 35V3',
  E: 'M21 3H3v35h18M3 20.5h14',
};

const WORD = 'FLICKLINE';

/** Wordmark SVG markup at the given pixel height of the letters (the viewBox keeps the proportions). */
export function wordmark(heightPx = 28): string {
  const width = WORD.length * CELL;
  const total = width + 14; // room for the dot
  const h = 58;
  let paths = '';
  for (let i = 0; i < WORD.length; i++) {
    paths += `<path transform="translate(${i * CELL + 3} 2)" d="${LETTERS[WORD[i]!]!}"/>`;
  }
  const w = Math.round((heightPx * total) / h);
  return (
    `<svg class="fl-wordmark" role="img" aria-label="Flickline" width="${w}" height="${heightPx}" viewBox="0 0 ${total} ${h}">` +
    `<g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">${paths}</g>` +
    `<g fill="none" stroke="var(--trim, currentColor)" stroke-width="3" stroke-linecap="round"><path d="M3 52H${width - 4}"/></g>` +
    `<circle cx="${width + 4}" cy="52" r="4.2" fill="var(--trim, currentColor)"/>` +
    `</svg>`
  );
}
