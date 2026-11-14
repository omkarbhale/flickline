import { defineFeature } from '../app/feature';
import type { PlayLogEntry, PlayOptions, SoundSetStats } from '../audio/audioEngine';
import { attachDamageAudio } from '../audio/damageAudio';
import { attachEnemySfx } from '../audio/enemySfx';
import { EnemyFootsteps } from '../audio/enemyFootsteps';
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
    audio(count?: number): {
      running: boolean;
      voices: number;
      stats: SoundSetStats | null;
      plays: PlayLogEntry[];
      /** What the audio settings did to the graph: hit style and its tone cutoff, mono, bus gains, the master channel mixing. */
      mix: { hitStyle: string; hitToneHz: number; hitsBusGain: number; mono: boolean; masterChannels: number; masterGain: number } | null;
    };
    /**
     * Measure the real audio graph offline (OfflineAudioContext, no sound played): `spatial` left/right
     * energy of positioned cues at +-60 degrees, `dip` the damage low-pass dip on a steady tone, `mix`
     * hits bus against the other buses in the busiest Sweep moment, `synth` cold synthesis time.
     * Resolves to a plain object (see audio/probe.ts). Each takes a few seconds at most.
     */
    audioProbe(kind: 'spatial' | 'dip' | 'mix' | 'synth'): Promise<unknown>;
  }
}

/** The feedback sound set: game events, UI clicks and damage taken to cues on the shared audio engine. */
export const feature = defineFeature({
  id: 'audio',
  stage: 'presentation',
  setup(game) {
    attachSfx(game.bus, game.audio, game.tunables.audio);
    attachUiSounds(document, game.audio);
    attachDamageAudio(game.bus, game.audio);
    const world = game.world;
    const enemy = game.tunables.audio.enemy;
    attachEnemySfx(game.bus, game.audio, {
      enemyVoice(id, out) {
        const t = world.targetField.byId(id);
        if (!t) return false;
        out.x = t.pos.x;
        out.y = t.pos.y + enemy.muzzleHeightM;
        out.z = t.pos.z;
        return true;
      },
      playerEye(out) {
        const p = world.player;
        out.x = p.pos.x;
        out.y = p.pos.y + p.eyeHeight;
        out.z = p.pos.z;
      },
    }, game.tunables.audio);
    const steps = new EnemyFootsteps(game.audio, enemy, world.targets.length);
    game.onTick(() => steps.tick(world.targets, world.player.pos.x, world.player.pos.z));
    game.onReset(() => steps.reset());
    game.addDebug({
      playCue(cue, opts) {
        game.audio.play(cue, opts);
      },
      async audioProbe(kind) {
        return (await import('../audio/probe')).runProbe(kind, game.tunables.audio);
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
          mix: game.audio.mixState(),
        };
      },
    });
  },
});
