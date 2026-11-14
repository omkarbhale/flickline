import type { Subscribable } from '../core/eventBus';
import type { SimEvents } from '../sim/types';
import type { LowpassDipper } from './audioEngine';

/**
 * Taking damage -> the 300 ms master low-pass dip (design §7.1 "Hear": "low, dry thud in the
 * player's ear with a 300 ms low-pass dip"). This is the dip only; the thud is a cue played by
 * `enemySfx.ts` through the usual cue path. Nothing here allocates.
 */
export function attachDamageAudio(bus: Subscribable<Pick<SimEvents, 'playerDamaged'>>, audio: LowpassDipper): () => void {
  return bus.on('playerDamaged', () => audio.dipLowpass());
}
