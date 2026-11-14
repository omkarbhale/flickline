import type { AudioTunables, CueId } from '../config/audio';
import type { Subscribable } from '../core/eventBus';
import type { FeedbackEvents } from '../feedback/events';
import type { SimEvents } from '../sim/types';
import type { CuePlayer } from './audioEngine';
import { ladderStep } from './mixer';

type SfxEvents = SimEvents & FeedbackEvents;

/**
 * The one subscriber that turns game events into cues (design 7.1 "Hear" column, 12):
 *
 *  shotFired    -> weapon shot (+ moving-shot tock when `moving`)
 *  shotImpact   -> miss "pfft" at the impact point (HRTF positional) when it hit no target
 *  targetHit    -> body / leg thock, or headshot thock + tink (no zone = body)
 *  targetKilled -> kill chime on the ladder step of the clean streak, headshot kills add the sparkle
 *  streakUpdated-> tracks the streak; a streak of `streakBreakMin`+ that drops to 0 plays the break cue
 *
 * Cues are layered on top of each other on the audio clock; nothing here allocates.
 */
export function attachSfx(
  bus: Subscribable<SfxEvents>,
  audio: CuePlayer,
  t: AudioTunables,
  /** Whether the moving-shot tock plays for this shot (cue fading, design §7.4); default: always. */
  movingTock: (e: SfxEvents['shotFired']) => boolean = () => true,
): () => void {
  let streak = 0;
  const shotCue = (weapon: string | undefined): CueId =>
    (weapon !== undefined ? t.weaponCues[weapon] : undefined) ?? t.defaultShotCue;

  const offs = [
    bus.on('shotFired', (e) => {
      audio.play(shotCue(e.weapon));
      if (e.moving === true && movingTock(e)) audio.play('movingShot');
    }),
    bus.on('shotImpact', (e) => {
      if (!e.onTarget) audio.play('miss', { position: e.point });
    }),
    bus.on('targetHit', (e) => {
      audio.play(e.zone === 'head' ? 'hitHead' : e.zone === 'leg' ? 'hitLeg' : 'hitBody');
    }),
    bus.on('targetKilled', (e) => {
      const step = ladderStep(streak, t.ladder.semitones.length);
      audio.play('kill', { pitchStep: step });
      if (e.zone === 'head') audio.play('killSparkle', { pitchStep: step });
    }),
    bus.on('streakUpdated', (e) => {
      if (e.streak === 0 && streak >= t.streakBreakMin) audio.play('streakBreak');
      streak = e.streak;
    }),
    // The scaffold's movement placeholders stay wired until #41 replaces them.
    bus.on('playerJumped', () => audio.play('jump')),
    bus.on('playerLanded', (e) => audio.play('land', { gain: Math.min(1, 0.4 + e.impactSpeed * 0.08) })),
    bus.on('footstep', (e) => {
      if (!e.walking) audio.play('footstep', { gain: e.crouching ? 0.4 : 1 });
    }),
  ];
  return () => offs.forEach((f) => f());
}
