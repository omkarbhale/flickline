import type { AudioTunables } from '../config/audio';
import { TICK_RATE } from '../core/time';
import { vec3 } from '../core/vec3';
import type { TargetState } from '../sim/types';
import type { CuePlayer } from './audioEngine';

const at = vec3();

/**
 * Enemy footsteps (design 12 "Footsteps": enemies' are positioned information). The sim has no
 * per-step event for enemies, so this derives them from motion the way the player's stride does:
 * horizontal distance walked per tick accumulates, and every `enemy.strideM` metres one positioned
 * step plays, if the enemy is within `enemy.maxAudibleM` of the listener. A target that stands
 * still makes no sound; a respawn (new id) or a jump of more than `enemy.teleportM` in one tick
 * restarts the count. A walk is silent (`enemy.silentBelowMps`): only a run makes steps, as the player's
 * shift-walk makes none. Call once per sim tick. Slots are preallocated, nothing allocates per call.
 */
export class EnemyFootsteps {
  private readonly lastX: Float64Array;
  private readonly lastZ: Float64Array;
  private readonly accum: Float64Array;
  private readonly lastId: Int32Array;

  constructor(
    private readonly audio: CuePlayer,
    private readonly t: AudioTunables['enemy'],
    capacity: number,
  ) {
    this.lastX = new Float64Array(capacity);
    this.lastZ = new Float64Array(capacity);
    this.accum = new Float64Array(capacity);
    this.lastId = new Int32Array(capacity).fill(-1);
  }

  reset(): void {
    this.lastId.fill(-1);
    this.accum.fill(0);
  }

  tick(slots: readonly TargetState[], listenerX: number, listenerZ: number): void {
    const n = Math.min(slots.length, this.lastId.length);
    for (let i = 0; i < n; i++) {
      const s = slots[i]!;
      if (!s.alive) {
        this.lastId[i] = -1;
        continue;
      }
      const x = s.pos.x;
      const z = s.pos.z;
      if (this.lastId[i] !== s.id) {
        this.lastId[i] = s.id;
        this.accum[i] = 0;
      } else {
        const dx = x - this.lastX[i]!;
        const dz = z - this.lastZ[i]!;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > this.t.teleportM) {
          this.accum[i] = 0;
        } else if (d * TICK_RATE < this.t.silentBelowMps) {
          // Walking, or standing: no sound (the distance walked quietly does not count towards the next step).
        } else if ((this.accum[i]! += d) >= this.t.strideM) {
          this.accum[i]! -= this.t.strideM;
          const lx = x - listenerX;
          const lz = z - listenerZ;
          if (lx * lx + lz * lz <= this.t.maxAudibleM * this.t.maxAudibleM) {
            at.x = x;
            at.y = s.pos.y + 0.05;
            at.z = z;
            this.audio.play('enemyFootstep', { position: at });
          }
        }
      }
      this.lastX[i] = x;
      this.lastZ[i] = z;
    }
  }
}
