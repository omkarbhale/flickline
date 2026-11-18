import { SOUND_KINDS, type EnemySoundKind } from '../config/attribution';

/**
 * The sound radii in effect (engagement-information §4.2, #99): the shared table
 * (`attribution.soundRadiusM`) with the current map's own radii (`LevelDef.hearing`) laid over it.
 * There is exactly one of these per world and every listener reads it: the player's hearing of an
 * enemy's step, landing, reload and shot (`audibleToPlayer` on the sound events) and an enemy's
 * hearing of the player (`PerceptionSystem`). Neither side has a radius of its own, so a sound is
 * audible in one direction exactly when it is in the other (`hearing.test.ts`).
 */
export type SoundRadii = Record<EnemySoundKind, number>;

/** A mutable radii table (one per world; `applySoundRadii` fills it in place, allocation-free). */
export function createSoundRadii(base: Readonly<SoundRadii>): SoundRadii {
  return { footstep: base.footstep, landing: base.landing, reload: base.reload, shot: base.shot };
}

/** Write the table `base` with `override`'s kinds laid over it into `out`. */
export function applySoundRadii(out: SoundRadii, base: Readonly<SoundRadii>, override?: Readonly<Partial<SoundRadii>>): void {
  for (let i = 0; i < SOUND_KINDS.length; i++) {
    const k = SOUND_KINDS[i]!;
    out[k] = override?.[k] ?? base[k];
  }
}

/** Whether a sound of `kind` at horizontal distance `distance` is heard: within its radius, the edge included. */
export function isAudible(radii: Readonly<SoundRadii>, kind: EnemySoundKind, distance: number): boolean {
  return distance <= radii[kind];
}
