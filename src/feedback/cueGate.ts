import { tellCueAt } from '../adaptive/dial';
import type { CuePhase, CueRule, CueTunables } from '../config/cues';
import type { DialTunables } from '../config/dial';
import type { FeedbackOptions } from './options';

/**
 * The gates the presentation asks before it shows a coaching cue (design §7.4, issue #129). Pure
 * and allocation-free, because the HUD, the shot-cue model and the sound map call them per event.
 *
 * Order of authority: the **Coaching cues** setting is the master switch; a **clean run** silences
 * everything; otherwise the cue's phase (`FeedbackOptions.cuePhase`, set per run from the skill
 * posterior) says how often it speaks. `cueFading` off pins the phase to `every`.
 */

export function effectivePhase(o: Readonly<FeedbackOptions>): CuePhase {
  if (o.clean === true) return 'summary';
  if (o.cueFading === false) return 'every';
  return o.cuePhase ?? 'every';
}

function ruleFor(o: Readonly<FeedbackOptions>, cfg: CueTunables, kind: keyof CueTunables['rules']): CueRule {
  return cfg.rules[kind][effectivePhase(o)];
}

/** The amber tracer, `⇆` glyph and "tock" for a shot already flagged `moving` by the sim. */
export function movingCueShown(o: Readonly<FeedbackOptions>, cfg: CueTunables, speed: number, airborne: boolean): boolean {
  if (!o.coachingCues) return false;
  const rule = ruleFor(o, cfg, 'movingShot');
  if (rule === 'all') return true;
  return rule === 'large' && (airborne || speed >= cfg.bandwidth.movingMps);
}

/** The ghost ring and offset arrow after a miss that passed `offsetDeg` from the nearest head. */
export function ghostShown(o: Readonly<FeedbackOptions>, cfg: CueTunables, offsetDeg: number): boolean {
  if (!o.missGhost) return false;
  const rule = ruleFor(o, cfg, 'missGhost');
  if (rule === 'all') return true;
  return rule === 'large' && offsetDeg >= cfg.bandwidth.ghostDeg;
}

export function damageNumbersShown(o: Readonly<FeedbackOptions>, cfg: CueTunables): boolean {
  return o.damageNumbers && ruleFor(o, cfg, 'damageNumbers') === 'all';
}

/**
 * The time-to-shot readout floating by the crosshair on a kill. In `bandwidth` only a trial well off
 * the run median speaks, slow (fix it) or fast (worth knowing: feedback after good trials helps
 * learning, Chiviacowsky and Wulf 2007); no median yet means nothing to compare with.
 */
export function readoutShown(o: Readonly<FeedbackOptions>, cfg: CueTunables, timeMs: number, medianMs: number): boolean {
  const rule = ruleFor(o, cfg, 'readout');
  if (rule === 'all') return true;
  if (rule === 'none' || !(medianMs > 0) || !Number.isFinite(timeMs)) return false;
  return timeMs >= medianMs * cfg.bandwidth.slowFactor || timeMs <= medianMs * cfg.bandwidth.fastFactor;
}

/**
 * How loud the added enemy tell cues (head-node flare, laser line, rising tone) are for an enemy
 * fought at `dial`, 1 .. 0. A clean run or the master switch off means none; "fade cues" off pins
 * them at full; Surge (when it lands) holds them at `surgeTellFloor`. The tell's *duration* and the
 * true cues (weapon raise, stop, muzzle flash) are not scaled by this.
 */
export function tellStrength(o: Readonly<FeedbackOptions>, cfg: CueTunables, dialCfg: DialTunables, dial: number): number {
  if (o.clean === true || !o.coachingCues) return 0;
  const base = o.cueFading === false ? 1 : tellCueAt(dial, dialCfg);
  return o.surge === true ? Math.max(base, cfg.surgeTellFloor) : base;
}
