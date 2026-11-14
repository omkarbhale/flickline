import { defineFeature } from '../app/feature';
import { Rng } from '../core/rng';
import { createMindProfile, profileFor } from '../sim/mind/profile';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The enemy mind's profile (#88) for a mind skill 0-100 and an enemy serial, as plain numbers: the
     * anchor table interpolated, the serial's personality jitter, floors applied. A probe for playtests
     * and tuning: nothing in the run uses it yet (the enemy mind itself is #90 onward).
     */
    mindProfile(mindSkill: number, serial?: number): Record<string, number>;
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
    });
  },
});
