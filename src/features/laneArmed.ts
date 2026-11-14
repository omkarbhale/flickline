import { defineFeature } from '../app/feature';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Light (true) or dim (false) the Lane's armed floor stripe, as the Stop & Pop mode will: emits `laneArmedChanged`. */
    laneArmed(armed: boolean): void;
  }
}

/**
 * The Lane's armed stripe is render-side decoration driven by a mode flag: a mode emits
 * `laneArmedChanged`, the renderer lights the map's `armed` floor marks. A reset dims them.
 */
export const feature = defineFeature({
  id: 'laneArmed',
  stage: 'presentation',
  setup(game) {
    game.bus.on('laneArmedChanged', (e) => game.renderer.setLaneArmed(e.armed));
    game.onReset(() => game.renderer.setLaneArmed(false));
    game.addDebug({
      laneArmed(armed) {
        game.bus.emit('laneArmedChanged', { tick: game.world.tick, armed });
        game.renderNow();
      },
    });
  },
});
