import type { Subscribable } from '../core/eventBus';
import type { SimEvents } from '../sim/types';
import type { AudioEngine } from './audioEngine';

/** Maps sim events to sounds. Add new sound hooks here. */
export function attachSfx(bus: Subscribable<SimEvents>, audio: AudioEngine): () => void {
  const offs = [
    bus.on('shotFired', () => audio.playShot()),
    bus.on('targetHit', () => audio.playHit()),
    bus.on('targetKilled', () => audio.playKill()),
    bus.on('playerJumped', () => audio.playJump()),
    bus.on('playerLanded', (e) => audio.playLand(e.impactSpeed)),
    bus.on('footstep', (e) => {
      if (!e.walking) audio.playFootstep(e.crouching);
    }),
  ];
  return () => offs.forEach((f) => f());
}
