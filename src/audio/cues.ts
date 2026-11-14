import { CUE_IDS, cueRecipes, type AudioTunables, type BusId, type CueId, type Layer } from '../config/audio';
import { renderLayers } from './dsp';
import { dbToGain } from './mixer';
import { renderTell } from './tell';

/** A rendered cue: one mono buffer per variant (1 for most cues, `ladder.semitones.length` for the kill ladder). */
export interface RenderedCue {
  id: CueId;
  bus: BusId;
  peakDb: number;
  variants: Float32Array<ArrayBuffer>[];
}

export type SoundSet = Record<CueId, RenderedCue>;

/** Cues rendered once per kill-ladder step (variant index = step - 1). */
export const STEPPED_CUES: ReadonlySet<CueId> = new Set<CueId>(['kill', 'killSparkle', 'chain']);

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hzAt = (rootHz: number, semitones: number): number => rootHz * Math.pow(2, semitones / 12);

/**
 * Kill chime for a ladder step: a sine note with a slightly detuned twin for a bell-like shimmer.
 * The whole ladder (root 440 Hz, top step about 1.1 kHz) stays far below the headshot tink (3 kHz),
 * so a high kill never sounds like a headshot (docs/research/cues.md section 3.4).
 */
export function killLayers(step: number, t: AudioTunables): Layer[] {
  const { rootHz, semitones, noteMs } = t.ladder;
  const f0 = hzAt(rootHz, semitones[step - 1]!);
  return [
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: noteMs, hz: f0, attackMs: 1.5, gain: 1.0 },
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: noteMs, hz: f0 * t.ladder.shimmer, attackMs: 1.5, gain: 0.55 },
  ];
}

/** Headshot-kill top layer: a short octave-up sparkle (two detuned triangles an octave above the step note). */
export function sparkleLayers(step: number, t: AudioTunables): Layer[] {
  const { rootHz, semitones, sparkleMs } = t.ladder;
  const f = hzAt(rootHz, semitones[step - 1]!) * 2;
  return [
    { kind: 'tone', wave: 'triangle', startMs: 0, durMs: sparkleMs, hz: f, attackMs: 0.8, gain: 1.0 },
    { kind: 'tone', wave: 'triangle', startMs: 0, durMs: sparkleMs, hz: f * 1.006, attackMs: 0.8, gain: 0.7 },
  ];
}

/**
 * Chain layer for a kill-ladder step (design 12: "extra chime layered a fifth above per chain step"):
 * a bell note a fifth above the step's kill note. For the top steps the fifth would land in the
 * headshot tink's band, so it is folded down an octave (a fourth below the note) to stay under it.
 */
export function chainLayers(step: number, t: AudioTunables): Layer[] {
  const { rootHz, semitones } = t.ladder;
  let f = hzAt(rootHz, semitones[step - 1]!) * 1.5;
  if (f > t.chain.foldAboveHz) f /= 2;
  return [
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: t.chain.noteMs, hz: f, attackMs: 1.5, gain: 1.0 },
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: t.chain.noteMs, hz: f * t.ladder.shimmer, attackMs: 1.5, gain: 0.5 },
  ];
}

/**
 * Render the whole sound set at `sampleRate`. Deterministic (seeded noise). Synchronous and cheap
 * (a few ms); called once when the audio context is created.
 */
export function renderSoundSet(t: AudioTunables, sampleRate: number): SoundSet {
  const out = {} as SoundSet;
  const steps = t.ladder.semitones.length;
  for (const id of CUE_IDS) {
    const seed = hashId(id);
    if (id === 'kill' || id === 'killSparkle' || id === 'chain') {
      const peakDb = id === 'kill' ? t.ladder.peakDb : id === 'killSparkle' ? t.ladder.sparklePeakDb : t.chain.peakDb;
      const variants: Float32Array<ArrayBuffer>[] = [];
      for (let s = 1; s <= steps; s++) {
        const layers = id === 'kill' ? killLayers(s, t) : id === 'killSparkle' ? sparkleLayers(s, t) : chainLayers(s, t);
        variants.push(renderLayers(layers, -40, dbToGain(peakDb), sampleRate, seed + s));
      }
      out[id] = { id, bus: 'hits', peakDb, variants };
    } else if (id === 'enemyTell') {
      // Sized by the event at play time (audio/tell.ts); the reference length is for tests and docs.
      out[id] = { id, bus: 'enemies', peakDb: t.enemyTell.peakDb, variants: [renderTell(t.enemyTell.referenceMs, t.enemyTell, sampleRate)] };
    } else {
      const r = cueRecipes[id];
      let buf = renderLayers(r.layers, r.decayDb, dbToGain(r.peakDb), sampleRate, seed);
      // renderLayers pads one sample; a loop must be exactly its whole cycles long to be seamless.
      if (r.loop) buf = buf.slice(0, buf.length - 1);
      out[id] = { id, bus: r.bus, peakDb: r.peakDb, variants: [buf] };
    }
  }
  return out;
}
