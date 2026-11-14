import { clamp } from '../core/math';
import type { AxisValues, DialSource, ModeRef, WaveCurve } from './contracts';

/** One axis end-point pair: the value at dial 0 and at dial 100; `geometric` interpolates by ratio. */
export interface AxisRange {
  at0: number;
  at100: number;
  geometric?: boolean;
}

/**
 * A minimal stand-in for the skill model's dial side (#17): a constant base dial plus the mode's
 * wave curve, and axes interpolated from a table. It exists so the framework, `TestMode` and the
 * tests run without #17. The game swaps in the real `SkillState` when that lands (it satisfies
 * `DialSource`); no framework code changes.
 */
export function createLinearDial(table: Readonly<Record<string, AxisRange>>, baseDial = 50): DialSource & { baseDial: number } {
  const src = {
    baseDial,
    dialFor(_mode: ModeRef, beatIndex: number, curve: WaveCurve): number {
      return clamp(src.baseDial + curve(beatIndex), 0, 100);
    },
    axes(dial: number): AxisValues {
      const f = clamp(dial, 0, 100) / 100;
      const out: Record<string, number> = {};
      for (const k in table) {
        const r = table[k]!;
        out[k] = r.geometric ? r.at0 * Math.pow(r.at100 / r.at0, f) : r.at0 + (r.at100 - r.at0) * f;
      }
      return out;
    },
  };
  return src;
}
