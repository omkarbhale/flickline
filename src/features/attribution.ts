import { defineFeature } from '../app/feature';
import { createSightPerception } from '../sim/attribution';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Fight-attribution facts (#119). `sightPerception(true)` installs the line-of-sight stand-in for
     * the enemy mind's perception (every spawned target then "sees" the player when it has line of
     * sight), so `playerDamaged.exposedTo` and `enemySawPlayer` can be driven; `false` removes it.
     * `enemySound(kind, id, x, y, z)` emits the enemy sound event with its `audibleToPlayer`.
     */
    sightPerception(on?: boolean): boolean;
    enemySound(kind: 'footstep' | 'landing' | 'reload', id: number, x: number, y: number, z: number): void;
  }
}

/** Debug/playtest access to the attribution facts until the enemy minds (#89) and body (#87) exist. */
export const feature = defineFeature({
  id: 'attribution',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      sightPerception(on = true) {
        const w = game.world;
        w.attribution.perception = on ? createSightPerception(w.tunables, w.level.boxes, w.player) : null;
        return on;
      },
      enemySound(kind, id, x, y, z) {
        const w = game.world;
        const a = w.attribution;
        if (kind === 'footstep') a.footstep(game.bus, w.tick, id, x, y, z);
        else if (kind === 'landing') a.landed(game.bus, w.tick, id, x, y, z);
        else a.reloadStarted(game.bus, w.tick, id, x, y, z);
      },
    });
  },
});
