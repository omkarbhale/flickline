import { defineFeature } from '../app/feature';
import { tellStrength } from '../feedback/cueGate';
import { EnemyFxLayer } from '../render/enemyFx';

/**
 * The enemy's tell (head-node flare, line to the player) and its bullet streaks, drawn from sim
 * state and `enemyFired`. The tell's tone and the shot sounds are `features/audio.ts`.
 */
export const feature = defineFeature({
  id: 'enemyFx',
  stage: 'presentation',
  setup(game) {
    // The added tell fades with the dial and is off in a clean run or cold opener (design 7.4), as the tell tone is.
    game.renderer.addLayer(
      new EnemyFxLayer(game.renderer, game.world, game.bus, game.tunables, () =>
        tellStrength(game.feedbackOptions, game.tunables.cues, game.tunables.dial, game.modes.runner.dial),
      ),
    );
  },
});
