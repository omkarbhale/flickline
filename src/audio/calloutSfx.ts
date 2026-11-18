import type { CalloutTunables } from '../config/callout';
import type { Subscribable } from '../core/eventBus';
import { vec3 } from '../core/vec3';
import type { CalloutEvents } from '../feedback/callout';
import type { CuePlayer } from './audioEngine';
import type { AudioWorld } from './enemySfx';

const at = vec3();
const eye = vec3();

/**
 * The callout stand-in's chirp (engagement-information §4.2): two short rising syllables placed
 * `chirpDistanceM` from the head along the called direction, so it comes from that side (and no
 * nearer to a position than the coarse bearing says). Nothing allocates.
 */
export function attachCalloutSfx(bus: Subscribable<CalloutEvents>, audio: CuePlayer, world: Pick<AudioWorld, 'playerEye'>, cfg: CalloutTunables): () => void {
  return bus.on('calloutIssued', (e) => {
    world.playerEye(eye);
    at.x = eye.x + e.dirX * cfg.chirpDistanceM;
    at.y = eye.y;
    at.z = eye.z + e.dirZ * cfg.chirpDistanceM;
    audio.play('callout', { position: at });
  });
}
