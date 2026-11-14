import { defineFeature } from '../app/feature';
import { zoneCentre } from '../sim/hitZones';
import type { HitZone, TargetKind } from '../sim/types';

export type Vec3Like = { x: number; y: number; z: number } | readonly [number, number, number];

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Add a target and return its id (-1 if the registry is full). `pos` is `{x,y,z}` or `[x,y,z]`
     * in metres: a Post's feet centre, a Beacon's centre. `opts.crouched` poses a Post crouched;
     * `opts.lifetimeSec` makes it expire (`targetExpired`); `opts.shield` gives a Post that many shield
     * points (default: the run's economy, see `shields`).
     */
    spawn(kind: TargetKind, pos: Vec3Like, opts?: { crouched?: boolean; lifetimeSec?: number; shield?: number }): number;
    /** Remove a target without a kill (emits `targetExpired`). */
    despawn(id: number): boolean;
    /** Point the view at the centre of a zone of a live target. Returns false for an unknown id. */
    aimAt(id: number, zone?: HitZone): boolean;
  }
}

const AIM_SCRATCH = { x: 0, y: 0, z: 0 };

/** Debug/playtest control of the target registry: spawn, despawn, aim at a zone. */
export const feature = defineFeature({
  id: 'targets',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      spawn(kind, pos, opts) {
        const [x, y, z] = Array.isArray(pos) ? (pos as readonly number[]) : [(pos as { x: number }).x, (pos as { y: number }).y, (pos as { z: number }).z];
        const id = game.world.spawnTarget(kind, x!, y!, z!, game.bus, opts);
        game.renderNow();
        return id;
      },
      despawn(id) {
        const ok = game.world.despawnTarget(id, game.bus);
        game.renderNow();
        return ok;
      },
      aimAt(id, zone = 'head') {
        const w = game.world;
        const t = w.targetField.byId(id);
        if (!t) return false;
        const tt = game.tunables.targets;
        const c = zoneCentre(AIM_SCRATCH, t, tt.hit, tt.kinds[t.kind], zone);
        const p = w.player;
        const dx = c.x - p.pos.x, dy = c.y - (p.pos.y + p.eyeHeight), dz = c.z - p.pos.z;
        game.input.setLook(Math.atan2(-dx, -dz), Math.asin(dy / Math.hypot(dx, dy, dz)));
        game.renderNow();
        return true;
      },
    });
  },
});
