import { daily as dailyCfg, type DailyTunables } from '../config/daily';

/**
 * The Daily Route (design §4.8): one Sweep seed per local calendar date.
 *
 * The seed is `1 + fmix32(fnv1a32(text)) mod 0x7fffffff`, where `text` is `"<salt>.v<seedVersion>:<YYYY-MM-DD>"`
 * (UTF-8 bytes), FNV-1a is the 32-bit variant (offset 0x811c9dc5, prime 0x01000193) and `fmix32` is MurmurHash3's
 * finaliser, which spreads the difference between two neighbouring dates over every bit. The result is in
 * `1..0x7fffffff`, the range of every other run seed. The seed depends on nothing but the date, so two players
 * on one date get one route; what the player's own dial changes is only the Echoes' numbers (the plan does not hold
 * the dial). `DailyTunables.seedVersion` is bumped, and the golden seeds in the test with it, whenever a date
 * would otherwise get a different route.
 */

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` of `d` in the player's local time (the Daily Route changes at local midnight, not at UTC midnight). */
export function localDateKey(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whether `key` is a real calendar date written `YYYY-MM-DD`. */
export function isDateKey(key: string): boolean {
  const m = DATE_KEY.exec(key);
  if (m === null) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The date key `days` after (or before, when negative) `key`: calendar arithmetic, immune to daylight-saving changes. */
export function addDays(key: string, days: number): string {
  const m = DATE_KEY.exec(key);
  if (m === null) throw new Error(`not a date key: ${key}`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${String(t.getUTCFullYear()).padStart(4, '0')}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    // The text is ASCII (a salt, a version and a date), so the UTF-16 code unit is the byte.
    h = Math.imul(h ^ (text.charCodeAt(i) & 0xff), 0x01000193) >>> 0;
  }
  return h;
}

function fmix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** The Daily Route's seed for a local date key (`YYYY-MM-DD`). Throws for anything else. */
export function dailySeed(dateKey: string, cfg: DailyTunables = dailyCfg): number {
  if (!isDateKey(dateKey)) throw new Error(`not a date key: ${dateKey}`);
  return 1 + (fmix32(fnv1a32(`${cfg.salt}.v${cfg.seedVersion}:${dateKey}`)) % 0x7fffffff);
}

/** The Daily Route's date label on the menu and the results card: "Sun 15 Nov". */
export function dailyLabel(dateKey: string): string {
  const m = DATE_KEY.exec(dateKey);
  if (m === null) return dateKey;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[t.getUTCDay()]} ${t.getUTCDate()} ${months[t.getUTCMonth()]}`;
}
