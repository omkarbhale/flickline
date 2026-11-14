import { defineFeature } from '../app/feature';
import type { PlayLogEntry, PlayOptions, SoundSetStats } from '../audio/audioEngine';
import { attachSfx } from '../audio/sfx';
import { attachUiSounds } from '../audio/uiSounds';
import type { CueId } from '../config/audio';

declare module '../debug/hook' {
  interface FlicklineDebug {
    /** Play a cue through the real engine (needs the context unlocked by a user gesture, see audioUnlock). */
    playCue(cue: CueId, opts?: PlayOptions): void;
    /** Create/resume the audio context without a click (headless checks). */
    audioUnlock(): void;
    /** Audio state: running, voices, sound-set render stats, and the most recent plays (what was scheduled where). */
    audio(count?: number): { running: boolean; voices: number; stats: SoundSetStats | null; plays: PlayLogEntry[] };
  }
}

/** The feedback sound set: game events and UI clicks to cues on the shared audio engine. */
export const feature = defineFeature({
  id: 'audio',
  stage: 'presentation',
  setup(game) {
    attachSfx(game.bus, game.audio, game.tunables.audio);
    attachUiSounds(document, game.audio);
    game.addDebug({
      playCue(cue, opts) {
        game.audio.play(cue, opts);
      },
      audioUnlock() {
        game.audio.resume();
      },
      audio(count = 16) {
        return {
          running: game.audio.running,
          voices: game.audio.activeVoices,
          stats: game.audio.stats,
          plays: game.audio.recentPlays(count),
        };
      },
    });
  },
});
