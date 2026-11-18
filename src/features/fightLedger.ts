import { defineFeature } from '../app/feature';
import { buildFights, type FightLedger } from '../feedback/fightLedger';

/** Plain-data copy of a ledger (the live one is reused by the next build). */
export interface FightsSnapshot {
  mode: string;
  seed: number;
  truncated: boolean;
  overflow: boolean;
  contacts: unknown[];
  duels: unknown[];
  damages: unknown[];
}

declare module '../debug/hook' {
  interface FlicklineDebug {
    /**
     * The fight ledger (#120) of the current run's event log: contacts, the duels in them (facts F1-F12) and the
     * damage instances, copied into plain data. Call it after a run (or during one, for the part so far).
     * `buildMs` is how long the build took.
     */
    fights(): FightsSnapshot & { buildMs: number };
  }
}

function copy(f: FightLedger): FightsSnapshot {
  return {
    mode: f.mode,
    seed: f.seed,
    truncated: f.truncated,
    overflow: f.overflow,
    contacts: f.contacts.slice(0, f.contactCount).map((c) => ({ ...c })),
    duels: f.duels.slice(0, f.duelCount).map((d) => ({ ...d })),
    damages: f.damages.slice(0, f.damageCount).map((m) => ({ ...m })),
  };
}

/** Debug/playtest access to the fight ledger. The ledger itself is pure (`feedback/fightLedger.ts`); the results card and the attribution engine (#121) read it at run end. */
export const feature = defineFeature({
  id: 'fightLedger',
  stage: 'tools',
  setup(game) {
    game.addDebug({
      fights() {
        const t0 = performance.now();
        const f = buildFights(game.run.log);
        const buildMs = performance.now() - t0;
        return { ...copy(f), buildMs };
      },
    });
  },
});
