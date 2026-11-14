import { defineFeature } from '../app/feature';
import { EnemyFxLayer } from '../render/enemyFx';

/**
 * The enemy's tell (head-node flare, line to the player) and its bullet streaks, drawn from sim
 * state and `enemyFired`. The tell's tone and the shot sounds are `features/audio.ts`.
 */
export const feature = defineFeature({
  id: 'enemyFx',
  stage: 'presentation',
  setup(game) {
    game.renderer.addLayer(new EnemyFxLayer(game.renderer, game.world, game.bus, game.tunables));
  },
});
