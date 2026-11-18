import { defineFeature } from '../app/feature';
import { DEG2RAD, RAD2DEG } from '../core/math';
import { commandLookAt } from '../sim/enemyBody';
import type { TickInput } from '../sim/types';

/** A command for the debug hook: `TickInput` with the view in degrees, or `lookAtPlayer` to face the player's head. */
export type DriveCommand = Partial<Omit<TickInput, 'yaw' | 'pitch'>> & { yawDeg?: number; pitchDeg?: number; lookAtPlayer?: boolean };

/** What `drive` reports: the body after the command was set. */
export interface DriveState {
  id: number;
  driven: boolean;
  pos: { x: number; y: number; z: number };
  speed: number;
  yawDeg: number;
  pitchDeg: number;
  grounded: boolean;
  crouching: boolean;
  mag: number;
  shots: number;
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * Puppet a humanoid Echo's body (#87): its behaviour pauses and the body plays `cmd` every tick
     * through the player's movement and weapon code until `drive(id, null)` hands it back. Fields
     * are `TickInput`'s, the view in degrees (`yawDeg`, `pitchDeg`), or `lookAtPlayer: true`; a
     * field left out keeps its value, `jump` and `reload` are edges (one tick). Its shots hit the
     * player through the real spread. Returns the body's state, or null for an unknown id.
     */
    drive(id: number, cmd: DriveCommand | null): DriveState | null;
  }
}

/** Debug control of an Echo's shared body: drive it by commands like a player. */
export const feature = defineFeature({
  id: 'enemyBody',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      drive(id, cmd) {
        const t = game.world.targetField.byId(id);
        if (!t || game.tunables.targets.kinds[t.kind].shape !== 'humanoid') return null;
        const b = t.body;
        if (cmd === null) {
          b.driven = false;
          b.cmd.moveX = b.cmd.moveZ = 0;
          b.cmd.fire = b.cmd.jump = b.cmd.reload = b.cmd.walk = false;
        } else {
          b.driven = true;
          const { yawDeg, pitchDeg, lookAtPlayer, ...keys } = cmd;
          Object.assign(b.cmd, keys);
          if (yawDeg !== undefined) b.cmd.yaw = yawDeg * DEG2RAD;
          if (pitchDeg !== undefined) b.cmd.pitch = pitchDeg * DEG2RAD;
          if (lookAtPlayer) {
            const p = game.world.player;
            commandLookAt(b, p.pos.x, p.pos.y + p.eyeHeight, p.pos.z);
          }
        }
        const k = b.kin;
        const w = b.weapon;
        return {
          id, driven: b.driven, pos: { x: k.pos.x, y: k.pos.y, z: k.pos.z }, speed: Math.hypot(k.vel.x, k.vel.z),
          yawDeg: b.cmd.yaw * RAD2DEG, pitchDeg: b.cmd.pitch * RAD2DEG, grounded: k.grounded, crouching: k.crouching,
          mag: w.slots[0]!.mag, shots: w.shots,
        };
      },
    });
  },
});
