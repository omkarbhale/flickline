import type { Subscribable } from '../core/eventBus';
import type { SimEvents } from '../sim/types';
import type { LowpassDipper } from './audioEngine';

/**
 * Taking damage -> the 300 ms master low-pass dip (design §7.1 "Hear": "low, dry thud in the
 * player's ear with a 300 ms low-pass dip"). This is the dip only; the damage thud itself is
 * sound design for #41 and plays through the usual cue path. Nothing here allocates.
 */
export function attachDamageAudio(bus: Subscribable<Pick<SimEvents, 'playerDamaged'>>, audio: LowpassDipper): () => void {
  return bus.on('playerDamaged', () => audio.dipLowpass());
}
