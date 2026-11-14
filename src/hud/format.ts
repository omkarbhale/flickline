/**
 * Text formatting for the live HUD. Pure functions (no DOM) so they are unit-tested; they run only
 * when a displayed value changes, never per frame.
 */

/** Seconds as `m:ss` (rounded up, so the clock hits 0:00 exactly when the run ends). */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec - 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Seconds with one decimal (`9.4`), for the last seconds of a run. */
export function formatTenths(sec: number): string {
  return (Math.max(0, Math.floor(sec * 10 + 1e-9)) / 10).toFixed(1);
}

/** `74%`; a dash with no data. */
export function formatPercent(frac: number): string {
  return Number.isFinite(frac) ? `${Math.round(frac * 100)}%` : '–';
}

/** Milliseconds as `182ms`; a dash with no data (NaN). */
export function formatMs(ms: number): string {
  return ms >= 0 ? `${Math.round(ms)}ms` : '–';
}

/** Milliseconds as seconds with two decimals, `0.41s`; a dash with no data (NaN). */
export function formatSeconds(ms: number): string {
  return ms >= 0 ? `${(ms / 1000).toFixed(2)}s` : '–';
}

/** The score multiplier, `×1.7`. */
export function formatMult(mult: number): string {
  return `×${mult.toFixed(1)}`;
}

/** A score with thousands separators, `12,450`. */
export function formatScore(score: number): string {
  return Math.round(score).toLocaleString('en-US');
}

/** Signed points, `+240` / `−85`. */
export function formatDelta(points: number): string {
  const r = Math.round(points);
  return r < 0 ? `−${Math.abs(r)}` : `+${r}`;
}

/** Chain callout from the tunable label table, or '' below `showFrom`. */
export function chainText(count: number, showFrom: number, labels: readonly string[]): string {
  if (count < showFrom) return '';
  const label = labels[Math.min(count, labels.length - 1)] ?? '';
  return `${label} ×${count}`.trim();
}
