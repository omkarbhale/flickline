import type { AudioTunables } from '../config/audio';
import type { Subscribable } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import type { SimEvents } from '../sim/types';
import type { CuePlayer } from './audioEngine';

type HearingEvents = Pick<SimEvents, 'enemyFootstep' | 'enemyLanded' | 'enemyReloadStarted'>;

const at = vec3();

/**
 * What the player hears of an Echo's body (design §12 "Footsteps", engagement-information §4.2):
 * a running step, a landing and a reload, each positioned by the HRTF panner where it happened.
 * The sim decides what is loud and how far it carries (`sim/enemySound.ts`, `enemyBody.ts`: the
 * shared body's speed, the one radius table) and stamps each event with `audibleToPlayer`; this
 * only plays the ones the player can hear, so the audio has no radius, no stride and no speed
 * rule of its own and cannot drift from what the enemy hears of the player. Nothing allocates.
 */
export function attachEnemyHearing(bus: Subscribable<HearingEvents>, audio: CuePlayer, t: AudioTunables['enemy']): () => void {
  const offs = [
    bus.on('enemyFootstep', (e) => {
      if (!e.audibleToPlayer) return;
      at.x = e.pos.x; at.y = e.pos.y + 0.05; at.z = e.pos.z;
      audio.play('enemyFootstep', { position: at });
    }),
    bus.on('enemyLanded', (e) => {
      if (!e.audibleToPlayer) return;
      at.x = e.pos.x; at.y = e.pos.y + 0.05; at.z = e.pos.z;
      audio.play('enemyLand', { position: at });
    }),
    bus.on('enemyReloadStarted', (e) => {
      if (!e.audibleToPlayer) return;
      at.x = e.pos.x; at.y = e.pos.y + t.handsHeightM; at.z = e.pos.z;
      audio.play('enemyReload', { position: at });
    }),
  ];
  return () => offs.forEach((f) => f());
}
