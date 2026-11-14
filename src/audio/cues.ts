import { CUE_IDS, cueRecipes, type AudioTunables, type BusId, type CueId, type Layer } from '../config/audio';
import { renderLayers } from './dsp';
import { dbToGain } from './mixer';

/** A rendered cue: one mono buffer per variant (1 for most cues, `ladder.semitones.length` for the kill ladder). */
export interface RenderedCue {
  id: CueId;
  bus: BusId;
  peakDb: number;
  variants: Float32Array<ArrayBuffer>[];
}

export type SoundSet = Record<CueId, RenderedCue>;

export const STEPPED_CUES: ReadonlySet<CueId> = new Set<CueId>(['kill', 'killSparkle']);

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

const hzAt = (rootHz: number, semitones: number): number => rootHz * Math.pow(2, semitones / 12);

/** Kill chime for a ladder step: root note, then a fifth above (a rising resolve), bell-ish partial on top. */
export function killLayers(step: number, t: AudioTunables): Layer[] {
  const { rootHz, semitones, resolveMs, noteMs } = t.ladder;
  const f0 = hzAt(rootHz, semitones[step - 1]!);
  const f1 = f0 * Math.pow(2, 7 / 12);
  return [
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: noteMs, hz: f0, attackMs: 1.5, gain: 1.0 },
    { kind: 'tone', wave: 'sine', startMs: 0, durMs: noteMs * 0.5, hz: f0 * 2.76, attackMs: 1, gain: 0.18 },
    { kind: 'tone', wave: 'sine', startMs: resolveMs, durMs: noteMs, hz: f1, attackMs: 1.5, gain: 0.85 },
  ];
}

/** Headshot-kill top layer: a short octave-up sparkle (two detuned partials two octaves above the step note). */
export function sparkleLayers(step: number, t: AudioTunables): Layer[] {
  const { rootHz, semitones, sparkleMs, resolveMs } = t.ladder;
  const f = hzAt(rootHz, semitones[step - 1]!) * 2;
  return [
    { kind: 'tone', wave: 'triangle', startMs: 0, durMs: sparkleMs, hz: f, attackMs: 0.8, gain: 1.0 },
    { kind: 'tone', wave: 'triangle', startMs: 0, durMs: sparkleMs, hz: f * 1.006, attackMs: 0.8, gain: 0.7 },
    { kind: 'tone', wave: 'sine', startMs: resolveMs, durMs: sparkleMs, hz: f * 1.5, attackMs: 0.8, gain: 0.5 },
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
    if (id === 'kill' || id === 'killSparkle') {
      const peakDb = id === 'kill' ? t.ladder.peakDb : t.ladder.sparklePeakDb;
      const variants: Float32Array<ArrayBuffer>[] = [];
      for (let s = 1; s <= steps; s++) {
        const layers = id === 'kill' ? killLayers(s, t) : sparkleLayers(s, t);
        variants.push(renderLayers(layers, -40, dbToGain(peakDb), sampleRate, seed + s));
      }
      out[id] = { id, bus: 'hits', peakDb, variants };
    } else {
      const r = cueRecipes[id];
      out[id] = { id, bus: r.bus, peakDb: r.peakDb, variants: [renderLayers(r.layers, r.decayDb, dbToGain(r.peakDb), sampleRate, seed)] };
    }
  }
  return out;
}
