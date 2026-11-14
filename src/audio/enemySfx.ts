import type { AudioTunables } from '../config/audio';
import type { Subscribable } from '../core/eventBus';
import { vec3, type Vec3 } from '../core/vec3';
import type { RunEvents } from '../sim/runEvents';
import type { SimEvents } from '../sim/types';
import type { CuePlayer } from './audioEngine';

type EnemyEvents = Pick<RunEvents, 'enemyTell' | 'enemyFired'> & Pick<SimEvents, 'playerDamaged'>;

/** Where things are, as audio needs them. Implemented over the sim in `features/audio.ts`. */
export interface AudioWorld {
  /** Where enemy `id` speaks from (its head/muzzle) into `out`; false when it is not in the field. */
  enemyVoice(id: number, out: Vec3): boolean;
  /** The player's head into `out`. */
  playerEye(out: Vec3): void;
}

const enemyAt = vec3();
const eye = vec3();
const whizAt = vec3();

/**
 * The closest point of the bullet line (from `from`, along unit `dir`) to `eye`, written into
 * `out`. Returns the miss distance, or -1 when the closest approach is behind the muzzle (the
 * bullet is moving away from the player: no whiz).
 */
export function closestApproach(out: Vec3, from: Readonly<Vec3>, dir: Readonly<Vec3>, at: Readonly<Vec3>): number {
  const s = (at.x - from.x) * dir.x + (at.y - from.y) * dir.y + (at.z - from.z) * dir.z;
  if (s <= 0) return -1;
  out.x = from.x + dir.x * s;
  out.y = from.y + dir.y * s;
  out.z = from.z + dir.z * s;
  const dx = out.x - at.x, dy = out.y - at.y, dz = out.z - at.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Enemy sounds (design 5.3, 12), all positioned at the enemy by an HRTF panner so direction is
 * readable; none of this allocates (scratch vectors, reused payloads on the bus).
 *
 *  enemyTell    -> the rising 300 to 900 Hz tone at the enemy, exactly `durationMs` long; quieter, then silent,
 *                  as the tell-cue axis fades it (design 7.4)
 *  enemyFired   -> the enemy shot at the enemy; a miss also plays the whiz where the bullet line
 *                  passes the head (`dir` is the unit direction the bullet travelled, world space),
 *                  so it comes from the side the shot passed
 *  playerDamaged-> the damage thud, centred in the head (not positional); the master low-pass dip
 *                  is `damageAudio.ts`
 */
export function attachEnemySfx(
  bus: Subscribable<EnemyEvents>,
  audio: CuePlayer,
  world: AudioWorld,
  t: AudioTunables,
  /** How loud the added tell tone is, 1 .. 0 (fading cues, design §7.4: the tone fades with the dial); default full. */
  tellStrength: () => number = () => 1,
): () => void {
  const offs = [
    bus.on('enemyTell', (e) => {
      const strength = tellStrength();
      if (strength <= 0 || !world.enemyVoice(e.id, enemyAt)) return;
      audio.play('enemyTell', strength >= 1 ? { position: enemyAt, durationMs: e.durationMs } : { position: enemyAt, durationMs: e.durationMs, gain: strength });
    }),
    bus.on('enemyFired', (e) => {
      if (!world.enemyVoice(e.id, enemyAt)) return;
      audio.play('enemyShot', { position: enemyAt });
      if (e.hit) return;
      world.playerEye(eye);
      const miss = closestApproach(whizAt, enemyAt, e.dir, eye);
      if (miss < 0 || miss > t.whiz.maxMissM) return;
      // Keep the whiz off the exact centre of the head, where HRTF direction is undefined.
      if (miss < t.whiz.minOffsetM) {
        const k = miss > 1e-6 ? t.whiz.minOffsetM / miss : 0;
        whizAt.x = eye.x + (whizAt.x - eye.x) * k + (miss > 1e-6 ? 0 : t.whiz.minOffsetM);
        whizAt.y = eye.y + (whizAt.y - eye.y) * k;
        whizAt.z = eye.z + (whizAt.z - eye.z) * k;
      }
      audio.play('whiz', { position: whizAt });
    }),
    bus.on('playerDamaged', () => audio.play('damageThud')),
  ];
  return () => offs.forEach((f) => f());
}
