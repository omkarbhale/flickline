import { defineFeature } from '../app/feature';
import { sprayWall as cfg } from '../config/sprayWall';
import { DECAL_BODY, DECAL_HEAD, DECAL_MISS, SprayDecals, type DecalKind } from '../feedback/sprayDecals';
import { defaultBindings } from '../input/bindings';
import { SprayPrompt } from '../hud/sprayPrompt';
import { SprayDecalLayer } from '../render/sprayDecals';
import { rayBox } from '../sim/collision';
import { vec3 } from '../core/vec3';
import type { BoxDef } from '../sim/types';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Spray Wall's wall: how many marks it holds (and of which kind), for playtests; `[]` when clean. */
    sprayWall(): { count: number; radius: number; marks: { x: number; y: number; z: number; kind: 'miss' | 'body' | 'head' }[] };
  }
}

const KIND_NAMES = ['miss', 'body', 'head'] as const;

/**
 * Spray Wall's presentation (design §4.5, §7.1): the wall panel keeps a mark per bullet of the
 * spray (a ring = missed the Post, a disc = body, a disc in a ring = head), persisting after the
 * spray and wiped when the next one starts; the bullet counter, verdict and reload prompt; and
 * the view follows when the mode moves the player to the next alcove. The mode itself is
 * `modes/sprayWall.ts`; this only listens.
 */
export const feature = defineFeature({
  id: 'sprayWall',
  stage: 'presentation',
  setup(game) {
    const decals = new SprayDecals(cfg.decalCapacity);
    game.renderer.addLayer(new SprayDecalLayer(game.renderer, decals));

    const key = (defaultBindings.reload[0] ?? 'KeyR').replace(/^Key/, '');
    new SprayPrompt(game.hud.root, game.bus, key);

    // The spray in progress: the panel the marks go on, and how many bullets still count.
    let panel: BoxDef | null = null;
    let remaining = 0;
    const normal = vec3();

    game.bus.on('sprayStarted', (e) => {
      panel = null;
      const boxes = game.world.level.boxes;
      for (let i = 0; i < boxes.length; i++) if (boxes[i]!.id === e.panel) panel = boxes[i]!;
      remaining = e.burst;
      decals.clear(cfg.decalRadiusPerM * e.distanceM);
    });
    game.bus.on('sprayEnded', () => {
      remaining = 0;
    });
    game.bus.on('shotFired', (e) => {
      if (remaining <= 0 || !panel) return;
      const o = e.origin;
      const d = e.dir;
      const t = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, panel, cfg.panelReachM, normal);
      if (t < 0) return;
      remaining--;
      const lift = cfg.decalLiftM;
      decals.add(o.x + d.x * t + normal.x * lift, o.y + d.y * t + normal.y * lift, o.z + d.z * t + normal.z * lift, normal.x, normal.y, normal.z, DECAL_MISS);
    });
    game.bus.on('shotImpact', (e) => {
      if (e.result !== 'hit' || e.targetId < 0) return;
      const kind: DecalKind = e.zone === 'head' ? DECAL_HEAD : e.zone === 'body' ? DECAL_BODY : DECAL_MISS;
      decals.setLastKind(kind);
    });
    game.bus.on('runReady', () => decals.clear());
    game.onReset(() => {
      decals.clear();
      remaining = 0;
    });

    // The mode moved the player to the next alcove: the camera is driven by the input's angles.
    game.bus.on('playerPlaced', (e) => game.input.setLook(e.yaw, 0));

    game.addDebug({
      sprayWall() {
        const marks = [];
        for (let i = 0; i < decals.count; i++) marks.push({ x: decals.x[i]!, y: decals.y[i]!, z: decals.z[i]!, kind: KIND_NAMES[decals.kind[i]!]! });
        return { count: decals.count, radius: decals.radius, marks };
      },
    });
  },
});
