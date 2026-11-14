import { defineFeature } from '../app/feature';
import type { Game } from '../app/game';
import type { WeaponId } from '../config/weapon';
import type { HitZone } from '../sim/types';

type HurtOptions = { zone?: HitZone; bearingDeg?: number; distance?: number; sourceId?: number };

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The player takes `amount` HP to `zone` from a shooter `distance` m away at `bearingDeg`
     * clockwise from where the player faces (0 ahead, 90 right, 180 behind): the damage arc, vignette,
     * HP bar, tagging, flinch and the audio dip all run as for a real hit. Returns whether it killed.
     */
    hurt(amount: number, opts?: HurtOptions): boolean;
    /** As `hurt`, with the damage taken from `weaponId`'s band for the zone at the distance (spec §3.2 / §7.4). */
    hitBy(weaponId: string, opts?: HurtOptions): boolean;
    /** HP, tagging and flinch state plus the damage view (arcs showing, redraws) and the last low-pass dip. */
    health(): unknown;
    /** Keep the HP bar visible at full health (modes with enemy fire). */
    hpAlwaysVisible(v?: boolean): void;
  }
}

/** A point `distance` m from the eye at `bearingDeg` clockwise from the player's facing, at eye height. */
function shooterPoint(game: Game, bearingDeg: number, distance: number): [number, number, number] {
  const p = game.world.player;
  const b = (bearingDeg * Math.PI) / 180;
  const yaw = p.yaw;
  // forward = (-sin, -cos), right = (cos, -sin)
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  return [
    p.pos.x + (fx * Math.cos(b) + rx * Math.sin(b)) * distance,
    p.pos.y + p.eyeHeight,
    p.pos.z + (fz * Math.cos(b) + rz * Math.sin(b)) * distance,
  ];
}

/** Debug/playtest damage to the player (until enemies shoot back) and its state. */
export const feature = defineFeature({
  id: 'health',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      hurt(amount, o = {}) {
        const [sx, sy, sz] = shooterPoint(game, o.bearingDeg ?? 0, o.distance ?? 10);
        const killed = game.world.damagePlayer(amount, o.zone ?? 'body', sx, sy, sz, o.sourceId ?? -1, game.bus);
        game.renderNow();
        return killed;
      },
      hitBy(weaponId, o = {}) {
        const [sx, sy, sz] = shooterPoint(game, o.bearingDeg ?? 0, o.distance ?? 10);
        const killed = game.world.hitPlayer(weaponId as WeaponId, o.zone ?? 'body', sx, sy, sz, o.sourceId ?? -1, game.bus);
        game.renderNow();
        return killed;
      },
      health() {
        const w = game.world;
        return {
          ...((game.snapshot() as { health: unknown }).health as object),
          arcsShowing: game.damage.arcsShowing,
          arcDraws: game.damage.draws,
          dip: { ...game.audio.lastDip },
          runPhase: game.run.state,
          runEndReason: game.run.finalStats ? game.modes.runner.endReason : null,
          tick: w.tick,
        };
      },
      hpAlwaysVisible: (v = true) => game.damage.setHpAlwaysVisible(v),
    });
  },
});
