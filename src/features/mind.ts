import { defineFeature } from '../app/feature';
import { Rng } from '../core/rng';
import { createMindProfile, profileFor } from '../sim/mind/profile';

const AIM_PHASES = ['hold', 'move', 'gap', 'settle'];

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The enemy mind's profile (#88) for a mind skill 0-100 and an enemy serial, as plain numbers: the
     * anchor table interpolated, the serial's personality jitter, floors applied. A probe for playtests
     * and tuning (Sweep's Echoes build theirs the same way from the run's seed, #90).
     */
    mindProfile(mindSkill: number, serial?: number): Record<string, number>;
    /**
     * A live mind-driven Echo's aim (#90), or null if `id` is not one: its view (degrees), the aim
     * phase (hold, move, gap, settle), the submovement (0 = primary), corrections, the error to where it
     * means to aim and the aimed zone's angular radius (degrees), its fire phase and contact facts.
     */
    mindAim(id: number): Record<string, number | string | boolean> | null;
  }
}

/** Debug probe for the mind profiles. */
export const feature = defineFeature({
  id: 'mind',
  stage: 'tools',
  setup(game) {
    const scratch = createMindProfile();
    game.addDebug({
      mindProfile(mindSkill, serial = 1) {
        // Probe-only stream: the real per-enemy streams are `(runSeed, serial, stream)` hashes (#86).
        profileFor(mindSkill, new Rng((Math.imul(serial, 0x9e3779b1) ^ 0x6d1d) >>> 0), scratch, game.tunables);
        return { ...scratch };
      },
      mindAim(id) {
        const t = game.world.targetField.byId(id);
        if (!t || !t.alive || !t.ai.mind) return null;
        const a = t.ai;
        const s = a.aim;
        const deg = 180 / Math.PI;
        return {
          id, mindSkill: a.profile.mindSkill, yawDeg: s.yaw * deg, pitchDeg: s.pitch * deg,
          aimPhase: AIM_PHASES[s.phase] ?? String(s.phase), submovement: s.sub, corrections: s.corrections,
          errDeg: s.err * deg, zoneDeg: s.zoneAngle * deg, firePhase: a.phase, expectation: a.contactExpectation,
          reactionMs: a.reactionDrawSec * 1000, swipe: a.swipe, movingHabit: a.movingHabit,
        };
      },
    });
  },
});
