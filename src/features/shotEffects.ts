import { defineFeature } from '../app/feature';
import { ShotLayer } from '../render/shotLayer';

/** Tracers, impact flashes and the viewmodel kick. */
export const feature = defineFeature({
  id: 'shotEffects',
  stage: 'presentation',
  setup(game) {
    game.renderer.addLayer(new ShotLayer(game.renderer.scene, game.renderer.camera, game.bus));
  },
});
