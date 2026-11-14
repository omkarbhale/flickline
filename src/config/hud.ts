/**
 * Tunables of the live HUD (design §7.2, §9.5, §13.1). Presentation and window sizes only: no
 * gameplay number lives here.
 */
export interface HudTunables {
  /** Edge meter: rolling success rate over the last N trials (design §9.5). */
  edgeWindow: number;
  /** Edge meter: the shaded target band, as success-rate fractions. */
  edgeZoneLo: number;
  edgeZoneHi: number;
  /** Ghost-pace bar: the bar is full at ±this fraction of the personal best's score at the same second. */
  ghostFullScaleFrac: number;
  /** Ghost-pace bar: below this PB score the comparison is noise, so the bar stays quiet. */
  ghostMinPbScore: number;
  /** Ghost-pace bar refresh rate while a run is live, Hz (the PB curve is sampled at this rate). */
  ghostRefreshHz: number;
  /** HUD scale limits (the scale slider and the sanitiser). */
  scaleMin: number;
  scaleMax: number;
  /** Chain counter: shown from this many kills (a lone kill is a chain of 1 and not worth a callout). */
  chainShowFrom: number;
  /** Chain callout names by count (design §7.3); counts beyond the table use the last entry. */
  chainLabels: readonly string[];
  /** Timer shows tenths of a second below this many seconds remaining. */
  timerTenthsBelowSec: number;
}

export const hud: HudTunables = {
  edgeWindow: 20,
  edgeZoneLo: 0.6,
  edgeZoneHi: 0.8,
  ghostFullScaleFrac: 0.25,
  ghostMinPbScore: 50,
  ghostRefreshHz: 10,
  scaleMin: 0.6,
  scaleMax: 1.6,
  chainShowFrom: 2,
  chainLabels: ['', '', 'PAIR', 'TRIPLE', 'QUAD', 'SURGE CHAIN'],
  timerTenthsBelowSec: 10,
};
