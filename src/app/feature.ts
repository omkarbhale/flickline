import type { Game } from './game';

/**
 * When a feature is set up relative to the others. Bus listeners run in subscription order, so
 * this is what decides who hears an event first:
 *  - `producer`: turns events into new facts (scores, streaks, run state). Set up first, so the
 *    events it emits arrive before presentation handles the event that caused them (the kill
 *    chime reads the streak the kill just updated).
 *  - `presentation`: reacts to events (sound, visuals).
 *  - `tools`: debug-hook commands and readouts for playtests.
 * Within a stage, features run in id order and must not depend on each other's order.
 */
export const FEATURE_STAGES = ['producer', 'presentation', 'tools'] as const;
export type FeatureStage = (typeof FEATURE_STAGES)[number];

/**
 * A self-contained piece of the game, wired in by adding one file `src/features/<id>.ts` that
 * exports `feature = defineFeature({...})`. The game finds every such file at build time (no list
 * to edit) and calls `setup` once, after every core subsystem exists. `setup` registers what the
 * feature needs through the game's registration API (`onTick`, `onFrame`, `onFrameEnd`, `onReset`,
 * `addOverlayLines`, `addSnapshot`, `addDebug`, `renderer.addLayer`) and the bus.
 */
export interface Feature {
  /** Unique; must equal the file name (`src/features/<id>.ts`). */
  readonly id: string;
  readonly stage: FeatureStage;
  setup(game: Game): void;
}

/** Identity helper that types a feature literal. */
export function defineFeature(feature: Feature): Feature {
  return feature;
}

/**
 * Check and order the discovered feature modules (keyed by path, as `import.meta.glob` returns
 * them): each must export a `feature` whose id is its file name; result is by stage, then id.
 */
export function orderFeatures(modules: Record<string, { feature?: Feature }>): Feature[] {
  const out: Feature[] = [];
  for (const path of Object.keys(modules)) {
    const f = modules[path]!.feature;
    const file = path.slice(path.lastIndexOf('/') + 1).replace(/\.ts$/, '');
    if (!f) throw new Error(`${path} does not export a \`feature\``);
    if (f.id !== file) throw new Error(`${path}: feature id '${f.id}' must equal the file name '${file}'`);
    if (!FEATURE_STAGES.includes(f.stage)) throw new Error(`${path}: unknown stage '${f.stage}'`);
    out.push(f);
  }
  const rank = (f: Feature): number => FEATURE_STAGES.indexOf(f.stage);
  return out.sort((a, b) => rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
