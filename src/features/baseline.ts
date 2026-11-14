import { defineFeature } from '../app/feature';
import { MODES } from '../app/modeHost';
import { setReferenceLike } from '../feedback/options';
import { buildBaselineSequence, isBaselineDue, type BaselineLevels } from '../modes/baseline';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The Daily Baseline (design 8.5). `plan(seed?, levels?)`: the 40 trials a Baseline with that seed
     * would play, each `{ skill, angleDeg, pitchDeg, distance, scale, exposureSec, side, index }` (default: the
     * current seed and the levels the host would pick now). `due(lastRunEndMs, nowMs?)`: whether a Baseline is
     * due after a finished run at that wall-clock time (default now). `referenceLike()`: whether the
     * reference-like presentation is on. Start a run with `mode.start('baseline', { seed })`.
     */
    readonly baseline: {
      plan(seed?: number, levels?: BaselineLevels): unknown[];
      due(lastRunEndMs: number | null, nowMs?: number): boolean;
      referenceLike(): boolean;
    };
  }
}

/**
 * Reference-like presentation (design 8.5): while a run whose mode is `referenceLike` (the Daily
 * Baseline) is on, the coaching cues, readouts and reward sounds are off whatever the settings say.
 * One flag on the shared feedback options (the shot cues, HUD and sound map all read it) and one
 * class on the HUD root (the live HUD's clock, score, stat strip, ghost pace and edge meter). A
 * producer, so the flag is set before the presentation features hear the run's first event.
 */
export const feature = defineFeature({
  id: 'baseline',
  stage: 'producer',
  setup(game) {
    const sync = (): void => {
      const on = MODES[game.modes.modeId ?? '']?.referenceLike === true;
      if (on === game.feedbackOptions.referenceLike) return;
      setReferenceLike(game.feedbackOptions, game.settings.get(), on);
      game.hud.root.classList.toggle('ref-like', on);
    };
    game.bus.on('runReady', sync);
    game.onReset(sync);
    game.addOverlayLines(() => (game.feedbackOptions.referenceLike ? 'presentation reference-like (Baseline)' : ''));
    game.addDebug({
      baseline: {
        plan: (seed = game.world.seed, levels = game.modes.baselineLevels()) =>
          buildBaselineSequence(seed, levels).map((p) => ({ skill: p.skill, ...p.item })),
        due: (lastRunEndMs, nowMs = Date.now()) => isBaselineDue(lastRunEndMs, nowMs, game.tunables.baseline.gapHours),
        referenceLike: () => game.feedbackOptions.referenceLike,
      },
    });
  },
});
